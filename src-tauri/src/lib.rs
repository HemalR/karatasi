mod store;
mod theme;

use std::{
    fs,
    io::{Read, Write},
    os::unix::net::{UnixListener, UnixStream},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::{http, AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use store::{Hit, Note, NoteMeta, Store};
use theme::Theme;

pub struct AppState {
    store: Mutex<Store>,
    /// Action given on the command line at launch (show, toggle, search, new, start, hide).
    initial: String,
    main_ready: Mutex<bool>,
    switcher_ready: Mutex<bool>,
    /// Label of the window Hyper N targets. Tiling the main window demotes it to a plain note
    /// window and a fresh floating main (`main-N`) takes over the role.
    main_label: Mutex<String>,
    main_gen: Mutex<u32>,
    /// Label of the editor window that was focused when the switcher opened. A pick replaces the
    /// note in that window, tiled or floating; with no such window the pick goes to the main.
    switcher_origin: Mutex<Option<String>>,
    /// Counter for draft note windows (`note-new-N`), which have no note id to name themselves after.
    note_gen: Mutex<u32>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

#[derive(Clone, Serialize)]
struct Renamed {
    from: String,
    to: String,
}

#[derive(Clone, Serialize)]
struct Changed {
    id: String,
}

fn last_note_path() -> PathBuf {
    dirs::state_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".local/state"))
        .join("karatasi/last-note")
}

/// The onboarding note, written on first run so an empty notes folder is never a blank screen.
const WELCOME: &str = include_str!("../assets/welcome.md");

fn open_store() -> Store {
    let mut store = Store::open(notes_dir());
    if store.list().is_empty() {
        let _ = fs::write(store.path_of("welcome-to-karatasi"), WELCOME);
        store.reload_all();
    }
    store
}

fn notes_dir() -> PathBuf {
    theme::config()
        .notes_dir
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join("Notes"))
}

// ---------- commands ----------

#[tauri::command]
fn list_notes(state: State<AppState>) -> Vec<NoteMeta> {
    state.store.lock().unwrap().list()
}

#[tauri::command]
fn get_note(state: State<AppState>, id: String) -> Result<Note, String> {
    state.store.lock().unwrap().get(&id).ok_or_else(|| format!("no note {id}"))
}

/// A titled note from the switcher's "Create" row. Blank notes are never created on disk; an
/// editor draft becomes a file on its first save (`save_note` without an id).
#[tauri::command]
fn create_note(app: AppHandle, state: State<AppState>, title: String) -> Result<Note, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("a new note needs a title".to_string());
    }
    let note = state.store.lock().unwrap().create(&format!("# {title}\n\n"))?;
    let _ = app.emit("notes-changed", Changed { id: note.id.clone() });
    Ok(note)
}

/// Write a note; without an id, create its file (a draft's first save).
#[tauri::command]
fn save_note(app: AppHandle, state: State<AppState>, id: Option<String>, content: String) -> Result<Note, String> {
    let note = match &id {
        Some(id) => state.store.lock().unwrap().save(id, &content)?,
        None => state.store.lock().unwrap().create(&content)?,
    };
    if let Some(from) = id.filter(|from| *from != note.id) {
        let _ = app.emit("note-renamed", Renamed { from, to: note.id.clone() });
    }
    let _ = app.emit("notes-changed", Changed { id: note.id.clone() });
    Ok(note)
}

/// Drop an untitled, empty note the editor is leaving behind. Does nothing to a note with content.
#[tauri::command]
fn discard_note(app: AppHandle, state: State<AppState>, id: String) -> Result<bool, String> {
    let gone = state.store.lock().unwrap().discard_blank(&id)?;
    if gone {
        let _ = app.emit("notes-changed", Changed { id });
    }
    Ok(gone)
}

/// Delete a note and offer to undo it from a system toast. The note is held in memory for as long
/// as the toast is up; clicking it writes the note back and reopens it in the window that deleted it.
#[tauri::command]
fn delete_note(app: AppHandle, state: State<AppState>, window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    let note = state.store.lock().unwrap().delete(&id)?;
    let _ = app.emit("notes-changed", Changed { id });
    let label = window.label().to_string();
    std::thread::spawn(move || {
        if undo_toast(&note.title) {
            let restored = app.state::<AppState>().store.lock().unwrap().restore(&note);
            if let Ok(restored) = restored {
                let _ = app.emit("notes-changed", Changed { id: restored.id.clone() });
                let _ = app.emit_to(&label, "note-restored", Changed { id: restored.id });
            }
        }
    });
    Ok(())
}

