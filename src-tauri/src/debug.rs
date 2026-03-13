use futures_util::{SinkExt, StreamExt};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;
use tauri::{AppHandle, Manager, path::BaseDirectory};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

// ── Python Debugger (debugpy over stdio) ─────────────────────────────────────
pub async fn start_debug_server(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().unwrap().port();
    println!("Python Debugger WebSocket on 127.0.0.1:{}", port);

    let debugpy_res = app.path()
        .resolve("resources/debugpy", BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve debugpy resource: {}", e))?;
    let python_path = debugpy_res.to_string_lossy().to_string();

    tokio::spawn(async move {
        loop {
            if let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(handle_python_connection(stream, python_path.clone()));
            }
        }
    });

    Ok(port)
}

async fn handle_python_connection(stream: TcpStream, python_path_env: String) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => { eprintln!("Python WS accept error: {}", e); return; }
    };

    println!("Python debug session started");
    let (ws_sender, ws_receiver) = ws_stream.split();

    let mut cmd = Command::new("python");
    cmd.env("PYTHONPATH", &python_path_env);
    cmd.args(&["-m", "debugpy.adapter"]);

    #[cfg(windows)]
    cmd.as_std_mut().creation_flags(0x08000000);

    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => { eprintln!("Failed to spawn debugpy: {}", e); return; }
    };

    let stdin  = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let reader = tokio::io::BufReader::new(stdout);

    bridge_stdio_to_ws(ws_sender, ws_receiver, stdin, reader, Some(child)).await;
    println!("Python debug session ended");
}

// ── JS Debugger (js-debug over stdio) ────────────────────────────────────────
pub async fn start_js_debug_server(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().unwrap().port();
    println!("JS Debugger WebSocket on 127.0.0.1:{}", port);

    let jsdebug_res = app.path()
        .resolve("resources/jsdebug", BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve jsdebug resource: {}", e))?;
    let jsdebug_path = jsdebug_res.to_string_lossy().to_string().replace("\\\\?\\", "");

    // Spawn the js-debug process ONCE for this session
    let dap_server = std::path::Path::new(&jsdebug_path)
        .join("dist")
        .join("src")
        .join("dapDebugServer.js");

    let mut cmd = Command::new("node");
    cmd.arg(dap_server.to_string_lossy().to_string().replace("\\\\?\\", ""));
    cmd.arg("0");
    cmd.current_dir(&jsdebug_path);

    #[cfg(windows)]
    cmd.as_std_mut().creation_flags(0x08000000);

    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Err(format!("Failed to spawn js-debug: {}", e)),
    };

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let mut reader = tokio::io::BufReader::new(stdout);
    let mut line = String::new();
    
    // Read stdout until we find the listening port
    let mut dap_port = 0;
    while reader.read_line(&mut line).await.is_ok() {
        if line.contains("Debug server listening at") {
            let re = regex::Regex::new(r":(\d+)\s*$").unwrap();
            if let Some(caps) = re.captures(&line) {
                if let Ok(p) = caps.get(1).unwrap().as_str().parse::<u16>() {
                    dap_port = p;
                    break;
                }
            }
        }
        line.clear();
    }

    if dap_port == 0 {
        let _ = child.kill().await;
        return Err("Failed to find DAP port from js-debug output.".to_string());
    }

    // Drain stdout/stderr in background to prevent blocking
    tokio::spawn(async move {
        let mut err_reader = tokio::io::BufReader::new(stderr);
        let mut eline = String::new();
        while err_reader.read_line(&mut eline).await.is_ok() {
            if eline.is_empty() { break; }
            eprintln!("[js-debug-stderr] {}", eline.trim());
            eline.clear();
        }
    });
    tokio::spawn(async move {
        let mut oline = String::new();
        while reader.read_line(&mut oline).await.is_ok() {
            if oline.is_empty() { break; }
            println!("[js-debug-stdout] {}", oline.trim());
            oline.clear();
        }
    });

    // Keep child alive and wait for it
    tokio::spawn(async move {
        let _ = child.wait().await;
        println!("js-debug process exited");
    });

    tokio::spawn(async move {
        loop {
            if let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(handle_js_connection(stream, dap_port));
            }
        }
    });

    Ok(port)
}

