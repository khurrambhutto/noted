use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

mod db;
mod links;

#[derive(Clone)]
struct AppPaths {
    themes_dir: PathBuf,
}

#[derive(Serialize)]
struct ThemeFile {
    name: String,
    json: String,
}

fn safe_theme_filename(name: &str) -> String {
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();

    let safe = if safe.is_empty() {
        "theme".to_string()
    } else {
        safe
    };
    let hash = stable_name_hash(name);
    format!("{safe}-{hash:016x}.json")
}

fn stable_name_hash(name: &str) -> u64 {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    name.as_bytes().iter().fold(FNV_OFFSET, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(FNV_PRIME)
    })
}

fn validate_theme_payload(expected_name: &str, json: &str) -> Result<(), String> {
    let value = serde_json::from_str::<Value>(json).map_err(|e| e.to_string())?;
    let object = value
        .as_object()
        .ok_or_else(|| "Theme must be a JSON object.".to_string())?;

    let theme_name = object
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "Theme is missing a string \"name\" field.".to_string())?;

    if theme_name != expected_name {
        return Err("Theme name does not match save request.".to_string());
    }

    if !object.get("isDarkTheme").and_then(Value::as_bool).is_some() {
        return Err("Theme field \"isDarkTheme\" must be a boolean.".to_string());
    }

    for &key in THEME_COLOR_KEYS {
        let color = object
            .get(key)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Theme field \"{key}\" must be a hex color."))?;
        if !is_hex_color(color) {
            return Err(format!("Theme field \"{key}\" must be a hex color."));
        }
    }

    for key in ["gridEnabled", "isTranslucent"] {
        if object.get(key).is_some() && object.get(key).and_then(Value::as_bool).is_none() {
            return Err(format!("Theme field \"{key}\" must be a boolean."));
        }
    }

    Ok(())
}

const THEME_COLOR_KEYS: &[&str] = &[
    "background",
    "backgroundFade",
    "typeMain",
    "typeSubtle",
    "typeSubtlePlus",
    "typeHighlight",
    "typeLight",
    "typeSuperlight",
    "typeHyperLight",
    "typeReverse",
    "accent1Main",
    "accent1Secondary",
    "accent1Tertiary",
    "accent2Main",
    "accent2Secondary",
    "accent3Main",
    "accent3Secondary",
    "accent4Main",
    "accent4Secondary",
    "accent5Main",
    "accent5Secondary",
    "gridSuperlight",
    "gridClear",
    "gridBold",
];

fn is_hex_color(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.first() != Some(&b'#') || !(bytes.len() == 7 || bytes.len() == 9) {
        return false;
    }
    bytes[1..].iter().all(u8::is_ascii_hexdigit)
}

#[tauri::command]
fn list_notes(state: tauri::State<'_, db::Database>) -> Result<Vec<db::Note>, String> {
    state.list_notes()
}

#[tauri::command]
fn create_note(state: tauri::State<'_, db::Database>) -> Result<db::Note, String> {
    state.create_note()
}

#[tauri::command]
fn save_note(
    id: i64,
    content: String,
    state: tauri::State<'_, db::Database>,
) -> Result<(), String> {
    state.save_note(id, &content)
}

#[tauri::command]
fn delete_note(id: i64, state: tauri::State<'_, db::Database>) -> Result<(), String> {
    state.delete_note(id)
}

#[tauri::command]
fn list_links(
    query: String,
    offset: i64,
    state: tauri::State<'_, db::Database>,
) -> Result<links::LinkPage, String> {
    state.list_links(&query, offset)
}

#[tauri::command]
fn add_links(
    text: String,
    state: tauri::State<'_, db::Database>,
) -> Result<links::AddLinksResult, String> {
    state.add_links(&text)
}

#[tauri::command]
fn rename_link(
    id: i64,
    label: String,
    state: tauri::State<'_, db::Database>,
) -> Result<(), String> {
    state.rename_link(id, &label)
}

#[tauri::command]
fn delete_link(id: i64, state: tauri::State<'_, db::Database>) -> Result<(), String> {
    state.delete_link(id)
}

#[tauri::command]
fn pending_link_titles(state: tauri::State<'_, db::Database>) -> Result<Vec<i64>, String> {
    if !state.fetch_link_titles_enabled()? {
        return Ok(Vec::new());
    }
    state.pending_link_titles()
}

