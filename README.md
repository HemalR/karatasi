# Karatasi

**[karatasi.app](https://karatasi.app)**

Floating markdown notes for [Omarchy](https://omarchy.org), in the spirit of Raycast Notes. Karatasi
is Swahili for paper: somewhere to jot things down. A single small Tauri 2 binary with a TipTap
editor; every note is a plain markdown file in `~/Notes`.

Press Super N anywhere and a pinned, floating note appears over whatever you are doing. Press it
again and it is gone. Everything is a `.md` file, so your notes are grep-able, sync-able and yours.

## Install on Omarchy

```sh
sudo pacman -U https://karatasi.app/karatasi-$(uname -m).pkg.tar.zst
karatasi-setup
```

`uname -m` picks `karatasi-x86_64.pkg.tar.zst` on Intel and AMD machines and
`karatasi-aarch64.pkg.tar.zst` on Apple Silicon; both URLs redirect to the prebuilt package attached
to the [latest GitHub release](https://github.com/HemalR/karatasi/releases/latest), and pacman
resolves the dependencies (`webkit2gtk-4.1`, `gtk3`). To build the package yourself instead, run
`makepkg -si` in `packaging/`.

`karatasi-setup` adds one line to `~/.config/hypr/hyprland.lua` that loads the packaged bindings
and window rules (`/usr/share/karatasi/hypr/karatasi.lua`), reloads Hyprland and starts the
background instance. `karatasi-setup --remove` undoes it. To change the keys, set these before
that line:

```lua
karatasi_toggle_key = "SUPER + CTRL + ALT + SHIFT + N" -- Hyper N instead of the default Super N
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
| Anywhere | Super N                 | Show or hide the notes window                 |
| Anywhere | Super W                 | Hide the main window, close any other         |
| Anywhere | Super T                 | Tile the window (see below), or float again   |
| Editor   | Ctrl K / Ctrl P         | Search every note                             |
| Editor   | Ctrl N                  | New note                                      |
| Editor   | Ctrl Shift N            | New note in its own window                    |
| Editor   | Ctrl Enter              | Finish the line: tick a todo, strike anything else; again to reopen |
| Editor   | Ctrl Shift Enter        | Turn the line into a todo, or back            |
| Editor   | Ctrl Shift K            | Delete the line or list item                  |
| Editor   | Ctrl ↑ / Ctrl ↓         | Move the line or list item up / down          |
| Editor   | Ctrl [ / Ctrl ]         | Previous / next note                          |
| Editor   | Ctrl Tab               | Cycle recently opened notes                   |
| Editor   | Ctrl X                  | Delete the note (system trash; toast to undo) |
| Editor   | Shift Insert            | Paste from the clipboard (see Images)         |
| Editor   | Esc                     | Hide (main window) or close (any other)       |
| Search   | ↑ ↓ / Ctrl J Ctrl K     | Move selection                                |
| Search   | Enter / Shift Enter     | Open in this window / in a new window          |
| Search   | Ctrl Enter              | Create a note titled with the query           |

All editor and search keys can be changed in the config file (see Configuration).

Ctrl Tab follows the order notes were last opened in this window, rather than when their files
were modified. Press it again within one second to continue through older notes. After a pause
of one second or more, it switches back to the note you just left—so presses two seconds apart
toggle the same two notes. This history lasts until the window is closed; only notes opened in
that window are included.

Markdown shortcuts while typing: `- ` bullet, `1. ` numbered, `[] ` todo, `# ` heading, `---`
divider, `**bold**`, `` `code` ``. Ctrl B / Ctrl I / Ctrl Shift 8 / Ctrl Shift 7 / Ctrl Alt 1..3
also work. The first line is always the title, and the file is named after it.

### Images

Paste or drop an image and it is saved to `assets/` inside the notes folder, named after the note
(`assets/grocery-list-1758112321.png`), and linked from the note as `![](assets/...)`. That is a
plain relative markdown link, so any other markdown viewer shows the image too. Deleting a note
leaves its images behind.

Omarchy's clipboard manager and emoji picker deliver a pick by copying it and then sending
Shift Insert with `wtype`, a synthesized keypress the webview does not act on. Karatasi handles
that chord itself: it reads the clipboard with `wl-paste`, saving an image as above and pasting
text as Ctrl V would. Bind `paste` to another chord in the config to use it elsewhere.

## Windows and tiling

Super N always toggles a floating, pinned window that follows you across workspaces. If the main
window has been tiled with Super T, it stays where it is and becomes an ordinary note window (Esc
and Super W close it), and Super N spawns a fresh floating main with a new note.

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

# Every in-app shortcut, shown here with its default. A value is one chord or a list of chords:
# modifiers Ctrl, Shift, Alt, Super joined with "+", then one key (a letter, Backspace, Delete,
# Enter, Escape, Space, Up, Down...). Ctrl also accepts Cmd/Super. Setting a name replaces all of
# its defaults. Edits apply live.
[keys]
search = ["Ctrl+K", "Ctrl+P"]
new = "Ctrl+N"
new_window = "Ctrl+Shift+N"
done = "Ctrl+Enter"
todo = "Ctrl+Shift+Enter"
delete_block = ["Ctrl+Delete", "Ctrl+Shift+K"]
move_up = "Ctrl+Up"
move_down = "Ctrl+Down"
prev = "Ctrl+["
next = "Ctrl+]"
cycle_recent = "Ctrl+Tab"
delete = "Ctrl+X"
paste = "Shift+Insert"
hide = "Escape"
switcher_down = ["Down", "Ctrl+J", "Ctrl+N"]
switcher_up = ["Up", "Ctrl+K", "Ctrl+P"]
switcher_open = "Enter"
switcher_open_window = "Shift+Enter"
switcher_create = "Ctrl+Enter"
switcher_close = "Escape"
```

The toggle and close keys are Hyprland bindings and live in the Lua snippet above instead; the
formatting chords (Ctrl B, Ctrl I, ...) come from the editor and are fixed. Mind Omarchy's own
bindings when choosing chords: on an Apple keyboard Cmd is Super, and any chord Omarchy binds
itself (Super Shift Backspace toggles gaps, for example) is taken before Karatasi sees it.

A new note (Ctrl N, Ctrl Shift N, or the switcher with nothing typed) is a draft that lives only in
the editor; its file appears with the first keystroke, named after the title. A note you leave
untitled and empty (by switching away, hiding or closing the window) is removed again, so the notes
folder never collects blank files. Deleting a note with content sends it to the system trash
(`gio trash`, the same trash Nautilus shows) or, if that fails, removes it. A "Note deleted" toast
stays up for about five seconds; clicking it brings the note back.

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
- `site/` — the landing page at karatasi.app, static files; `scripts/deploy-site.sh` publishes them to Cloudflare Pages

## Packaging

`packaging/PKGBUILD` builds from a tagged GitHub release. `scripts/release.sh X.Y.Z` cuts one: it
bumps the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` and both
lockfiles, commits, tags `vX.Y.Z`, pushes, then pins the PKGBUILD to the tag with a real checksum
(`updpkgsums`), regenerates `packaging/.SRCINFO` and commits that too. Pushing the tag runs
`.github/workflows/release.yml`, which builds the package for `x86_64` and `aarch64` in Arch
containers and attaches `karatasi-X.Y.Z-1-<arch>.pkg.tar.zst` (plus fixed-name
`karatasi-<arch>.pkg.tar.zst` copies that the `karatasi.app/...pkg.tar.zst` URLs redirect to) to
the GitHub release. The PKGBUILD and
`.SRCINFO` are AUR-ready for when registrations reopen. To check the package builds locally, run
`makepkg -sf` in `packaging/`, or `extra-x86_64-build` from `devtools` for a clean chroot. For
iteration, `npm run tauri dev`.

## License

MIT.
