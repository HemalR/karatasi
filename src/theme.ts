import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Theme {
  name: string;
  mode: string;
  colors: Record<string, string>;
  font: string;
  font_size: number;
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

export async function applyTheme(): Promise<void> {
  const t = await invoke<Theme>("get_theme");
  const root = document.documentElement;
  for (const [cssVar, key, fallback] of MAP) {
    root.style.setProperty(cssVar, t.colors[key] ?? fallback);
  }
  root.style.setProperty("--font", `"${t.font}"`);
  root.style.setProperty("--font-size", `${t.font_size}px`);
  root.dataset.mode = t.mode;
}

export function watchTheme(): void {
  void listen("theme-changed", () => {
    void applyTheme();
  });
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
