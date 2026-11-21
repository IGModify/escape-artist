//! Native shell: windows (overlay / windowed), hotkeys, click-through, file access,
//! game log tailing and screenshot watching. Everything else lives in the UI (src/).

mod history;
mod logs;
mod paths;
mod settings;

use notify::{EventKind, RecursiveMode, Watcher};
use serde_json::Value;
use settings::{Bounds, Settings};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, RunEvent, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

struct AppState {
    data_dir: PathBuf,
    settings: Mutex<Settings>,
    log_generation: Arc<AtomicU64>,
    screenshot_watcher: Mutex<Option<notify::RecommendedWatcher>>,
    /// The folder being watched; screenshot_delete only touches files directly inside it.
    screenshot_dir: Mutex<Option<PathBuf>>,
}

const MAIN: &str = "main";

// ---------- window modes ----------

fn default_bounds(overlay: bool) -> Bounds {
    if overlay {
        Bounds { x: 1460.0, y: 100.0, width: 420.0, height: 640.0 }
    } else {
        Bounds { x: 80.0, y: 60.0, width: 1100.0, height: 760.0 }
    }
}

/// One window serves both modes: it is created transparent, and windowed mode simply
/// paints an opaque background and turns the frame back on. No restart, no reload.
/// Must be called without holding the settings lock: resizing fires window events
/// synchronously, and those record the new bounds (which takes the lock).
fn apply_mode(win: &WebviewWindow, overlay: bool, click_through: bool, b: Bounds) {
    let _ = win.set_decorations(!overlay);
    let _ = win.set_shadow(!overlay);
    let _ = win.set_always_on_top(overlay);
    let _ = win.set_ignore_cursor_events(click_through);
    let _ = win.set_size(LogicalSize::new(b.width, b.height));
    let _ = win.set_position(LogicalPosition::new(b.x, b.y));
}

fn remember_bounds(win: &WebviewWindow, state: &AppState) {
    if win.is_minimized().unwrap_or(false) {
        return;
    }
    let (Ok(pos), Ok(size), Ok(scale)) = (win.outer_position(), win.inner_size(), win.scale_factor()) else { return };
    let pos = pos.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);
    state.settings.lock().unwrap().set_bounds(Bounds { x: pos.x, y: pos.y, width: size.width, height: size.height });
}

/// Applies a settings change from the UI or a hotkey: saves, updates the window, tells the UI.
fn change_settings(app: &AppHandle, patch: Value) -> Value {
    let state = app.state::<AppState>();
    let win = app.get_webview_window(MAIN);
    let mode_changes = patch.get("mode").is_some_and(|m| *m != state.settings.lock().unwrap().value["mode"]);
    if mode_changes {
        if let Some(w) = &win {
            remember_bounds(w, &state); // keep the old mode's position
        }
    }
    let (value, overlay, click, bounds) = {
        let mut s = state.settings.lock().unwrap();
        s.patch(patch.clone());
        if mode_changes {
            s.patch(serde_json::json!({ "clickThrough": false }));
        }
        s.save();
        let overlay = s.overlay();
        (s.value.clone(), overlay, s.click_through(), s.bounds().unwrap_or_else(|| default_bounds(overlay)))
    }; // lock released before touching the window
    if let Some(w) = &win {
        if mode_changes {
            apply_mode(w, overlay, click, bounds);
        } else if patch.get("clickThrough").is_some() {
            let _ = w.set_ignore_cursor_events(click);
        }
    }
    let _ = app.emit("settings", &value);
    value
}

/// While the game has focus the overlay is just a picture: let WebView2 trim its memory.
/// Back to normal as soon as the user clicks into the app, so interaction stays snappy.
#[cfg(windows)]
fn set_low_memory(win: &WebviewWindow, low: bool) {
    let _ = win.with_webview(move |wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows::core::Interface;
        let Ok(core) = wv.controller().CoreWebView2() else { return };
        let Ok(core) = core.cast::<ICoreWebView2_19>() else { return }; // older runtime: skip
        let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
        let _ = core.SetMemoryUsageTargetLevel(level);
    });
}

#[cfg(not(windows))]
fn set_low_memory(_: &WebviewWindow, _: bool) {}

// ---------- commands ----------

#[tauri::command]
fn settings_get(state: State<AppState>) -> Value {
    state.settings.lock().unwrap().value.clone()
}

#[tauri::command]
fn settings_set(app: AppHandle, patch: Value) -> Value {
    change_settings(&app, patch)
}

/// Only plain relative paths inside the app's folder ("cache/raw/tasks.json").
fn safe_join(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.components().all(|c| matches!(c, Component::Normal(_))) {
        Ok(base.join(p))
    } else {
        Err(format!("invalid path: {rel}"))
    }
}