/// Show "Note deleted" with click-to-undo and block until the toast is clicked or gone. Returns
/// true on undo. The Omarchy shell (and mako, dunst) invoke the "default" action on click and keep
/// a low-urgency toast up for about five seconds; libnotify then prints the action's id.
fn undo_toast(title: &str) -> bool {
    let out = std::process::Command::new("notify-send")
        .args(["-a", "Karatasi", "-i", "karatasi", "-u", "low", "-t", "5000", "-e", "-A", "default=Undo"])
        .arg("Note deleted")
        .arg(format!("{title} · click to undo"))
        .output();
    match out {
        Ok(out) => String::from_utf8_lossy(&out.stdout).trim() == "default",
        Err(_) => false,
    }
}

#[tauri::command]
fn search_notes(state: State<AppState>, query: String, limit: Option<usize>) -> Vec<Hit> {
    state.store.lock().unwrap().search(&query, limit.unwrap_or(40))
}

/// A pasted or dropped image file: the bytes come as the raw request body, the note's title
/// (percent-encoded, headers being ASCII) and the mime type as headers. Returns the path to link to.
#[tauri::command]
fn save_attachment(state: State<AppState>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".to_string());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("");
    let title = percent_decode_str(header("x-title")).decode_utf8_lossy();
    let ext = ext_of(header("x-type")).ok_or_else(|| format!("not an image type: {}", header("x-type")))?;
    state.store.lock().unwrap().attach(&title, ext, bytes)
}

/// What is on the system clipboard, read with `wl-paste`. The webview ignores a synthesized paste
/// keypress, which is how Omarchy's clipboard manager and emoji picker deliver a pick (they copy,
/// then send Shift+Insert with wtype), so the editor's `paste` chord comes here instead. An image
/// is saved like a pasted file; text goes back for the editor's own paste pipeline.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Clipboard {
    Image { path: String },
    Text { text: String },
    Empty,
}

#[tauri::command]
fn read_clipboard(state: State<AppState>, title: String) -> Result<Clipboard, String> {
    let types = String::from_utf8_lossy(&wl_paste(&["--list-types"])?).into_owned();
    if let Some((mime, ext)) = types.lines().find_map(|t| ext_of(t).map(|ext| (t, ext))) {
        let bytes = wl_paste(&["--type", mime])?;
        let path = state.store.lock().unwrap().attach(&title, ext, &bytes)?;
        return Ok(Clipboard::Image { path });
    }
    if types.lines().any(|t| t.starts_with("text/")) {
        let text = String::from_utf8_lossy(&wl_paste(&["--no-newline"])?).into_owned();
        return Ok(Clipboard::Text { text });
    }
    Ok(Clipboard::Empty)
}

/// An empty clipboard is not an error: `wl-paste` exits 1 with nothing on stdout, which reads as no types.
fn wl_paste(args: &[&str]) -> Result<Vec<u8>, String> {
    let out = std::process::Command::new("wl-paste").args(args).output().map_err(|e| format!("wl-paste: {e}"))?;
    Ok(out.stdout)
}

/// `note-asset://localhost/assets/x.png` serves that file from the notes dir. A note links its
/// images relative to itself, which the webview (served from its own origin) could not load
/// otherwise; the editor swaps in this scheme when rendering (see `NoteImage` in main.ts).
fn serve_asset(app: &AppHandle, request: &http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let rel = percent_decode_str(request.uri().path().trim_start_matches('/')).decode_utf8_lossy();
    let rel = Path::new(rel.as_ref());
    // Plain names below the notes dir only: no absolute paths, no `..`.
    let safe = rel.components().all(|c| matches!(c, Component::Normal(_)));
    let dir = app.state::<AppState>().store.lock().unwrap().dir.clone();
    let data = if safe { fs::read(dir.join(rel)).ok() } else { None };
    match data {
        Some(data) => http::Response::builder()
            .header(http::header::CONTENT_TYPE, mime_of(rel))
            .body(data)
            .unwrap(),
        None => http::Response::builder().status(http::StatusCode::NOT_FOUND).body(Vec::new()).unwrap(),
    }
}