#[tauri::command]
fn get_fetch_link_titles(state: tauri::State<'_, db::Database>) -> Result<bool, String> {
    state.fetch_link_titles_enabled()
}

#[tauri::command]
fn set_fetch_link_titles(
    enabled: bool,
    state: tauri::State<'_, db::Database>,
) -> Result<(), String> {
    state.set_fetch_link_titles(enabled)
}

#[tauri::command]
async fn refresh_link_title(
    id: i64,
    state: tauri::State<'_, db::Database>,
    fetcher: tauri::State<'_, links::TitleFetcher>,
) -> Result<links::SavedLink, String> {
    if !state.fetch_link_titles_enabled()? {
        return Err("Page title fetching is turned off.".into());
    }
    let link = state.get_link(id)?;
    let result = fetcher.fetch(&link.url).await;
    state.set_link_title(id, result.as_ref().ok().map(String::as_str))?;
    result?;
    state.get_link(id)
}

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn list_theme_files(paths: tauri::State<'_, AppPaths>) -> Result<Vec<ThemeFile>, String> {
    fs::create_dir_all(&paths.themes_dir).map_err(|e| e.to_string())?;

    let mut themes = Vec::new();
    for entry in fs::read_dir(&paths.themes_dir).map_err(|e| e.to_string())? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                eprintln!("Could not read theme directory entry: {error}");
                continue;
            }
        };
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        let json = match fs::read_to_string(&path) {
            Ok(json) => json,
            Err(error) => {
                eprintln!("Could not read theme file {:?}: {error}", path);
                continue;
            }
        };
        let name = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("theme")
            .to_string();
        themes.push(ThemeFile { name, json });
    }

    Ok(themes)
}

#[tauri::command]
fn save_theme_file(
    name: String,
    json: String,
    paths: tauri::State<'_, AppPaths>,
) -> Result<(), String> {
    save_theme_json(&paths.themes_dir, &name, &json)
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn set_pinned(window: tauri::WebviewWindow, pinned: bool) -> Result<(), String> {
    window
        .set_always_on_top(pinned)
        .map_err(|error| error.to_string())
}

// Always-on-top is only a real toggle where the platform honors it: Windows
// (WS_EX_TOPMOST) and X11 (EWMH _NET_WM_STATE_ABOVE). On Wayland it is a silent
// no-op, so the UI stays hidden there and the title bar right-click menu is used
// instead. The frontend calls this once to decide whether to show the control.
#[tauri::command]
fn pin_supported() -> bool {
    #[cfg(target_os = "windows")]
    let supported = true;
    #[cfg(target_os = "linux")]
    let supported = {
        use gtk::prelude::*;

        gtk::gdk::Display::default()
            .map(|display| display.type_().name().contains("X11"))
            .unwrap_or(false)
    };
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let supported = false;

    supported
}

fn save_theme_json(themes_dir: &PathBuf, name: &str, json: &str) -> Result<(), String> {
    validate_theme_payload(&name, &json)?;
    fs::create_dir_all(themes_dir).map_err(|e| e.to_string())?;

    let path = themes_dir.join(safe_theme_filename(name));
    let tmp_path = path.with_extension(format!("json.tmp.{}", std::process::id()));
    fs::write(&tmp_path, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        e.to_string()
    })
}

#[cfg(desktop)]
fn register_global_hotkey() {
    if !shortcut_command_available() {
        return;
    }

    let desktop = std::env::var("XDG_CURRENT_DESKTOP")
        .or_else(|_| std::env::var("DESKTOP_SESSION"))
        .unwrap_or_default()
        .to_ascii_lowercase();

    if desktop.contains("gnome") || desktop.contains("ubuntu") {
        register_gnome_global_hotkey();
    } else if desktop.contains("xfce") {
        register_xfce_global_hotkey();
    }
}

#[cfg(desktop)]
fn shortcut_command_available() -> bool {
    use std::process::Command;

    Command::new("sh")
        .args(["-c", "command -v noted-toggle >/dev/null 2>&1"])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(desktop)]
