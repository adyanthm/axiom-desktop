use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_directory: bool,
    is_file: bool,
}

#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    // Try UTF-8 first, fall back to lossy conversion for ANSI/Windows-1252 encoded files
    match String::from_utf8(bytes.clone()) {
        Ok(s) => Ok(s),
        Err(_) => Ok(String::from_utf8_lossy(&bytes).to_string()),
    }
}

#[tauri::command]
fn write_file_text(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let entries = fs::read_dir(&path).map_err(|e| format!("Failed to read dir {}: {}", path, e))?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry.path().to_string_lossy().to_string();
        result.push(DirEntry {
            name,
            path: full_path,
            is_directory: metadata.is_dir(),
            is_file: metadata.is_file(),
        });
    }
    Ok(result)
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    fs::write(&path, "").map_err(|e| format!("Failed to create file {}: {}", path, e))
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create dir {}: {}", path, e))
}

#[tauri::command]
fn delete_item(path: String, recursive: bool) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        if recursive {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_dir(&path)
        }
        .map_err(|e| format!("Failed to delete dir {}: {}", path, e))
    } else {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete file {}: {}", path, e))
    }
}

#[tauri::command]
fn rename_item(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to rename {} -> {}: {}", old_path, new_path, e))
}

#[tauri::command]
fn move_item(source: String, dest_dir: String) -> Result<String, String> {
    let src = Path::new(&source);
    let name = src
        .file_name()
        .ok_or_else(|| "Invalid source path".to_string())?;
    let dest = Path::new(&dest_dir).join(name);
    let dest_str = dest.to_string_lossy().to_string();
    fs::rename(&source, &dest)
        .map_err(|e| format!("Failed to move {} -> {}: {}", source, dest_str, e))?;
    Ok(dest_str)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            read_file_text,
            write_file_text,
            list_dir,
            create_file,
            create_dir,
            delete_item,
            rename_item,
            move_item,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