/// Image types a note can hold, as (mime type, file extension).
const IMAGE_TYPES: [(&str, &str); 7] = [
    ("image/png", "png"),
    ("image/jpeg", "jpg"),
    ("image/gif", "gif"),
    ("image/webp", "webp"),
    ("image/svg+xml", "svg"),
    ("image/bmp", "bmp"),
    ("image/avif", "avif"),
];

fn ext_of(mime: &str) -> Option<&'static str> {
    IMAGE_TYPES.iter().find(|(m, _)| *m == mime).map(|(_, ext)| *ext)
}

fn mime_of(path: &Path) -> &'static str {
    let ext = match path.extension().and_then(|e| e.to_str()) {
        Some("jpeg") => "jpg",
        Some(ext) => ext,
        None => "",
    };
    IMAGE_TYPES.iter().find(|(_, e)| *e == ext).map(|(mime, _)| *mime).unwrap_or("application/octet-stream")
}

/// Debug aid: with KARATASI_DEBUG=1 in the environment, dump text to $XDG_RUNTIME_DIR/karatasi-debug-<name>.txt.
#[tauri::command]
fn debug_dump(name: String, text: String) {
    if std::env::var_os("KARATASI_DEBUG").is_none() {
        return;
    }
    let path = dirs::runtime_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(format!("karatasi-debug-{}.txt", store::slug(&name)));
    let _ = fs::write(path, text);
}

#[tauri::command]
fn get_theme() -> Theme {
    theme::load()
}

#[tauri::command]
fn get_notes_dir(state: State<AppState>) -> String {
    state.store.lock().unwrap().dir.to_string_lossy().to_string()
}

#[tauri::command]
fn get_last_note() -> Option<String> {
    fs::read_to_string(last_note_path())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[tauri::command]
fn set_last_note(id: String) {
    let path = last_note_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, id);
}

#[tauri::command]
fn show_switcher(app: AppHandle) {
    open_switcher(&app);
}

#[tauri::command]
fn hide_switcher(app: AppHandle) {
    if let Some(w) = app.get_webview_window("switcher") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) {
    let _ = window.hide();
}

/// The editor window a switcher pick lands in: the one the switcher was opened from, if it is still
/// around, else the (floating) main. `None` means a fresh main just took the note itself.
fn switcher_target(app: &AppHandle, note: Option<&str>) -> Option<tauri::WebviewWindow> {
    let origin = app.state::<AppState>().switcher_origin.lock().unwrap().clone();
    if let Some(w) = origin.and_then(|label| app.get_webview_window(&label)) {
        return Some(w);
    }
    match floating_main(app, note) {
        Some((w, false)) => Some(w),
        _ => None,
    }
}

/// Open a note in the editor window the switcher came from (used by the switcher).
#[tauri::command]
fn open_in_main(app: AppHandle, id: String) {
    if let Some(w) = switcher_target(&app, Some(&id)) {
        let _ = w.emit_to(w.label(), "open-note", Changed { id });
        let _ = w.show();
        let _ = w.set_focus();
    }
    hide_switcher(app);
}

/// A fresh draft in the editor window the switcher came from (used by the switcher when there is no
/// title to create with).
#[tauri::command]
fn new_in_main(app: AppHandle) {
    if let Some(w) = switcher_target(&app, None) {
        let _ = w.emit_to(w.label(), "new-note", ());
        let _ = w.show();
        let _ = w.set_focus();
    }
    hide_switcher(app);
}

/// Open a note in its own floating window.
#[tauri::command]
fn open_note_window(app: AppHandle, id: String) -> Result<(), String> {
    let label = format!("note-{}", store::slug(&id));
    build_note_window(&app, &label, &format!("index.html?note={}", urlencode(&id)), "Karatasi")?;
    hide_switcher(app);
    Ok(())
}

