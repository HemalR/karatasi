import { Editor, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Document from "@tiptap/extension-document";
import Image from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import Strike from "@tiptap/extension-strike";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ago, applyTheme, Keymap, watchTheme, type Theme } from "./theme";
import { RecentNotes } from "./recent-notes";

// A draft has no id: it lives only in the editor until the first save writes its file.
interface Note {
  id: string | null;
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

// Editor shortcuts; each can be overridden under `[keys]` in ~/.config/karatasi/config.toml.
const DEFAULT_KEYS: Record<string, string[]> = {
  search: ["Ctrl+K", "Ctrl+P"],
  new: ["Ctrl+N"],
  new_window: ["Ctrl+Shift+N"],
  done: ["Ctrl+Enter"],
  todo: ["Ctrl+Shift+Enter"],
  delete_block: ["Ctrl+Delete", "Ctrl+Shift+K"],
  move_up: ["Ctrl+Up"],
  move_down: ["Ctrl+Down"],
  prev: ["Ctrl+["],
  next: ["Ctrl+]"],
  cycle_recent: ["Ctrl+Tab"],
  delete: ["Ctrl+X"],
  paste: ["Shift+Insert"],
  hide: ["Escape"],
};
let keys = new Keymap(DEFAULT_KEYS);

function applySettings(t: Theme): void {
  keys = new Keymap(DEFAULT_KEYS, t.keys);
  keys.renderHints(document);
  fitHints();
}

// The bar cannot wrap, so when the window is narrow, hints leave in `data-drop` order (lowest
// number first) until the rest fit next to the status text.
const hintsEl = document.getElementById("hints")!;
function fitHints(): void {
  const hints = [...hintsEl.querySelectorAll<HTMLElement>(".hint")];
  for (const h of hints) h.hidden = false;
  const droppable = hints.filter((h) => h.dataset.drop).sort((a, b) => Number(a.dataset.drop) - Number(b.dataset.drop));
  for (const h of droppable) {
    if (hintsEl.scrollWidth <= hintsEl.clientWidth) break;
    h.hidden = true;
  }
}
window.addEventListener("resize", fitHints);

let current: Note | null = null;
const recentNotes = new RecentNotes();
let cycleChain: Promise<void> = Promise.resolve();
let dirty = false;
let saveTimer: number | undefined;
let lastSaved = "";
let saveChain: Promise<void> = Promise.resolve();
// A short message in the status bar, e.g. after a delete.
let notice: { text: string; until: number } | null = null;

// The first block is always the title: a heading, followed by anything.
const TitledDocument = Document.extend({ content: "heading block*" });

// A note links its images relative to the notes folder (`assets/x.png`), which the webview cannot
// load from its own origin, so the backend serves them over `note-asset://` (see `serve_asset` in
// lib.rs). Only the rendered <img> gets that URL; the node, and so the markdown, keeps the link.
const NoteImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const src = String(HTMLAttributes.src ?? "");
    const resolved = /^[a-z][a-z0-9+.-]*:/i.test(src) ? src : `note-asset://localhost/${src}`;
    return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { src: resolved })];
  },
});

// ---------- images ----------

// Pasted or dropped image files are saved into the notes folder (named after the title as typed,
// so a draft's first image is named before its file exists) and linked from the note.

function imageFiles(files: FileList | undefined): File[] {
  return [...(files ?? [])].filter((f) => f.type.startsWith("image/"));
}

function currentTitle(): string {
  return editor.state.doc.firstChild?.textContent ?? "";
}

function insertImage(src: string): void {
  editor.chain().focus().insertContent({ type: "image", attrs: { src } }).run();
}

// Returns whether the event was handled, as ProseMirror's paste and drop hooks expect.
function insertImages(files: File[]): boolean {
  if (files.length === 0) return false;
  void (async () => {
    for (const file of files) {
      const src = await invoke<string>("save_attachment", new Uint8Array(await file.arrayBuffer()), {
        headers: { "x-title": encodeURIComponent(currentTitle()), "x-type": file.type },
      });
      insertImage(src);
    }
  })().catch((e) => reportError(`Image failed: ${String(e)}`));
  return true;
}

