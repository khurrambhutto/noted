use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

mod db;

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

    let safe = if safe.is_empty() { "theme".to_string() } else { safe };
    format!("{}.json", safe)
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
fn save_note(id: i64, content: String, state: tauri::State<'_, db::Database>) -> Result<(), String> {
    state.save_note(id, &content)
}

#[tauri::command]
fn delete_note(id: i64, state: tauri::State<'_, db::Database>) -> Result<(), String> {
    state.delete_note(id)
}

#[tauri::command]
fn list_theme_files(paths: tauri::State<'_, AppPaths>) -> Result<Vec<ThemeFile>, String> {
    fs::create_dir_all(&paths.themes_dir).map_err(|e| e.to_string())?;

    let mut themes = Vec::new();
    for entry in fs::read_dir(&paths.themes_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
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
fn save_theme_file(name: String, json: String, paths: tauri::State<'_, AppPaths>) -> Result<(), String> {
    // Validate that the payload is JSON before writing it to disk.
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    fs::create_dir_all(&paths.themes_dir).map_err(|e| e.to_string())?;

    let path = paths.themes_dir.join(safe_theme_filename(&name));
    fs::write(path, json).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                if window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("failed to get app data dir");
            fs::create_dir_all(&app_data_dir).expect("failed to create app data dir");

            let themes_dir = app_data_dir.join("themes");
            fs::create_dir_all(&themes_dir).expect("failed to create themes dir");

            let database = db::Database::new(app_data_dir).expect("failed to initialize database");
            app.manage(database);
            app.manage(AppPaths { themes_dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            create_note,
            save_note,
            delete_note,
            list_theme_files,
            save_theme_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
