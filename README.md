# Karatasi

Floating markdown notes for [Omarchy](https://omarchy.org), in the spirit of Raycast Notes. Karatasi
is Swahili for paper: somewhere to jot things down. A single small Tauri 2 binary with a TipTap
editor; every note is a plain markdown file in `~/Notes`.

Press Hyper N anywhere and a pinned, floating note appears over whatever you are doing. Press it
again and it is gone. Everything is a `.md` file, so your notes are grep-able, sync-able and yours.

## Install on Omarchy

```sh
omarchy pkg aur add karatasi
karatasi-setup
```

`karatasi-setup` adds one line to `~/.config/hypr/hyprland.lua` that loads the packaged bindings
and window rules (`/usr/share/karatasi/hypr/karatasi.lua`), reloads Hyprland and starts the
background instance. `karatasi-setup --remove` undoes it. To change the keys, set these before
that line:

```lua
karatasi_toggle_key = "SUPER + CTRL + ALT + SHIFT + N" -- Hyper N
karatasi_close_key = "SUPER + W"                      -- false to leave Omarchy's close key alone
karatasi_autostart = true
```

### From source

`scripts/install.sh` builds the frontend and the binary, installs `~/.local/bin/karatasi` and
restarts the background instance. Then load `packaging/karatasi.lua` from your `hyprland.lua`
with `dofile` (the binary has to be on Hyprland's `PATH`, or edit the paths in a copy).

## Keys

| Where    | Key                     | Action                                        |
| -------- | ----------------------- | --------------------------------------------- |
| Anywhere | Hyper N                 | Show or hide the notes window                 |
| Anywhere | Super W                 | Hide the main window, close any other         |
| Anywhere | Super T                 | Tile the window (see below), or float again   |
| Editor   | Ctrl K / Ctrl P         | Search every note                             |
| Editor   | Ctrl N                  | New note                                      |
| Editor   | Ctrl Shift N            | New note in its own window                    |
| Editor   | Ctrl Enter              | Turn the line into a todo, or tick it         |
| Editor   | Ctrl [ / Ctrl ]         | Previous / next note                          |
| Editor   | Ctrl Shift Backspace ×2 | Delete the note (moved to `~/Notes/.trash`)   |
| Editor   | Esc                     | Hide (main window) or close (any other)       |
| Search   | ↑ ↓ / Ctrl J Ctrl K     | Move selection                                |
| Search   | Enter / Shift Enter     | Open in the main window / in a new window     |
| Search   | Ctrl Enter              | Create a note titled with the query           |

Markdown shortcuts while typing: `- ` bullet, `1. ` numbered, `[] ` todo, `# ` heading, `---`
divider, `**bold**`, `` `code` ``. Ctrl B / Ctrl I / Ctrl Shift 8 / Ctrl Shift 7 / Ctrl Alt 1..3
also work. The first line is always the title, and the file is named after it.

## Windows and tiling

Hyper N always toggles a floating, pinned window that follows you across workspaces. If the main
window has been tiled with Super T, it stays where it is and becomes an ordinary note window (Esc
and Super W close it), and Hyper N spawns a fresh floating main with a new note.

Ctrl Shift N matches the window it is pressed in: from a floating note the new window floats and
pins and the old one is unpinned so it stays put; from a tiled note the new window is tiled too.

Karatasi finds its main window in Hyprland's client list by its exact title `Karatasi`; every
other editor window is titled `Karatasi - <note title>` (a tiled spawn starts as `Karatasi Tiled`
until the note loads). The window rules in `packaging/karatasi.lua` match on those titles.

## Command line

`karatasi [show|toggle|hide|search|new|start]`. A second invocation forwards the action to the
running instance over a unix socket, so the Hyprland binding simply calls `karatasi toggle`.
`karatasi start` launches it hidden, which is how it autostarts.

## Configuration

Optional `~/.config/karatasi/config.toml`:

```toml
notes_dir = "~/Notes"
font = "Adwaita Sans"   # defaults to the Omarchy font
font_size = 16
```

Colors follow the active Omarchy theme (`~/.local/state/omarchy/current/theme/colors.toml`) and
update live when the theme changes. Window placement (float, pin, center, size, opacity) is
Hyprland's job, in `packaging/karatasi.lua`.

## Safety

The primary instance re-executes itself inside a transient systemd scope with `MemoryMax=1500M`
and `MemorySwapMax=0` (override the cap with `KARATASI_MEMORY_MAX`). A runaway leak can therefore
only kill Karatasi, never the session. The first build did exactly that: a file-watcher feedback
loop on the Omarchy theme file grew to 18 GB and the OOM killer took Hyprland down with it. Set
`KARATASI_DEBUG=1` to have the editor dump its HTML to `$XDG_RUNTIME_DIR/karatasi-debug-html.txt`
on every note load.

## Layout

- `src-tauri/src/lib.rs` — commands, window actions, single-instance argv handling, file watcher
- `src-tauri/src/store.rs` — markdown note store, slug renaming, fuzzy + content search
- `src-tauri/src/theme.rs` — Omarchy theme and `config.toml` reading
- `src-tauri/assets/welcome.md` — the onboarding note, written when the notes folder is empty
- `src/main.ts` — editor window (TipTap, autosave, keys)
- `src/switcher.ts` — search window
- `src/styles.css` — all styling, driven by CSS variables from the theme
- `packaging/` — PKGBUILD, desktop entry, Hyprland integration and the `karatasi-setup` script

## Packaging

`packaging/PKGBUILD` builds from a tagged GitHub release. To publish a version: bump `version` in
`package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, tag `vX.Y.Z`, update
`pkgver` and run `updpkgsums` in `packaging/`, then push the PKGBUILD and its `.SRCINFO`
(`makepkg --printsrcinfo > .SRCINFO`) to the AUR. For iteration, `npm run tauri dev`.

## License

MIT.
