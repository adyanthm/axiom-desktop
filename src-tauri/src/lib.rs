mod live_server;
mod lsp;
mod debug;

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};

struct AppState {
    pty_pair: Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn std::io::Write + Send>>>,
    live_server_tx: Mutex<Option<tokio::sync::broadcast::Sender<()>>>,
    live_server_port: Mutex<Option<u16>>,
    lsp_port: Mutex<Option<u16>>,
    debug_port: Mutex<Option<u16>>,
}

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_directory: bool,
    is_file: bool,
}

#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) => {
            if e.kind() == std::io::ErrorKind::InvalidData {
                let bytes = fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
                Ok(String::from_utf8_lossy(&bytes).into_owned())
            } else {
                Err(format!("Failed to read {}: {}", path, e))
            }
        }
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

#[tauri::command]
fn start_terminal(app: AppHandle, cwd: Option<String>) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.pty_pair.lock().unwrap().is_some() {
        return Ok(());
    }

    let pty_system = NativePtySystem::default();
    let pty_pair = pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let mut cmd = CommandBuilder::new("powershell.exe");
    #[cfg(not(target_os = "windows"))]
    let mut cmd = CommandBuilder::new({
        std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string())
    });

    // Strip AppImage environment variables that break PTY child processes.
    cmd.env_remove("PYTHONHOME");
    cmd.env_remove("PYTHONPATH");
    cmd.env_remove("LD_LIBRARY_PATH");

    if let Some(dir) = cwd {
        cmd.cwd(Path::new(&dir));
    }

    let mut child = pty_pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    
    // MasterPty allows cloning reader and writer
    let mut reader = pty_pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pty_pair.master.take_writer().map_err(|e| e.to_string())?;

    *state.pty_pair.lock().unwrap() = Some(pty_pair.master);
    *state.writer.lock().unwrap() = Some(writer);

    let app_clone = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit("terminal-output", text);
                }
                _ => break,
            }
        }
    });

    std::thread::spawn(move || {
        let _ = child.wait();
    });

    Ok(())
}

#[tauri::command]
fn terminal_input(input: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    if let Some(writer) = state.writer.lock().unwrap().as_mut() {
        writer.write_all(input.as_bytes()).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn resize_terminal(rows: u16, cols: u16, state: tauri::State<'_, AppState>) -> Result<(), String> {
    if let Some(pty) = state.pty_pair.lock().unwrap().as_mut() {
        pty.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn start_live_server(
    port: u16,
    dir: String,
    state: tauri::State<'_, AppState>,
) -> Result<u16, String> {
    if let Some(p) = *state.live_server_port.lock().unwrap() {
        return Ok(p);
    }
    match live_server::start_live_server(port, dir).await {
        Ok((p, tx)) => {
            *state.live_server_port.lock().unwrap() = Some(p);
            *state.live_server_tx.lock().unwrap() = Some(tx);
            Ok(p)
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
fn notify_live_server(state: tauri::State<'_, AppState>) {
    if let Some(tx) = state.live_server_tx.lock().unwrap().as_ref() {
        let _ = tx.send(());
    }
}

#[tauri::command]
async fn get_lsp_port(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<u16, String> {
    if !lsp::is_node_installed() {
        return Err("Node.js is not installed".to_string());
    }
    {
        let port_guard = state.lsp_port.lock().unwrap();
        if let Some(p) = *port_guard {
            return Ok(p);
        }
    }
    let p = lsp::start_lsp_server(app).await?;
    let mut port_guard = state.lsp_port.lock().unwrap();
    *port_guard = Some(p);
    Ok(p)
}

#[tauri::command]
async fn get_debug_port(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<u16, String> {
    {
        let port_guard = state.debug_port.lock().unwrap();
        if let Some(p) = *port_guard {
            return Ok(p);
        }
    }
    let p = debug::start_debug_server(app).await?;
    let mut port_guard = state.debug_port.lock().unwrap();
    *port_guard = Some(p);
    Ok(p)
}

#[derive(Serialize, Clone)]
pub struct SearchResult {
    path: String,
    line_number: usize,
    line_text: String,
}

#[tauri::command]
async fn global_search(window: tauri::Window, dir: String, query: String) -> Result<(), String> {
    use ignore::WalkBuilder;
    use regex::RegexBuilder;
    use std::io::{BufRead, BufReader};
    use std::sync::{Arc, Mutex};
    use tauri::Emitter;

    if query.trim().is_empty() {
        return Ok(());
    }

    let re = RegexBuilder::new(&regex::escape(&query))
        .case_insensitive(true)
        .build()
        .map_err(|e| format!("Invalid regex: {}", e))?;

    let binary_exts = vec![
        "exe", "dll", "so", "dylib", "bin", "obj", "o", "a", "lib",
        "zip", "tar", "gz", "7z", "rar", "png", "jpg", "jpeg", "gif", "ico",
        "pdf", "docx", "xlsx", "pptx", "sqlite", "db", "pyc", "pyd", "pyo",
    ];

    let query_clone = query.clone();
    let re_arc = Arc::new(re);
    let count = Arc::new(Mutex::new(0));

    tokio::spawn(async move {
        let walker = WalkBuilder::new(&dir)
            .hidden(true)
            .ignore(true)
            .git_ignore(true)
            .threads(std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4)) // Use available parallelism
            .build_parallel();

        walker.run(|| {
            let window = window.clone();
            let re = Arc::clone(&re_arc);
            let binary_exts = binary_exts.clone();
            let count = Arc::clone(&count);

            Box::new(move |result| {
                let entry = match result {
                    Ok(e) => e,
                    Err(_) => return ignore::WalkState::Continue,
                };

                if entry.file_type().map_or(false, |ft| ft.is_file()) {
                    let path = entry.path();
                    
                    // Skip binary extensions
                    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                        if binary_exts.contains(&ext.to_lowercase().as_str()) {
                            return ignore::WalkState::Continue;
                        }
                    }

                    // Check file size - skip if > 10MB for speed and memory
                    if let Ok(meta) = entry.metadata() {
                        if meta.len() > 10_000_000 {
                            return ignore::WalkState::Continue;
                        }
                    }

                    if let Ok(file) = std::fs::File::open(path) {
                        let reader = BufReader::new(file);
                        for (i, line_result) in reader.lines().enumerate() {
                            // Check count before continuing
                            {
                                let c = count.lock().unwrap();
                                if *c >= 1000 {
                                    return ignore::WalkState::Quit;
                                }
                            }

                            if let Ok(line) = line_result {
                                if re.is_match(&line) {
                                    let _ = window.emit("search_result", SearchResult {
                                        path: path.to_string_lossy().into_owned(),
                                        line_number: i + 1,
                                        line_text: line.trim().to_string(),
                                    });

                                    let mut c = count.lock().unwrap();
                                    *c += 1;
                                    if *c >= 1000 {
                                        return ignore::WalkState::Quit;
                                    }
                                }
                            } else {
                                // Likely binary or invalid encoding, skip file
                                break;
                            }
                        }
                    }
                }
                ignore::WalkState::Continue
            })
        });

        let _ = window.emit("search_finished", ());
    });

    Ok(())
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
            start_terminal,
            terminal_input,
            resize_terminal,
            start_live_server,
            notify_live_server,
            get_lsp_port,
            get_debug_port,
            global_search,
        ])
        .setup(|app| {
            app.manage(AppState {
                pty_pair: Mutex::new(None),
                writer: Mutex::new(None),
                live_server_tx: Mutex::new(None),
                live_server_port: Mutex::new(None),
                lsp_port: Mutex::new(None),
                debug_port: Mutex::new(None),
            });
            
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