// Shift+Insert. The webview ignores a synthesized paste keypress, and that is how Omarchy's
// clipboard manager and emoji picker deliver a pick (copy, then Shift+Insert via wtype), so the
// backend reads the clipboard itself with wl-paste. Text still goes through ProseMirror's paste
// pipeline, so it lands exactly as a Ctrl V would.
type Clipboard = { kind: "image"; path: string } | { kind: "text"; text: string } | { kind: "empty" };
async function pasteFromClipboard(): Promise<void> {
  const clip = await invoke<Clipboard>("read_clipboard", { title: currentTitle() });
  if (clip.kind === "image") insertImage(clip.path);
  else if (clip.kind === "text") editor.view.pasteText(clip.text);
}

const editor = new Editor({
  element: document.getElementById("editor")!,
  extensions: [
    TitledDocument,
    StarterKit.configure({
      document: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false },
      // Strike is block-level here (Ctrl Enter marks a whole line done), so drop the partial-text shortcut.
      strike: false,
      // Keep an empty paragraph (never a heading) after the last block so the caret always has a home.
      trailingNode: { node: "paragraph", notAfter: ["paragraph"] },
    }),
    Strike.extend({ addKeyboardShortcuts: () => ({}) }),
    TaskList,
    // The node view omits data-type, so add it ourselves to keep the CSS selectors honest.
    TaskItem.configure({ nested: true, HTMLAttributes: { "data-type": "taskItem" } }),
    NoteImage,
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
  editorProps: {
    handlePaste: (_view, event) => insertImages(imageFiles(event.clipboardData?.files)),
    handleDrop: (view, event, _slice, moved) => {
      // `moved` is a node dragged within the editor, which ProseMirror handles itself.
      if (moved) return false;
      const files = imageFiles(event.dataTransfer?.files);
      const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (files.length > 0 && at) editor.commands.setTextSelection(at.pos);
      return insertImages(files);
    },
  },
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

// No title and no body: nothing worth a file.
function isBlank(markdown: string): boolean {
  return markdown.replace(/^[#\s]+/, "").trim() === "";
}

function setNote(note: Note, cycling = false): void {
  if (!current || current.id !== note.id) recentNotes.opened(note.id, cycling);
  current = note;
  dirty = false;
  lastSaved = note.content;
  editor.commands.setContent(normalize(note.content), { contentType: "markdown", emitUpdate: false });
  const untitled = note.title === "Untitled";
  editor.commands.focus(untitled ? "start" : "end", { scrollIntoView: !untitled });
  if (untitled) editor.view.dom.scrollTop = 0;
  if (isMain && note.id) void invoke("set_last_note", { id: note.id });
  syncTitle();
  renderStatus();
  void invoke("debug_dump", { name: "html", text: editor.getHTML() });
}

// Ctrl N: an empty note that exists only here. Its file appears with the first keystroke.
function setDraft(): void {
  const now = Date.now();
  setNote({ id: null, title: "Untitled", content: "", modified: now, created: now });
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
  // A blank draft stays off disk.
  if (!note.id && isBlank(md)) {
    dirty = false;
    return saveChain;
  }
  dirty = false;
  lastSaved = md;
  saveChain = saveChain.then(async () => {
    try {
      // Read the id here, not when queued: a draft's first save (still in the chain) assigns it,
      // and the next save must update that file rather than create a second one.
      const saved = await invoke<Note>("save_note", { id: note.id, content: md });
      if (note.id && saved.id) recentNotes.rename(note.id, saved.id);
      else if (current === note) recentNotes.opened(saved.id);
      note.id = saved.id;
      note.title = saved.title;
      note.modified = saved.modified;
      if (current === note) {
        syncTitle();
        if (isMain) void invoke("set_last_note", { id: saved.id });
      }
    } catch (e) {
      console.error("save failed", e);
      if (current === note) dirty = true;
    }
    renderStatus();
  });
  return saveChain;
}

// Leaving a note (for another, or by hiding or closing the window). An untitled, empty note is
// removed on the way out: drafts never reach disk, so the only blank file is one the user emptied.
async function leave(): Promise<void> {
  await flushSave();
  if (!current || !current.id || !isBlank(cleanMarkdown(editor.getMarkdown()))) return;
  const blank = current;
  current = null;
  try {
    await invoke("discard_note", { id: blank.id });
    // Nothing to reopen next launch; boot falls back to the newest note.
    if (isMain) await invoke("set_last_note", { id: "" });
  } catch (e) {
    console.error("discard failed", e);
  }
}

async function load(id: string, cycling = false): Promise<void> {
  if (current && current.id === id) return flushSave();
  await leave();
  try {
    setNote(await invoke<Note>("get_note", { id }), cycling);
  } catch (e) {
    console.error(e);
    if (!current) setDraft();
  }
}

async function newNote(): Promise<void> {
  if (current && !current.id && !dirty && isBlank(cleanMarkdown(editor.getMarkdown()))) return;
  await leave();
  setDraft();
}

// A new note in its own window; this window keeps showing what it has. The backend matches the
// new window to this one (floating and pinned, or tiled) and unpins this one.
async function newNoteWindow(): Promise<void> {
  await flushSave();
  await invoke("open_new_note_window");
}

// One press deletes. The backend keeps the note for the life of a system toast whose click brings
// it back (see `note-restored`), so there is no confirmation step.
async function deleteCurrent(): Promise<void> {
  if (!current) return;
  // A draft has no file; dropping it is just starting over.
  if (!current.id) return setDraft();
  await flushSave();
  const gone = current;
  dirty = false;
  current = null;
  try {
    await invoke("delete_note", { id: gone.id });
  } catch (e) {
    console.error("delete failed", e);
    current = gone;
    renderStatus();
    return;
  }
  showNotice(`Deleted “${gone.title}”`);
  const list = await invoke<NoteMeta[]>("list_notes");
  if (list.length > 0) await load(list[0].id);
  else setDraft();
}

function showNotice(text: string, ms = 4000): void {
  notice = { text, until: Date.now() + ms };
  renderStatus();
  window.setTimeout(renderStatus, ms + 50);
}

async function step(direction: 1 | -1): Promise<void> {
  if (!current) return;
  const list = await invoke<NoteMeta[]>("list_notes");
  if (list.length === 0) return;
  const i = list.findIndex((n) => n.id === current!.id);
  // From a draft (not in the list), step to the newest or the oldest note.
  const next = i < 0 ? list[direction === 1 ? 0 : list.length - 1] : list[(i + direction + list.length) % list.length];
  if (next.id !== current.id) await load(next.id);
}

function cycleRecent(): void {
  const pressedAt = performance.now();
  // Preserve rapid presses while the preceding switch is saving/loading a note.
  cycleChain = cycleChain.then(async () => {
    await flushSave();
    const list = await invoke<NoteMeta[]>("list_notes");
    const id = recentNotes.next(current?.id ?? null, list.map((note) => note.id), pressedAt);
    if (id) await load(id, true);
  }).catch((e) => reportError(`Switch failed: ${String(e)}`));
}

// ---------- block commands ----------

// Mark every line in the selection done (struck through and muted), or undo that if all of them
// already are. Whole blocks only; the strike lands on the full text of each block.
function toggleDone(): void {
  const { state, view } = editor;
  const strike = state.schema.marks.strike;
  const { from, to } = state.selection;
  const blocks: { start: number; end: number; done: boolean }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (node.content.size === 0) return false;
    let done = true;
    node.forEach((child) => {
      if (child.isText && !strike.isInSet(child.marks)) done = false;
    });
    blocks.push({ start: pos + 1, end: pos + 1 + node.content.size, done });
    return false;
  });
  if (blocks.length === 0) return;
  const clear = blocks.every((b) => b.done);
  const tr = state.tr;
  for (const b of blocks) {
    if (clear) tr.removeMark(b.start, b.end, strike);
    else tr.addMark(b.start, b.end, strike.create());
  }
  view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}

// The block the caret is in: the list item when inside a list, otherwise the top-level block.
function blockAtCursor(): { node: PMNode; pos: number; depth: number } | null {
  const $from = editor.state.selection.$from;
  for (let depth = $from.depth; depth >= 1; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "listItem" || node.type.name === "taskItem") return { node, pos: $from.before(depth), depth };
  }
  if ($from.depth < 1) return null;
  return { node: $from.node(1), pos: $from.before(1), depth: 1 };
}

// Remove the current block (line, or list item with everything nested in it). The title stays: it
// is emptied instead, since the document must start with a heading.
function deleteBlock(): void {
  const block = blockAtCursor();
  if (!block) return;
  const { state, view } = editor;
  const tr = state.tr;
  if (block.depth === 1 && block.pos === 0) {
    tr.delete(1, 1 + block.node.content.size);
  } else {
    // deleteRange widens to whole nodes, so the last item takes its now-empty list with it.
    tr.deleteRange(block.pos, block.pos + block.node.nodeSize);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(block.pos, tr.doc.content.size)), 1));
  }
  view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}

