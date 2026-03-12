use futures_util::{SinkExt, StreamExt};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command;
use tokio_tungstenite::tungstenite::Message;
use tauri::{AppHandle, Manager, path::BaseDirectory};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub fn is_node_installed() -> bool {
    let mut cmd = std::process::Command::new("node");
    cmd.arg("--version");
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    match cmd.output() {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

pub async fn start_lsp_server(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().unwrap().port();
    
    let pyright_path = app.path().resolve("resources/pyright/pyright-langserver.js", BaseDirectory::Resource).unwrap_or_default();
    let vtsls_path   = app.path().resolve("resources/vtsls/vtsls-entry.cjs", BaseDirectory::Resource).unwrap_or_default();
    let vtsls_nm     = app.path().resolve("resources/vtsls/node_modules", BaseDirectory::Resource).unwrap_or_default();

    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let pyright = pyright_path.clone();
            let vtsls   = vtsls_path.clone();
            let nm      = vtsls_nm.clone();
            
            tokio::spawn(async move {
                let mut path = String::new();
                let ws_stream = match tokio_tungstenite::accept_hdr_async(stream, |req: &tokio_tungstenite::tungstenite::handshake::server::Request, resp: tokio_tungstenite::tungstenite::handshake::server::Response| {
                    path = req.uri().path().to_string();
                    Ok(resp)
                }).await {
                    Ok(ws) => ws,
                    Err(_) => return,
                };
                
                if path.contains("vtsls") {
                    handle_connection(ws_stream, vtsls, Some(nm)).await;
                } else {
                    let p_dir = pyright.parent().map(|p| p.to_path_buf());
                    handle_connection(ws_stream, pyright, p_dir).await;
                }
            });
        }
    });
    Ok(port)
}

async fn handle_connection(
    ws_stream: tokio_tungstenite::WebSocketStream<TcpStream>,
    script: PathBuf,
    node_path_dir: Option<PathBuf>,
) {
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    
    // Check if script exists
    if !script.exists() {
        eprintln!("[LSP Error] Script not found: {:?}", script);
        return;
    }

    let mut cmd = Command::new("node");
    cmd.kill_on_drop(true);
    cmd.args(&[script.to_string_lossy().to_string(), "--stdio".to_string()]);
    
    if let Some(dir) = script.parent() { 
        cmd.current_dir(dir); 
    }

    if let Some(nm) = node_path_dir {
        let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
        let existing = std::env::var("NODE_PATH").unwrap_or_default();
        let val = if existing.is_empty() { nm.to_string_lossy().to_string() } 
                  else { format!("{}{}{}", nm.to_string_lossy(), sep, existing) };
        cmd.env("NODE_PATH", val);
        // Also set CWD for vtsls to its resource dir so it finds bundled typescript via local node_modules
        if let Some(p) = nm.parent() {
             cmd.current_dir(p);
        }
    }

    #[cfg(windows)]
    cmd.as_std_mut().creation_flags(0x08000000);

    let mut child = match cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[LSP Error] Spawn failed for {:?}: {}", script, e);
            return;
        }
    };

    let mut stdin = child.stdin.take().unwrap();
    let stdout    = child.stdout.take().unwrap();
    let stderr    = child.stderr.take().unwrap();

    // Log errors
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
            eprintln!("[LSP Log] {}", line.trim());
            line.clear();
        }
    });

    let stdin_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            let text = match msg {
                Message::Text(t) => t.to_string(),
                Message::Binary(b) => String::from_utf8_lossy(&b).to_string(),
                _ => continue,
            };
            let out = format!("Content-Length: {}\r\n\r\n{}", text.len(), text);
            if stdin.write_all(out.as_bytes()).await.is_err() { break; }
        }
    });

    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut clen = 0usize;
            loop {
                let mut line = String::new();
                let n = reader.read_line(&mut line).await.unwrap_or(0);
                if n == 0 { return; } 
                let t = line.trim();
                if t.is_empty() { break; }
                if t.to_lowercase().starts_with("content-length:") {
                    clen = t.split(':').nth(1).unwrap_or("0").trim().parse().unwrap_or(0);
                }
            }
            if clen > 0 {
                let mut body = vec![0u8; clen];
                if reader.read_exact(&mut body).await.is_ok() {
                    if let Ok(text) = String::from_utf8(body) {
                        if ws_sender.send(Message::Text(text.into())).await.is_err() { break; }
                    }
                }
            }
        }
    });

    tokio::select! { _ = stdin_task => (), _ = stdout_task => (), _ = child.wait() => () }
}
