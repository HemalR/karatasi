import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ago, applyTheme, escapeHtml, watchTheme } from "./theme";

interface Hit {
  id: string;
  title: string;
  snippet: string;
  modified: number;
}
interface Note {
  id: string;
}

const win = getCurrentWindow();
const q = document.getElementById("q") as HTMLInputElement;
const list = document.getElementById("results")!;
const statusEl = document.getElementById("status")!;

let hits: Hit[] = [];
let sel = 0;
let seq = 0;
let openedAt = 0;

function terms(): string[] {
  return q.value.trim().split(/\s+/).filter(Boolean);
}

function highlight(text: string): string {
  const safe = escapeHtml(text);
  const t = terms();
  if (t.length === 0) return safe;
  const re = new RegExp(t.map((x) => escapeHtml(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  return safe.replace(re, (m) => `<mark>${m}</mark>`);
}

function showCreateRow(): boolean {
  const query = q.value.trim();
  return query !== "" && !hits.some((h) => h.title.toLowerCase() === query.toLowerCase());
}

function rowCount(): number {
  return hits.length + (showCreateRow() ? 1 : 0);
}

function render(): void {
  const rows = hits.map(
    (h, i) => `
    <li class="hit${i === sel ? " sel" : ""}" data-i="${i}">
      <div class="row"><span class="title">${highlight(h.title)}</span><span class="time">${ago(h.modified)}</span></div>
      <div class="snip">${highlight(h.snippet)}</div>
    </li>`,
  );
  if (showCreateRow()) {
    rows.push(
      `<li class="hit create${sel === hits.length ? " sel" : ""}" data-i="${hits.length}">
        <div class="row"><span class="title">Create “${escapeHtml(q.value.trim())}”</span><span class="time">Ctrl ⏎</span></div>
      </li>`,
    );
  }
  list.innerHTML = rows.join("");
  list.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  const n = hits.length;
  statusEl.textContent = q.value.trim() === "" ? `${n} note${n === 1 ? "" : "s"}` : n === 0 ? "No matches" : `${n} match${n === 1 ? "" : "es"}`;
}

async function refresh(): Promise<void> {
  const my = ++seq;
  const res = await invoke<Hit[]>("search_notes", { query: q.value, limit: 60 });
  if (my !== seq) return;
  hits = res;
  sel = 0;
  render();
}

async function create(): Promise<void> {
  const title = q.value.trim();
  const note = await invoke<Note>("create_note", { title: title || null });
  await invoke("open_in_main", { id: note.id });
}

async function choose(i: number, newWindow = false): Promise<void> {
  if (i >= hits.length) return create();
  const id = hits[i].id;
  if (newWindow) await invoke("open_note_window", { id });
  else await invoke("open_in_main", { id });
}

function move(delta: number): void {
  const n = rowCount();
  if (n === 0) return;
  sel = (sel + delta + n) % n;
  render();
}

q.addEventListener("input", () => void refresh());
q.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === "ArrowDown" || (ctrl && (e.key === "j" || e.key === "n"))) {
    e.preventDefault();
    move(1);
  } else if (e.key === "ArrowUp" || (ctrl && (e.key === "k" || e.key === "p"))) {
    e.preventDefault();
    move(-1);
  } else if (e.key === "Enter" && ctrl) {
    e.preventDefault();
    void create();
  } else if (e.key === "Enter") {
    e.preventDefault();
    void choose(sel, e.shiftKey);
  } else if (e.key === "Escape") {
    e.preventDefault();
    void invoke("hide_switcher");
  }
});

list.addEventListener("mousedown", (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>("li.hit");
  if (!li) return;
  e.preventDefault();
  void choose(Number(li.dataset.i), e.shiftKey);
});
list.addEventListener("mousemove", (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>("li.hit");
  if (!li) return;
  const i = Number(li.dataset.i);
  if (i !== sel) {
    sel = i;
    render();
  }
});

window.addEventListener("contextmenu", (e) => e.preventDefault());

void listen("switcher-open", () => {
  openedAt = Date.now();
  q.value = "";
  q.focus();
  void refresh();
});
void listen("notes-changed", () => void refresh());
void win.onFocusChanged(({ payload: focused }) => {
  // Dismiss when focus moves elsewhere, but ignore the blur that can precede our own show().
  if (!focused && Date.now() - openedAt > 400) void invoke("hide_switcher");
});

async function boot(): Promise<void> {
  await applyTheme();
  watchTheme();
  await refresh();
  q.focus();
}

void boot().finally(() => requestAnimationFrame(() => void invoke("frontend_ready")));
