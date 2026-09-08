import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Document from "@tiptap/extension-document";
import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ago, applyTheme, watchTheme } from "./theme";

interface Note {
  id: string;
  title: string;
  content: string;
  modified: number;
  created: number;
}
interface NoteMeta {
  id: string;
  title: string;
  preview: string;
  modified: number;
}

const win = getCurrentWindow();
// The main window is the one Hyper N toggles; tiling it in Hyprland demotes it to a plain note
// window (see `floating_main` in lib.rs), after which Esc closes it instead of hiding.
let isMain = win.label === "main" || win.label.startsWith("main-");
const params = new URLSearchParams(location.search);
const statusEl = document.getElementById("status")!;

let current: Note | null = null;
let dirty = false;
let saveTimer: number | undefined;
let lastSaved = "";
let saveChain: Promise<void> = Promise.resolve();
let deleteArmedUntil = 0;

// The first block is always the title: a heading, followed by anything.
const TitledDocument = Document.extend({ content: "heading block*" });

const editor = new Editor({
  element: document.getElementById("editor")!,
  extensions: [
    TitledDocument,
    StarterKit.configure({
      document: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false },
      // Keep an empty paragraph (never a heading) after the last block so the caret always has a home.
      trailingNode: { node: "paragraph", notAfter: ["paragraph"] },
    }),
    TaskList,
    // The node view omits data-type, so add it ourselves to keep the CSS selectors honest.
    TaskItem.configure({ nested: true, HTMLAttributes: { "data-type": "taskItem" } }),
    Markdown,
    Placeholder.configure({
      showOnlyCurrent: false,
      placeholder: ({ pos, hasAnchor, node }) => {
        if (pos === 0) return "Untitled";
        return hasAnchor && node.type.name === "paragraph" ? "Start writing…" : "";
      },
    }),
  ],
  content: "",
  contentType: "markdown",
  autofocus: false,
  onUpdate: () => {
    dirty = true;
    scheduleSave();
    renderStatus();
  },
});

// ---------- persistence ----------

// Empty paragraphs serialize as a lone `&nbsp;`; keep files clean and drop trailing blank lines.
function cleanMarkdown(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => line.trim() !== "&nbsp;")
    .join("\n")
    .replace(/\s+$/, "")
    .concat("\n");
}

function normalize(markdown: string): string {
  // The schema requires a leading heading; external files may not have one.
  const first = markdown.split("\n").find((l) => l.trim() !== "") ?? "";
  return /^\s*#/.test(first) ? markdown : `# \n\n${markdown}`;
}

function setNote(note: Note): void {
  current = note;
  dirty = false;
  lastSaved = note.content;
  editor.commands.setContent(normalize(note.content), { contentType: "markdown", emitUpdate: false });
  const untitled = note.title === "Untitled";
  editor.commands.focus(untitled ? "start" : "end", { scrollIntoView: !untitled });
  if (untitled) editor.view.dom.scrollTop = 0;
  if (isMain) void invoke("set_last_note", { id: note.id });
  syncTitle();
  renderStatus();
  void invoke("debug_dump", { name: "html", text: editor.getHTML() });
}

// The backend finds the main window in Hyprland's client list by its exact title "Karatasi"; every other
// editor window carries its note's title instead.
function syncTitle(): void {
  const title = isMain || !current ? "Karatasi" : `Karatasi - ${current.title}`;
  document.title = title;
  void win.setTitle(title);
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flushSave(), 300);
}

function flushSave(): Promise<void> {
  window.clearTimeout(saveTimer);
  if (!current || !dirty) return saveChain;
  const note = current;
  const md = cleanMarkdown(editor.getMarkdown());
  dirty = false;
  lastSaved = md;
  saveChain = saveChain.then(async () => {
    try {
      const saved = await invoke<Note>("save_note", { id: note.id, content: md });
      if (current && current.id === note.id) {
        current.id = saved.id;
        current.title = saved.title;
        current.modified = saved.modified;
        syncTitle();
        if (isMain) void invoke("set_last_note", { id: saved.id });
      }
    } catch (e) {
      console.error("save failed", e);
      dirty = true;
    }
    renderStatus();
  });
  return saveChain;
}

async function load(id: string): Promise<void> {
  await flushSave();
  try {
    setNote(await invoke<Note>("get_note", { id }));
  } catch (e) {
    console.error(e);
  }
}

async function newNote(): Promise<void> {
  await flushSave();
  setNote(await invoke<Note>("create_note", {}));
}

// A new note in its own window; this window keeps showing what it has. The backend matches the
// new window to this one (floating and pinned, or tiled) and unpins this one.
async function newNoteWindow(): Promise<void> {
  await flushSave();
  await invoke("open_new_note_window");
}