/// Ctrl Shift N: a new note in its own window, matching the window it was pressed in. From a
/// floating note the new window floats and pins (by window rule) and the old one is unpinned so it
/// stays on this workspace; from a tiled note the new window tiles too.
#[tauri::command]
fn open_new_note_window(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let tiled = hypr_active_is_tiled_window();
    if !tiled {
        hypr_dispatch("hl.dsp.window.pin({ action = \"off\" })");
    }
    // The window opens on a draft; its file appears once something is typed.
    let n = {
        let mut gen = state.note_gen.lock().unwrap();
        *gen += 1;
        *gen
    };
    // "Karatasi Tiled" dodges the float rule; the window retitles itself to "Karatasi - <note>" on load.
    build_note_window(&app, &format!("note-new-{n}"), "index.html?new=1", if tiled { "Karatasi Tiled" } else { "Karatasi" })
}

/// No window has a minimum size. Hyprland can tile a window narrower than any minimum, and GTK
/// then keeps the buffer at the minimum while Hyprland squeezes it into the tile: the text shrinks
/// and every click lands left of the character under the pointer.
fn build_note_window(app: &AppHandle, label: &str, url: &str, title: &str) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(760.0, 560.0)
        .decorations(false)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// The frontend has painted. Windows start visible because WebKitGTK does not run a page in an
/// unrealized window; on the first ready of each window, apply the launch action (which may hide it).
#[tauri::command]
fn frontend_ready(app: AppHandle, state: State<AppState>, window: tauri::WebviewWindow) {
    match window.label() {
        "main" => {
            let mut done = state.main_ready.lock().unwrap();
            if *done {
                let _ = window.show();
                return;
            }
            *done = true;
            match state.initial.as_str() {
                "start" | "hide" | "search" => {
                    let _ = window.hide();
                }
                "new" => {
                    show_main(&app);
                    let _ = window.emit_to(window.label(), "new-note", ());
                }
                _ => show_main(&app),
            }
        }
        "switcher" => {
            let mut done = state.switcher_ready.lock().unwrap();
            if *done {
                return;
            }
            *done = true;
            if state.initial == "search" {
                open_switcher(&app);
            } else {
                let _ = window.hide();
            }
        }
        _ => {}
    }
}

fn urlencode(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c.to_string()
            } else {
                c.to_string()
                    .bytes()
                    .map(|b| format!("%{b:02X}"))
                    .collect()
            }
        })
        .collect()
}

// ---------- window actions ----------

fn open_switcher(app: &AppHandle) {
    // Remember which editor window the switcher was called up from, so a pick replaces its note.
    let origin = app
        .webview_windows()
        .into_values()
        .find(|w| w.label() != "switcher" && w.is_focused().unwrap_or(false))
        .map(|w| w.label().to_string());
    *app.state::<AppState>().switcher_origin.lock().unwrap() = origin;
    if let Some(w) = app.get_webview_window("switcher") {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit_to(w.label(), "switcher-open", ());
    }
}

fn main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let label = app.state::<AppState>().main_label.lock().unwrap().clone();
    app.get_webview_window(&label)
}

/// Whether Hyprland currently has the main window tiled. Karatasi windows can only be told apart by
/// title: the main is the one titled exactly "Karatasi", every other editor window carries its note's
/// title. Anything unexpected (no Hyprland, no hyprctl) counts as floating.
fn main_is_tiled() -> bool {
    let Ok(out) = std::process::Command::new("hyprctl").args(["clients", "-j"]).output() else {
        return false;
    };
    let Ok(clients) = serde_json::from_slice::<serde_json::Value>(&out.stdout) else {
        return false;
    };
    clients
        .as_array()
        .map(|cs| cs.iter().any(|c| c["class"] == "karatasi" && c["title"] == "Karatasi" && c["floating"] == false))
        .unwrap_or(false)
}

fn hypr_dispatch(lua: &str) {
    let _ = std::process::Command::new("hyprctl").args(["dispatch", lua]).output();
}

/// Whether the focused Hyprland window is a tiled Karatasi window (a keystroke in Karatasi comes from the
/// focused window). Unknown counts as floating.
fn hypr_active_is_tiled_window() -> bool {
    let Ok(out) = std::process::Command::new("hyprctl").args(["activewindow", "-j"]).output() else {
        return false;
    };
    let Ok(c) = serde_json::from_slice::<serde_json::Value>(&out.stdout) else {
        return false;
    };
    c["class"] == "karatasi" && c["floating"] == false
}

