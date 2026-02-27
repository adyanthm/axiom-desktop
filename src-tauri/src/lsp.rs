use futures_util::{SinkExt, StreamExt};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

pub async fn start_lsp_server() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().unwrap().port();
    println!("LSP server listening on 127.0.0.1:{}", port);


    tokio::spawn(async move {
        loop {
            if let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(handle_connection(stream));
            }
        }
    });
    
    Ok(port)
}

async fn handle_connection(stream: TcpStream) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("Error accepting websocket: {}", e);
            return;
        }
    };

    println!("New LSP WebSocket connection");
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Start pyright
    let mut cmd = Command::new("node");
    cmd.args(&["../node_modules/pyright/dist/pyright-langserver.js", "--stdio"]);

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            eprintln!("Failed to spawn LSP process: {}", e);
            return;
        }
    };

    let mut stdin = child.stdin.take().expect("Failed to open stdin");
    let stdout = child.stdout.take().expect("Failed to open stdout");
    
    // Spawn task to read from WS and write to LSP stdin
    let stdin_task = tokio::spawn(async move {
        while let Some(msg) = ws_receiver.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    // println!("[LSP RECV FROM WS] {}", text);
                    // LSP over stdio requires Content-Length headers
                    let payload = format!("Content-Length: {}\r\n\r\n{}", text.len(), text);
                    if stdin.write_all(payload.as_bytes()).await.is_err() {
                        break;
                    }
                }
                Ok(Message::Binary(bin)) => {
                    let text = String::from_utf8_lossy(&bin).to_string();
                    let payload = format!("Content-Length: {}\r\n\r\n{}", text.len(), text);
                    if stdin.write_all(payload.as_bytes()).await.is_err() {
                        break;
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(_) => break,
                _ => {}
            }
        }
    });

    // Spawn task to read from LSP stdout and write to WS
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        loop {
            // Read headers
            let mut content_length = 0;
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line).await {
                    Ok(0) => return, // EOF
                    Ok(_) => {
                        let line = line.trim();
                        if line.is_empty() {
                            break;
                        }
                        if line.starts_with("Content-Length:") {
                            let parts: Vec<&str> = line.splitn(2, ':').collect();
                            if parts.len() == 2 {
                                content_length = parts[1].trim().parse().unwrap_or(0);
                            }
                        }
                    }
                    Err(_) => return,
                }
            }

            if content_length > 0 {
                let mut body = vec![0; content_length];
                match reader.read_exact(&mut body).await {
                    Ok(_) => {
                        if let Ok(text) = String::from_utf8(body) {
                            // println!("[LSP SEND TO WS] {}", text);
                            if ws_sender.send(Message::Text(text.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(_) => return,
                }
            }
        }
    });

    // Wait for either thread to finish or the child process to exit
    tokio::select! {
        _ = stdin_task => (),
        _ = stdout_task => (),
        _ = child.wait() => (),
    }

    println!("LSP WebSocket connection closed");
}