#[tauri::command]
fn store_read(state: State<AppState>, path: String) -> Result<Option<String>, String> {
    let file = safe_join(&state.data_dir, &path)?;
    Ok(std::fs::read_to_string(file).ok())
}

#[tauri::command]
fn store_write(state: State<AppState>, path: String, text: String) -> Result<(), String> {
    let file = safe_join(&state.data_dir, &path)?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(file, text).map_err(|e| e.to_string())
}

/// Data shipped with the installer (build/snapshot → resources/snapshot).
#[tauri::command]
fn snapshot_read(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let base = app.path().resource_dir().map_err(|e| e.to_string())?.join("snapshot");
    // `npm run dev` has no installed resources: read the project's build/snapshot instead. Only in
    // debug builds, so release builds never contain the build machine's folder path.
    #[cfg(debug_assertions)]
    let base = if base.is_dir() { base } else { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("build").join("snapshot") };
    let file = safe_join(&base, &path)?;
    Ok(std::fs::read_to_string(file).ok())
}

#[tauri::command]
fn find_logs_folder() -> Option<String> {
    paths::find_logs_folder().map(|p| p.to_string_lossy().into())
}

#[tauri::command]
fn default_screenshots_folder(app: AppHandle) -> Option<String> {
    let docs = app.path().document_dir().ok()?;
    Some(docs.join("Escape From Tarkov").join("Screenshots").to_string_lossy().into())
}

/// Starts (or restarts) following a Logs folder and returns the quest history of every
/// session, tagged by game mode. None if the folder doesn't exist. Runs off the UI thread:
/// the first scan of a large Logs folder reads every session once (cached afterwards).
#[tauri::command]
async fn logs_watch(app: AppHandle, path: String) -> Option<history::QuestHistory> {
    let state = app.state::<AppState>();
    state.log_generation.fetch_add(1, Ordering::SeqCst); // stops any previous tailer
    let root = PathBuf::from(path);
    if !root.is_dir() {
        return None;
    }
    let generation = state.log_generation.clone();
    let index_file = state.data_dir.join("log-index.json");
    let emitter = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let emit = move |chunk: logs::LogChunk| {
            let _ = emitter.emit("log-chunk", chunk);
        };
        // Follow first, so lines written while history is scanned aren't missed
        // (an event seen by both is harmless: the UI keeps the newest per quest).
        let mut tailer = logs::Tailer::new(root.clone());
        let mut emit = emit;
        tailer.start(&mut emit);
        logs::spawn(tailer, generation, emit);
        history::load(&root, &index_file)
    })
    .await
    .ok()
}

/// Watches the screenshot folder; each new file name carries the player's position.
#[tauri::command]
fn screenshots_watch(app: AppHandle, state: State<AppState>, path: String) -> bool {
    let mut slot = state.screenshot_watcher.lock().unwrap();
    *slot = None;
    *state.screenshot_dir.lock().unwrap() = None;
    let dir = PathBuf::from(path);
    if !dir.is_dir() {
        return false;
    }
    *state.screenshot_dir.lock().unwrap() = Some(dir.clone());
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(notify::event::ModifyKind::Name(_))) {
            return;
        }
        for p in event.paths {
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            if name.to_ascii_lowercase().ends_with(".png") {
                let _ = app.emit("screenshot", name);
            }
        }
    });
    let Ok(mut w) = watcher else { return false };
    if w.watch(&dir, RecursiveMode::NonRecursive).is_err() {
        return false;
    }
    *slot = Some(w);
    true
}

/// The path of a screenshot the UI may delete: a plain .png name directly inside the watched folder.
fn screenshot_path(dir: &Path, name: &str) -> Option<PathBuf> {
    let p = Path::new(name);
    let plain = p.components().count() == 1 && matches!(p.components().next(), Some(Component::Normal(_)));
    (plain && name.to_ascii_lowercase().ends_with(".png")).then(|| dir.join(p))
}

/// Deletes a screenshot once its position has been read. The game may still be writing it,
/// so this retries for a few seconds in the background.
#[tauri::command]
fn screenshot_delete(state: State<AppState>, name: String) -> bool {
    let Some(dir) = state.screenshot_dir.lock().unwrap().clone() else { return false };
    let Some(path) = screenshot_path(&dir, &name) else { return false };
    std::thread::spawn(move || {
        // The game may still be writing it, and OneDrive can hold a new file while it uploads:
        // keep trying for about a minute, quickly at first.
        for attempt in 0..40u64 {
            match std::fs::remove_file(&path) {
                Ok(()) => return,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
                Err(_) => std::thread::sleep(std::time::Duration::from_millis(if attempt < 10 { 500 } else { 1800 })),
            }
        }
    });
    true
}

