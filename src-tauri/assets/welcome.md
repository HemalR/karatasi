# Welcome to Karatasi

Floating notes for Omarchy. Karatasi is Swahili for paper: somewhere to jot things down. Every note is a plain markdown file in `~/Notes`, and this one is too, so edit it or delete it.

## Keys

- **Super N** show or hide the notes window, from anywhere
- **Ctrl K** search every note
- **Ctrl N** new note
- **Ctrl Shift N** new note in its own window
- **Ctrl Enter** finish the line: tick a todo, strike through anything else; again to reopen it
- **Ctrl Shift Enter** turn the line into a todo, or back
- **Ctrl Shift K** delete the line or list item
- **Ctrl ↑** and **Ctrl ↓** move the line or list item up and down
- **Ctrl \[** and **Ctrl \]** previous and next note
- **Ctrl X** delete the note (it goes to the system trash; click the toast to undo)
- **Esc** or **Super W** hide the window
- **Super T** tile the window, **Super T** again to float it

Every key above except Super N and Super T can be changed under `[keys]` in `~/.config/karatasi/config.toml`, for example `delete = "Ctrl+D"`; the README lists the names. To toggle notes with a different key, put a line like this above the `dofile("/usr/share/karatasi/hypr/karatasi.lua")` line in `~/.config/hypr/hyprland.lua`, then reload Hyprland:

```lua
karatasi_toggle_key = "SUPER + ALT + N"
```

## Writing

Type `-` for a bullet, `1.` for a numbered list, `[]` for a todo, `#` for a heading and `---` for a divider. `**bold**` and `` `code` `` work as you type.

- [ ] Try ticking this
- [x] Already done

---

The first line is always the title, and the file is named after it.

## Windows

The main window floats, stays pinned above everything and follows you across workspaces. Tile it with Super T when you want it to live on one workspace instead. Super N then gives you a fresh floating note and leaves the tiled one alone. Ctrl Shift N opens a new note that matches the window you are in: floating and pinned, or tiled.

## Search

Ctrl K searches titles and contents. Enter opens the note here, Shift Enter opens it in its own window, and Ctrl Enter creates a note titled with what you typed.