async fn handle_js_connection(stream: TcpStream, dap_port: u16) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => { eprintln!("JS WS accept error: {}", e); return; }
    };

    println!("JS debug connection accepted (multiplexing to port {})", dap_port);
    let (ws_sender, ws_receiver) = ws_stream.split();

    let mut tcp_stream = None;
    for i in 0..15 {
        // Try IPv4 first
        if let Ok(s) = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", dap_port)).await {
            tcp_stream = Some(s);
            break;
        }
        // Then try IPv6 (using [::1] syntax for IPv6 loopback)
        if let Ok(s) = tokio::net::TcpStream::connect(format!("[::1]:{}", dap_port)).await {
            tcp_stream = Some(s);
            break;
        }
        
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        if i % 3 == 0 {
            println!("Retrying multiplexed connection to js-debug port {} (attempt {})...", dap_port, i+1);
        }
    }

    let tcp_stream = match tcp_stream {
        Some(s) => s,
        None => { 
            eprintln!("Failed to connect to js-debug multiplexer at 127.0.0.1 or [::1] port {} after 15 attempts.", dap_port); 
            return; 
        }
    };

    println!("Multiplexed connection established to port {}", dap_port);
    let (tcp_rx, tcp_tx) = tcp_stream.into_split();
    bridge_stdio_to_ws(ws_sender, ws_receiver, tcp_tx, tokio::io::BufReader::new(tcp_rx), None).await;
}


// ── Shared DAP stdio<->WebSocket Bridge ──────────────────────────────────────
async fn bridge_stdio_to_ws<S, W, R>(
    mut ws_sender: S,
    mut ws_receiver: futures_util::stream::SplitStream<tokio_tungstenite::WebSocketStream<TcpStream>>,
    mut adapter_writer: W,
    adapter_reader: tokio::io::BufReader<R>,
    mut child: Option<tokio::process::Child>,
) where 
    S: futures_util::Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin + Send + 'static,
    W: AsyncWriteExt + Unpin + Send + 'static,
    R: AsyncReadExt + Unpin + Send + 'static,
{
    // WS → Process (wrap in Content-Length DAP frames)
    let stdin_task = tokio::spawn(async move {
        while let Some(msg) = ws_receiver.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    println!("[IDE -> DAP] {}", if text.len() > 200 { format!("{}...", &text[..197]) } else { text.to_string() });
                    let payload = format!("Content-Length: {}\r\n\r\n{}", text.len(), text);
                    if adapter_writer.write_all(payload.as_bytes()).await.is_err() { break; }
                }
                Ok(Message::Binary(bin)) => {
                    let text = String::from_utf8_lossy(&bin).to_string();
                    println!("[IDE -> DAP] (binary) {}", if text.len() > 200 { format!("{}...", &text[..197]) } else { text.to_string() });
                    let payload = format!("Content-Length: {}\r\n\r\n{}", text.len(), text);
                    if adapter_writer.write_all(payload.as_bytes()).await.is_err() { break; }
                }
                Ok(Message::Close(_)) => break,
                Err(_) => break,
                _ => {}
            }
        }
    });

    // process stdout → WS (parse Content-Length DAP frames)
    let stdout_task = tokio::spawn(async move {
        let mut reader = adapter_reader;
        loop {
            let mut content_length: usize = 0;

            // Read headers until blank line
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line).await {
                    Ok(0) => return,
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() { break; }
                        if trimmed.starts_with("Content-Length:") {
                            if let Some(v) = trimmed.splitn(2, ':').nth(1) {
                                content_length = v.trim().parse().unwrap_or(0);
                            }
                        }
                    }
                    Err(_) => return,
                }
            }

            if content_length > 0 {
                let mut body = vec![0u8; content_length];
                match reader.read_exact(&mut body).await {
                    Ok(_) => {
                        if let Ok(text) = String::from_utf8(body) {
                            println!("[DAP -> IDE] {}", if text.len() > 200 { format!("{}...", &text[..197]) } else { text.clone() });
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

    tokio::select! {
        res = stdin_task  => { println!("stdin_task finished: {:?}", res); },
        res = stdout_task => { println!("stdout_task finished: {:?}", res); },
        status = async {
            if let Some(mut c) = child {
                c.wait().await
            } else {
                futures_util::future::pending().await
            }
        } => { println!("Child process exited with status: {:?}", status); },
    }
}
