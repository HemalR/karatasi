import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Theme {
  name: string;
  mode: string;
  colors: Record<string, string>;
  font: string;
  font_size: number;
  keys: Record<string, string[]>;
}

// CSS variable, Omarchy colors.toml key, fallback (Matte Black).
const MAP: [string, string, string][] = [
  ["--bg", "background", "#121212"],
  ["--bg-dark", "dark_background", "#0d0d0d"],
  ["--bg-light", "lighter_background", "#1e1e1e"],
  ["--fg", "foreground", "#bebebe"],
  ["--fg-bright", "bright_foreground", "#eaeaea"],
  ["--fg-dim", "light_foreground", "#8a8a8d"],
  ["--fg-faint", "dark_foreground", "#555555"],
  ["--accent", "accent", "#e68e0d"],
  ["--selection", "selection", "#2a2a2a"],
  ["--muted", "muted", "#333333"],
  ["--red", "red", "#d35f5f"],
];

export async function applyTheme(): Promise<Theme> {
  const t = await invoke<Theme>("get_theme");
  const root = document.documentElement;
  for (const [cssVar, key, fallback] of MAP) {
    root.style.setProperty(cssVar, t.colors[key] ?? fallback);
  }
  root.style.setProperty("--font", `"${t.font}"`);
  root.style.setProperty("--font-size", `${t.font_size}px`);
  root.dataset.mode = t.mode;
  return t;
}

export function watchTheme(onChange?: (t: Theme) => void): void {
  void listen("theme-changed", () => {
    void applyTheme().then(onChange);
  });
}

// ---------- key chords from the config file ----------

export interface Chord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

const KEY_ALIASES: Record<string, string> = {
  backspace: "Backspace",
  bs: "Backspace",
  delete: "Delete",
  del: "Delete",
  enter: "Enter",
  return: "Enter",
  esc: "Escape",
  escape: "Escape",
  space: " ",
  tab: "Tab",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

/// Parse "Ctrl+Shift+Backspace" (also "ctrl shift backspace", "Super+D"). Null when there is no key.
export function parseChord(text: string): Chord | null {
  const chord: Chord = { ctrl: false, shift: false, alt: false, meta: false, key: "" };
  for (const raw of text.split(/[+\s]+/)) {
    const t = raw.trim().toLowerCase();
    if (t === "") continue;
    if (t === "ctrl" || t === "control") chord.ctrl = true;
    else if (t === "shift") chord.shift = true;
    else if (t === "alt" || t === "option") chord.alt = true;
    else if (t === "super" || t === "meta" || t === "cmd" || t === "win") chord.meta = true;
    else if (chord.key === "") chord.key = KEY_ALIASES[t] ?? (t.length === 1 ? t : raw.trim());
    else return null;
  }
  return chord.key === "" ? null : chord;
}

// Ctrl in a chord also accepts Cmd/Super, as every built-in editor shortcut does; "Super" in a
// chord means only that key.
export function chordMatches(e: KeyboardEvent, c: Chord): boolean {
  const ctrlOk = c.ctrl ? e.ctrlKey || e.metaKey : !e.ctrlKey;
  const metaOk = c.meta ? e.metaKey : c.ctrl || !e.metaKey;
  return ctrlOk && metaOk && e.shiftKey === c.shift && e.altKey === c.alt && e.key.toLowerCase() === c.key.toLowerCase();
}

const KEY_LABELS: Record<string, string> = {
  Backspace: "⌫",
  Delete: "Del",
  Enter: "⏎",
  Escape: "Esc",
  " ": "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/// "Ctrl ⇧ ⌫" style label for the hint bar.
export function chordLabel(c: Chord): string {
  const parts: string[] = [];
  if (c.ctrl) parts.push("Ctrl");
  if (c.meta) parts.push("Super");
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("⇧");
  parts.push(KEY_LABELS[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key));
  return parts.join(" ");
}

/// Named actions, each with one or more chords. Built from defaults plus the `[keys]` table in
/// the config file; a name the config sets replaces that action's defaults entirely.
export class Keymap {
  private chords = new Map<string, Chord[]>();

  constructor(defaults: Record<string, string[]>, overrides: Record<string, string[]> = {}) {
    for (const [name, list] of Object.entries(defaults)) this.set(name, list, true);
    for (const [name, list] of Object.entries(overrides)) {
      if (!(name in defaults)) {
        console.warn(`config [keys]: unknown action "${name}"`);
        continue;
      }
      if (!this.set(name, list, false)) this.set(name, defaults[name], true);
    }
  }

  private set(name: string, list: string[], trusted: boolean): boolean {
    const parsed: Chord[] = [];
    for (const text of list) {
      const c = parseChord(text);
      if (c) parsed.push(c);
      else if (!trusted) console.warn(`config [keys]: cannot read "${text}" for ${name}`);
    }
    if (parsed.length === 0) return false;
    this.chords.set(name, parsed);
    return true;
  }

  is(e: KeyboardEvent, name: string): boolean {
    return (this.chords.get(name) ?? []).some((c) => chordMatches(e, c));
  }

  /// Label of the first chord, for hint bars.
  label(name: string): string {
    const c = this.chords.get(name)?.[0];
    return c ? chordLabel(c) : "";
  }

  /// Two actions on one key cap, e.g. "Ctrl ↑ ↓" when they share modifiers, else "Ctrl ↑ / Alt ↓".
  labelPair(a: string, b: string): string {
    const ca = this.chords.get(a)?.[0];
    const cb = this.chords.get(b)?.[0];
    if (!ca || !cb) return this.label(a) || this.label(b);
    const sameMods = ca.ctrl === cb.ctrl && ca.shift === cb.shift && ca.alt === cb.alt && ca.meta === cb.meta;
    if (!sameMods) return `${chordLabel(ca)} / ${chordLabel(cb)}`;
    const la = chordLabel(ca);
    const lb = chordLabel(cb);
    return `${la} ${lb.slice(lb.lastIndexOf(" ") + 1)}`;
  }

  /// Fill every `<kbd data-key="name">` inside `root` with its chord label; `data-key-pair` adds a
  /// second action on the same cap.
  renderHints(root: ParentNode): void {
    for (const el of root.querySelectorAll<HTMLElement>("kbd[data-key]")) {
      const pair = el.dataset.keyPair;
      el.textContent = pair ? this.labelPair(el.dataset.key!, pair) : this.label(el.dataset.key!);
    }
  }
}

export function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)}d`;
  const dt = new Date(ms);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