// Swap the current block with its neighbour: a list item moves within its list (carrying anything
// nested in it), a top-level block hops over whole neighbours. The title never moves, and nothing
// moves above it or below the empty trailing line.
function moveBlock(direction: 1 | -1): void {
  const block = blockAtCursor();
  if (!block) return;
  const { state, view } = editor;
  const $from = state.selection.$from;
  const parent = $from.node(block.depth - 1);
  const index = $from.index(block.depth - 1);
  if (block.depth === 1 && index === 0) return;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= parent.childCount) return;
  if (block.depth === 1 && targetIndex === 0) return;
  const neighbour = parent.child(targetIndex);
  if (block.depth === 1 && direction === 1 && targetIndex === parent.childCount - 1 && neighbour.isTextblock && neighbour.content.size === 0) return;
  const cursor = state.selection.from - block.pos;
  const tr = state.tr;
  tr.delete(block.pos, block.pos + block.node.nodeSize);
  const insertAt = direction === -1 ? block.pos - neighbour.nodeSize : block.pos + neighbour.nodeSize;
  tr.insert(insertAt, block.node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + cursor)));
  view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}

// Finish the line: tick a todo, strike anything else; again to reopen either.
function finishLine(): void {
  if (editor.isActive("taskItem")) {
    const checked = Boolean(editor.getAttributes("taskItem").checked);
    editor.chain().focus().updateAttributes("taskItem", { checked: !checked }).run();
  } else {
    toggleDone();
  }
}