async function deleteCurrent(): Promise<void> {
  if (!current) return;
  const now = Date.now();
  if (now > deleteArmedUntil) {
    deleteArmedUntil = now + 2500;
    renderStatus();
    window.setTimeout(renderStatus, 2600);
    return;
  }
  deleteArmedUntil = 0;
  const gone = current.id;
  dirty = false;
  current = null;
  await invoke("delete_note", { id: gone });
  const list = await invoke<NoteMeta[]>("list_notes");
  if (list.length > 0) await load(list[0].id);
  else await newNote();
}

async function step(direction: 1 | -1): Promise<void> {
  if (!current) return;
  const list = await invoke<NoteMeta[]>("list_notes");
  const i = list.findIndex((n) => n.id === current!.id);
  const next = list[(i + direction + list.length) % list.length];
  if (next && next.id !== current.id) await load(next.id);
}

function toggleTodo(): void {
  if (editor.isActive("taskItem")) {
    const checked = Boolean(editor.getAttributes("taskItem").checked);
    editor.chain().focus().updateAttributes("taskItem", { checked: !checked }).run();
  } else {
    editor.chain().focus().toggleTaskList().run();
  }
}

// ---------- status bar ----------

function renderStatus(): void {
  if (Date.now() < deleteArmedUntil) {
    statusEl.textContent = "Press Ctrl Shift ⌫ again to delete";
    statusEl.dataset.warn = "1";
    return;
  }
  delete statusEl.dataset.warn;
  if (!current) {
    statusEl.textContent = "";
    return;
  }
  statusEl.textContent = dirty ? "Editing" : `Saved · ${ago(current.modified)}`;
}

// ---------- keys ----------

async function hideOrClose(): Promise<void> {
  await flushSave();
  if (isMain) await invoke("hide_window");
  else await win.close();
}

window.addEventListener(
  "keydown",
  (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
      e.preventDefault();
      void hideOrClose();
    } else if (ctrl && !e.shiftKey && (e.key === "k" || e.key === "p")) {
      e.preventDefault();
      void flushSave().then(() => invoke("show_switcher"));
    } else if (ctrl && !e.shiftKey && e.key === "n") {
      e.preventDefault();
      void newNote();
    } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      void newNoteWindow();
    } else if (ctrl && e.shiftKey && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      void deleteCurrent();
    } else if (ctrl && e.key === "Enter") {
      e.preventDefault();
      toggleTodo();
    } else if (ctrl && e.key === "[") {
      e.preventDefault();
      void step(-1);
    } else if (ctrl && e.key === "]") {
      e.preventDefault();
      void step(1);
    }
  },
  { capture: true },
);

window.addEventListener("contextmenu", (e) => e.preventDefault());

// ---------- events from the backend ----------

// Events aimed at one window are subscribed through `win`, which registers a listener for this
// window's label; a plain `listen` would also receive events the backend targets at other windows.
void win.listen<{ id: string }>("open-note", (e) => void load(e.payload.id));
void win.listen("new-note", () => void newNote());
void listen<{ from: string; to: string }>("note-renamed", (e) => {
  if (current && current.id === e.payload.from) current.id = e.payload.to;
});
void listen<{ id: string }>("notes-changed", async (e) => {
  if (!current || e.payload.id !== current.id || dirty) return;
  try {
    const fresh = await invoke<Note>("get_note", { id: current.id });
    if (fresh.content !== lastSaved) setNote(fresh);
    else {
      current.modified = fresh.modified;
      renderStatus();
    }
  } catch {
    /* deleted elsewhere; keep what is on screen */
  }
});
void win.listen("main-hiding", () => void flushSave());
void win.listen("close-request", () => void hideOrClose());
void win.listen("demoted", () => {
  isMain = false;
  syncTitle();
});
void win.listen("main-shown", () => {
  if (!editor.isFocused) editor.commands.focus();
});
void win.onFocusChanged(({ payload: focused }) => {
  if (!focused) void flushSave();
});
window.setInterval(renderStatus, 30_000);

// ---------- boot ----------

function reportError(message: string): void {
  console.error(message);
  statusEl.textContent = message;
  statusEl.dataset.warn = "1";
}
window.addEventListener("error", (e) => reportError(`Error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) => reportError(`Error: ${String(e.reason)}`));

async function boot(): Promise<void> {
  try {
    await applyTheme();
  } catch (e) {
    reportError(`Theme failed: ${String(e)}`);
  }
  watchTheme();
  const startFresh = params.has("new");
  const wanted =
    params.get("note") ?? (isMain && !startFresh ? await invoke<string | null>("get_last_note") : null);
  let note: Note | null = null;
  if (wanted) {
    try {
      note = await invoke<Note>("get_note", { id: wanted });
    } catch {
      note = null;
    }
  }
  if (!note && startFresh) note = await invoke<Note>("create_note", {});
  if (!note) {
    const list = await invoke<NoteMeta[]>("list_notes");
    note = list.length > 0 ? await invoke<Note>("get_note", { id: list[0].id }) : await invoke<Note>("create_note", {});
  }
  setNote(note);
}

void boot()
  .catch((e) => reportError(`Startup failed: ${String(e)}`))
  .finally(() => requestAnimationFrame(() => void invoke("frontend_ready")));