/// Spawn a fresh floating main window, opening `note` or a new note, and hand it the main role.
fn spawn_main(app: &AppHandle, note: Option<&str>) -> tauri::Result<tauri::WebviewWindow> {
    let state = app.state::<AppState>();
    let n = {
        let mut gen = state.main_gen.lock().unwrap();
        *gen += 1;
        *gen
    };
    let label = format!("main-{n}");
    let url = match note {
        Some(id) => format!("index.html?note={}", urlencode(id)),
        None => "index.html?new=1".to_string(),
    };
    let w = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("Karatasi")
        .inner_size(960.0, 720.0)
        .decorations(false)
        .center()
        .build()?;
    *state.main_label.lock().unwrap() = label;
    Ok(w)
}

/// The window Hyper N targets. A tiled main is left where it is (it becomes a plain note window)
/// and a fresh floating main takes its place; `true` means that just happened, in which case the
/// new window shows itself and already opens `note` (or a new note), so the caller is done.
fn floating_main(app: &AppHandle, note: Option<&str>) -> Option<(tauri::WebviewWindow, bool)> {
    let w = main_window(app)?;
    if w.is_visible().unwrap_or(false) && main_is_tiled() {
        let _ = w.emit_to(w.label(), "demoted", ());
        if let Ok(fresh) = spawn_main(app, note) {
            return Some((fresh, true));
        }
    }
    Some((w, false))
}

fn show_main(app: &AppHandle) {
    if let Some((w, false)) = floating_main(app, None) {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit_to(w.label(), "main-shown", ());
    }
}

fn toggle_main(app: &AppHandle) {
    if let Some((w, false)) = floating_main(app, None) {
        let visible = w.is_visible().unwrap_or(false);
        let focused = w.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = w.emit_to(w.label(), "main-hiding", ());
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
            let _ = w.emit_to(w.label(), "main-shown", ());
        }
    }
}

fn handle_action(app: &AppHandle, action: &str) {
    match action {
        "toggle" => toggle_main(app),
        // Super W: the focused Karatasi window decides for itself (main hides, a note window closes).
        // Without a focused window, fall back to hiding the main and the switcher.
        "hide" => {
            let focused = app.webview_windows().into_values().find(|w| w.is_focused().unwrap_or(false));
            match focused {
                Some(w) if w.label() == "switcher" => hide_switcher(app.clone()),
                Some(w) => {
                    let _ = w.emit_to(w.label(), "close-request", ());
                }
                None => {
                    if let Some(w) = main_window(app) {
                        let _ = w.emit_to(w.label(), "main-hiding", ());
                        let _ = w.hide();
                    }
                    hide_switcher(app.clone());
                }
            }
        }
        "search" => open_switcher(app),
        "new" => {
            if let Some((w, false)) = floating_main(app, None) {
                let _ = w.show();
                let _ = w.set_focus();
                let _ = w.emit_to(w.label(), "new-note", ());
            }
        }
        "start" => {}
        _ => show_main(app),
    }
}

fn action_from_args(args: &[String]) -> String {
    args.iter()
        .skip(1)
        .find(|a| !a.starts_with('-'))
        .cloned()
        .unwrap_or_else(|| "show".to_string())
}

// ---------- single instance over a unix socket ----------

fn socket_path() -> PathBuf {
    dirs::runtime_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("karatasi.sock")
}

/// Hand the action to an already running instance. Returns false when there is none.
fn send_to_running(action: &str) -> bool {
    let Ok(mut stream) = UnixStream::connect(socket_path()) else { return false };
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    if stream.write_all(action.as_bytes()).is_err() {
        return false;
    }
    let _ = stream.shutdown(std::net::Shutdown::Write);
    let mut ack = [0u8; 2];
    let _ = stream.read(&mut ack);
    true
}

fn serve_actions(app: AppHandle) -> std::io::Result<()> {
    let path = socket_path();
    if path.exists() && UnixStream::connect(&path).is_err() {
        let _ = fs::remove_file(&path);
    }
    let listener = UnixListener::bind(&path)?;
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            let mut buf = String::new();
            if stream.read_to_string(&mut buf).is_err() {
                continue;
            }
            let action = buf.trim().to_string();
            let handle = app.clone();
            // Window calls must run on the GTK main thread; run_on_main_thread queues them there.
            let _ = app.run_on_main_thread(move || handle_action(&handle, &action));
            let _ = stream.write_all(b"ok");
        }
    });
    Ok(())
}

// ---------- memory cap ----------