// Turn the line into a todo, or a todo back into a plain line.
function toggleTodo(): void {
  editor.chain().focus().toggleTaskList().run();
}

// ---------- status bar ----------

function renderStatus(): void {
  if (notice && Date.now() < notice.until) {
    statusEl.textContent = notice.text;
    return;
  }
  notice = null;
  delete statusEl.dataset.warn;
  if (!current) {
    statusEl.textContent = "";
    return;
  }
  statusEl.textContent = dirty ? "Editing" : current.id ? `Saved · ${ago(current.modified)}` : "New note";
}

// ---------- keys ----------

async function hideOrClose(): Promise<void> {
  if (isMain) {
    await invoke("hide_window");
    await leave();
    // The window comes back on a fresh draft rather than on the discarded note.
    if (!current) setDraft();
  } else {
    await leave();
    await win.close();
  }
}

const ACTIONS: Record<string, () => void> = {
  hide: () => void hideOrClose(),
  delete: () => void deleteCurrent(),
  search: () => void flushSave().then(() => invoke("show_switcher")),
  new: () => void newNote(),
  new_window: () => void newNoteWindow(),
  done: finishLine,
  todo: toggleTodo,
  delete_block: deleteBlock,
  move_up: () => moveBlock(-1),
  move_down: () => moveBlock(1),
  prev: () => void step(-1),
  next: () => void step(1),
  cycle_recent: cycleRecent,
  paste: () => void pasteFromClipboard(),
};

window.addEventListener(
  "keydown",
  (e) => {
    for (const [name, run] of Object.entries(ACTIONS)) {
      if (keys.is(e, name)) {
        e.preventDefault();
        run();
        return;
      }
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
// Undo from the delete toast: the note is back on disk, show it again.
void win.listen<{ id: string }>("note-restored", (e) => void load(e.payload.id));
void listen<{ from: string; to: string }>("note-renamed", (e) => {
  recentNotes.rename(e.payload.from, e.payload.to);
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
void win.listen("main-hiding", () => {
  void leave().then(() => {
    if (!current) setDraft();
  });
});
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
    applySettings(await applyTheme());
  } catch (e) {
    reportError(`Theme failed: ${String(e)}`);
  }
  watchTheme(applySettings);
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
  if (!note && !startFresh) {
    const list = await invoke<NoteMeta[]>("list_notes");
    if (list.length > 0) note = await invoke<Note>("get_note", { id: list[0].id });
  }
  if (note) setNote(note);
  else setDraft();
}

void boot()
  .catch((e) => reportError(`Startup failed: ${String(e)}`))
  .finally(() => requestAnimationFrame(() => void invoke("frontend_ready")));