#[tauri::command]
fn window_minimize(app: AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.minimize();
    }
}

#[tauri::command]
fn app_quit(app: AppHandle) {
    app.exit(0);
}

// ---------- hotkeys ----------

fn hotkeys() -> [(Shortcut, &'static str); 3] {
    let mods = Some(Modifiers::CONTROL | Modifiers::ALT);
    [
        (Shortcut::new(mods, Code::KeyO), "mode"),
        (Shortcut::new(mods, Code::KeyL), "clickThrough"),
        (Shortcut::new(mods, Code::KeyH), "visible"),
    ]
}

fn on_hotkey(app: &AppHandle, action: &str) {
    let state = app.state::<AppState>();
    let (overlay, click) = {
        let s = state.settings.lock().unwrap();
        (s.overlay(), s.value["clickThrough"] == true)
    };
    match action {
        "mode" => {
            change_settings(app, serde_json::json!({ "mode": if overlay { "windowed" } else { "overlay" } }));
        }
        "clickThrough" if overlay => {
            change_settings(app, serde_json::json!({ "clickThrough": !click }));
        }
        "visible" => {
            if let Some(w) = app.get_webview_window(MAIN) {
                if w.is_visible().unwrap_or(true) {
                    let _ = w.hide();
                } else {
                    let _ = w.show();
                }
            }
        }
        _ => {}
    }
}

// ---------- app ----------

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window(MAIN) {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        // App updates from GitHub Releases (signed; see plugins.updater in tauri.conf.json).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if let Some((_, action)) = hotkeys().into_iter().find(|(s, _)| s == shortcut) {
                        on_hotkey(app, action);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // TQO_DATA_DIR lets the demo/test scripts use a throwaway profile.
            let data_dir = std::env::var_os("TQO_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            let settings = Settings::load(data_dir.join("settings.json"));

            let overlay = settings.overlay();
            let b = settings.bounds().unwrap_or_else(|| default_bounds(overlay));
            let win = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
                .title("Escape Artist")
                .transparent(true)
                .decorations(!overlay)
                .shadow(!overlay)
                .always_on_top(overlay)
                .inner_size(b.width, b.height)
                .position(b.x, b.y)
                .min_inner_size(320.0, 360.0)
                // Software rendering: the UI is a flat map, and this keeps the GPU (and ~130 MB of
                // GPU-process memory) for the game. The --disable-features list is Tauri's default.
                .additional_browser_args(
                    "--disable-gpu --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
                )
                .build()?;
            let _ = win.set_ignore_cursor_events(settings.click_through());

            app.manage(AppState {
                data_dir,
                settings: Mutex::new(settings),
                log_generation: Arc::new(AtomicU64::new(0)),
                screenshot_watcher: Mutex::new(None),
                screenshot_dir: Mutex::new(None),
            });
            for (shortcut, _) in hotkeys() {
                // Another app may own the combo; the buttons in the UI still work.
                let _ = app.global_shortcut().register(shortcut);
            }
            Ok(())
        })
        .on_window_event(|win, event| {
            let Some(w) = win.app_handle().get_webview_window(MAIN) else { return };
            match event {
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => remember_bounds(&w, &win.app_handle().state::<AppState>()),
                WindowEvent::Focused(focused) => set_low_memory(&w, !focused),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            settings_get,
            settings_set,
            store_read,
            store_write,
            snapshot_read,
            find_logs_folder,
            default_screenshots_folder,
            logs_watch,
            screenshots_watch,
            screenshot_delete,
            window_minimize,
            app_quit
        ])
        .build(tauri::generate_context!())
        .expect("failed to start Escape Artist");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app.try_state::<AppState>() {
                state.settings.lock().unwrap().save(); // persists window positions
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::screenshot_path;
    use std::path::Path;

    #[test]
    fn only_plain_png_names_can_be_deleted() {
        let dir = Path::new("C:/shots");
        assert_eq!(screenshot_path(dir, "2025-01-01[12-00]_1, 2, 3_0, 0, 0, 1_0.0 (0).png"), Some(dir.join("2025-01-01[12-00]_1, 2, 3_0, 0, 0, 1_0.0 (0).png")));
        assert_eq!(screenshot_path(dir, "a.PNG"), Some(dir.join("a.PNG")));
        for bad in ["../a.png", "sub/a.png", "C:/a.png", "/a.png", "a.jpg", "..", ""] {
            assert_eq!(screenshot_path(dir, bad), None, "{bad}");
        }
    }
}