fn register_gnome_global_hotkey() {
    use std::process::Command;

    let schema = "org.gnome.settings-daemon.plugins.media-keys";
    let our_path = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/noted/";

    let output = match Command::new("gsettings")
        .args(["get", schema, "custom-keybindings"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };
    if !output.status.success() {
        return;
    }

    let existing_str = String::from_utf8_lossy(&output.stdout).to_string();

    let mut paths: Vec<String> = Vec::new();
    if !existing_str.contains("[]") {
        let cleaned = existing_str
            .trim_start_matches("@as []")
            .trim_start_matches("@a(as) ")
            .trim_start_matches('[')
            .trim_end_matches("]\n")
            .trim_end_matches(']');
        for part in cleaned.split(", ") {
            let p = part.trim().trim_matches('\'').to_string();
            if !p.is_empty() {
                paths.push(p);
            }
        }
    }

    if !paths.iter().any(|p| p == our_path) {
        paths.push(our_path.to_string());
    }

    let list: String = paths
        .iter()
        .map(|p| format!("'{}'", p))
        .collect::<Vec<_>>()
        .join(", ");
    let _ = Command::new("gsettings")
        .args(["set", schema, "custom-keybindings", &format!("[{}]", list)])
        .status();

    let our_schema = format!("{}.custom-keybinding:{}", schema, our_path);
    let _ = Command::new("gsettings")
        .args(["set", &our_schema, "name", "'Noted Toggle'"])
        .status();
    let _ = Command::new("gsettings")
        .args(["set", &our_schema, "command", "'noted-toggle'"])
        .status();
    let _ = Command::new("gsettings")
        .args(["set", &our_schema, "binding", "'<Super>n'"])
        .status();
}

#[cfg(desktop)]
fn register_xfce_global_hotkey() {
    use std::process::Command;

    let _ = Command::new("xfconf-query")
        .args([
            "-c",
            "xfce4-keyboard-shortcuts",
            "-p",
            "/commands/custom/<Super>n",
            "-n",
            "-t",
            "string",
            "-s",
            "noted-toggle",
        ])
        .status();
}

// The window is frameless, so there is no native title bar to expose the
// compositor's window menu. GTK shows that menu with `gdk_window_show_window_menu`
// (see `gtk_window_do_popup` in GTK). The same call works from a custom title
// bar: on Wayland it asks Mutter to pop up GNOME's menu, which carries "Always
// on Top"; on X11 the WM handles it and GTK's fallback also offers it.
#[cfg(target_os = "linux")]
fn install_window_menu_gesture(window: &tauri::WebviewWindow) {
    use gtk::prelude::*;

    // Height of the custom title bar in `src/styles.css` (#titlebar). Right
    // clicks below this strip stay with the editor.
    const TITLEBAR_STRIP_HEIGHT: f64 = 36.0;

    let Ok(gtk_window) = window.gtk_window() else {
        return;
    };

    // Attach to the webview itself. It fills the window and is the target of
    // every click, so a capture-phase gesture there is guaranteed to run before
    // WebKit handles the event. A gesture on an ancestor only runs if the event
    // propagates up to it, which we cannot rely on with a webview child.
    let webview = window.default_vbox().ok().and_then(|vbox| {
        vbox.children()
            .into_iter()
            .find(|child| child.type_().name().contains("WebKitWebView"))
    });
    let Some(webview) = webview else {
        #[cfg(debug_assertions)]
        eprintln!("noted: window menu: no webview widget found");
        return;
    };

    let gesture = gtk::GestureMultiPress::new(&webview);
    gesture.set_button(3);
    gesture.set_propagation_phase(gtk::PropagationPhase::Capture);
    gesture.connect_pressed(move |gesture, _n_press, _x, y| {
        #[cfg(debug_assertions)]
        eprintln!("noted: titlebar right-click at y={y}");

        if y >= TITLEBAR_STRIP_HEIGHT {
            return;
        }

        // Mutter validates the seat serial against the active grab, so the call
        // has to happen while the press is still live. The gesture hands us the
        // real event and a valid serial.
        let sequence = gesture.current_sequence();
        let Some(mut event) = gesture.last_event(sequence.as_ref()) else {
            return;
        };
        let Some(gdk_window) = gtk_window.window() else {
            return;
        };

        if !gdk_window.show_window_menu(&mut event) {
            eprintln!("Compositor does not support a window menu");
        }

        // Keep the webview from also acting on the right click.
        gesture.set_state(gtk::EventSequenceState::Claimed);
    });

    // GTK3 connects a controller to its widget through weak pointers only: the
    // widget does not own the controller. Dropping this local would destroy the
    // gesture the moment this function returns, so keep it alive for the
    // lifetime of the process.
    std::mem::forget(gesture);

    #[cfg(debug_assertions)]
    eprintln!("noted: window menu gesture installed");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(
            tauri_plugin_single_instance::Builder::new()
                .dbus_id("com.khurram.noted")
                .callback(|app, args, _cwd| {
                    if let Some(window) = app.get_webview_window("main") {
                        if args.iter().any(|arg| arg == "--toggle") {
                            let visible = window.is_visible().unwrap_or(false);
                            if visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(),
        );
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            fs::create_dir_all(&app_data_dir).expect("failed to create app data dir");

            let themes_dir = app_data_dir.join("themes");
            fs::create_dir_all(&themes_dir).expect("failed to create themes dir");

            let database = db::Database::new(app_data_dir).expect("failed to initialize database");
            app.manage(database);
            app.manage(links::TitleFetcher::new());
            app.manage(AppPaths { themes_dir });
            #[cfg(desktop)]
            register_global_hotkey();

            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                install_window_menu_gesture(&window);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_links,
            add_links,
            rename_link,
            delete_link,
            pending_link_titles,
            get_fetch_link_titles,
            set_fetch_link_titles,
            refresh_link_title,
            list_notes,
            create_note,
            save_note,
            delete_note,
            get_app_version,
            list_theme_files,
            save_theme_file,
            quit_app,
            set_pinned,
            pin_supported
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("noted-theme-{name}-{unique}"))
    }

    fn valid_theme_json(name: &str) -> String {
        format!(
            r##"{{
                "name": "{name}",
                "isDarkTheme": false,
                "background": "#ffffff",
                "backgroundFade": "#f4f4f4",
                "typeMain": "#242424",
                "typeSubtle": "#6d6d6d",
                "typeSubtlePlus": "#4f7d9d",
                "typeHighlight": "#e9e9e9",
                "typeLight": "#a0a0a0",
                "typeSuperlight": "#dddddd",
                "typeHyperLight": "#f6f6f6",
                "typeReverse": "#ffffff",
                "accent1Main": "#7d7d7d",
                "accent1Secondary": "#666666",
                "accent1Tertiary": "#555555",
                "accent2Main": "#7b61a8",
                "accent2Secondary": "#684f93",
                "accent3Main": "#5c8a55",
                "accent3Secondary": "#477240",
                "accent4Main": "#b97835",
                "accent4Secondary": "#965d24",
                "accent5Main": "#c75d55",
                "accent5Secondary": "#9f443d",
                "gridSuperlight": "#00000000",
                "gridClear": "#00000000",
                "gridBold": "#00000000",
                "gridEnabled": false,
                "isTranslucent": false
            }}"##
        )
    }

    #[test]
    fn theme_filename_includes_stable_hash_to_avoid_collisions() {
        let slash = safe_theme_filename("A/B");
        let colon = safe_theme_filename("A:B");

        assert_ne!(slash, colon);
        assert!(slash.ends_with(".json"));
        assert!(colon.ends_with(".json"));
    }

    #[test]
    fn theme_payload_validation_rejects_invalid_schema() {
        let invalid = r##"{"name":"Broken","isDarkTheme":false,"background":"white"}"##;

        assert!(validate_theme_payload("Broken", invalid).is_err());
    }

    #[test]
    fn theme_payload_validation_rejects_name_mismatch() {
        let json = valid_theme_json("Saved Name");

        assert!(validate_theme_payload("Other Name", &json).is_err());
    }

    #[test]
    fn save_theme_json_writes_validated_payload_and_cleans_temp_file() {
        let dir = temp_dir("save");
        let json = valid_theme_json("My Theme");

        save_theme_json(&dir, "My Theme", &json).expect("theme should save");

        let path = dir.join(safe_theme_filename("My Theme"));
        assert_eq!(
            fs::read_to_string(path).expect("theme file should read"),
            json
        );
        let temp_files = fs::read_dir(&dir)
            .expect("theme dir should read")
            .filter_map(Result::ok)
            .filter(|entry| entry.path().extension().and_then(|ext| ext.to_str()) != Some("json"))
            .count();
        assert_eq!(temp_files, 0);

        let _ = fs::remove_dir_all(dir);
    }
}