/// Re-exec the primary inside a transient systemd scope with a hard memory limit, so a runaway
/// leak can only ever kill Karatasi, never the session. Returns true when the child ran in our place.
fn relaunch_in_capped_scope(args: &[String]) -> bool {
    if std::env::var_os("KARATASI_SCOPED").is_some() {
        return false;
    }
    let Ok(exe) = std::env::current_exe() else { return false };
    let cap = std::env::var("KARATASI_MEMORY_MAX").unwrap_or_else(|_| "1500M".to_string());
    let status = std::process::Command::new("systemd-run")
        .args([
            "--user",
            "--scope",
            "--quiet",
            "--collect",
            "--slice=app-graphical.slice",
            "--description=karatasi",
            &format!("-pMemoryMax={cap}"),
            "-pMemorySwapMax=0",
            "--setenv=KARATASI_SCOPED=1",
            "--",
        ])
        .arg(exe)
        .args(args.iter().skip(1))
        .status();
    match status {
        Ok(_) => true,
        Err(e) => {
            eprintln!("karatasi: systemd-run unavailable ({e}); running without a memory cap");
            false
        }
    }
}

// ---------- file watching ----------

fn start_watcher(app: AppHandle) -> notify::Result<RecommendedWatcher> {
    let dir = notes_dir();
    let state_dir = theme::state_dir();
    let handle = app.clone();
    let last_theme_emit = Mutex::new(std::time::Instant::now() - Duration::from_secs(10));
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        // Only real changes. Reads must be ignored: reacting to them re-reads the file, which is
        // itself an event, and the loop saturates the main thread and allocates without bound.
        let kind = &event.kind;
        if !(kind.is_modify() || kind.is_create() || kind.is_remove()) {
            return;
        }
        for path in event.paths {
            let is_config = path == theme::config_path();
            if is_config || path.file_name().map(|n| n == "theme.name" || n == "font.name").unwrap_or(false) {
                let mut last = last_theme_emit.lock().unwrap();
                if last.elapsed() > Duration::from_millis(300) {
                    *last = std::time::Instant::now();
                    let _ = handle.emit("theme-changed", ());
                }
                continue;
            }
            let state = handle.state::<AppState>();
            let id = state.store.lock().unwrap().reload_one(&path);
            if let Some(id) = id {
                let _ = handle.emit("notes-changed", Changed { id });
            }
        }
    })?;
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;
    let _ = watcher.watch(&state_dir, RecursiveMode::NonRecursive);
    // Editing ~/.config/karatasi/config.toml re-applies font and keys without a restart.
    if let Some(config_dir) = theme::config_path().parent() {
        let _ = fs::create_dir_all(config_dir);
        let _ = watcher.watch(config_dir, RecursiveMode::NonRecursive);
    }
    Ok(watcher)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let initial = action_from_args(&args);
    if send_to_running(&initial) {
        return;
    }
    if relaunch_in_capped_scope(&args) {
        return;
    }

    tauri::Builder::default()
        .manage(AppState {
            store: Mutex::new(open_store()),
            initial,
            main_ready: Mutex::new(false),
            switcher_ready: Mutex::new(false),
            switcher_origin: Mutex::new(None),
            main_label: Mutex::new("main".to_string()),
            main_gen: Mutex::new(0),
            note_gen: Mutex::new(0),
            watcher: Mutex::new(None),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(e) = serve_actions(handle.clone()) {
                eprintln!("karatasi: could not listen on {}: {e}", socket_path().display());
            }
            match start_watcher(handle.clone()) {
                Ok(w) => *app.state::<AppState>().watcher.lock().unwrap() = Some(w),
                Err(e) => eprintln!("karatasi: file watcher unavailable: {e}"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            get_note,
            create_note,
            save_note,
            delete_note,
            discard_note,
            search_notes,
            save_attachment,
            read_clipboard,
            get_theme,
            debug_dump,
            get_notes_dir,
            get_last_note,
            set_last_note,
            show_switcher,
            hide_switcher,
            hide_window,
            open_in_main,
            new_in_main,
            open_note_window,
            open_new_note_window,
            frontend_ready
        ])
        .register_uri_scheme_protocol("note-asset", |ctx, request| serve_asset(ctx.app_handle(), &request))
        .run(tauri::generate_context!())
        .expect("error while running karatasi");
}
