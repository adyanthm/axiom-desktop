use axum::{
    extract::State,
    http::{StatusCode, Uri},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use axum::response::sse::{Event, Sse};
use futures_core::stream::Stream;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;

#[derive(Clone)]
pub struct LiveServerState {
    pub tx: broadcast::Sender<()>,
}

const INJECT_SCRIPT: &str = r#"
<!-- Code injected by Axiom IDE Live Server -->
<script type="text/javascript">
    if ('WebSocket' in window || 'EventSource' in window) {
        const source = new EventSource('/__live_server_reload');
        source.onmessage = function (event) {
            if (event.data === 'reload') {
                window.location.reload();
            }
        };
        console.log('Axiom Live Server connected.');
    }
</script>
"#;

pub async fn start_live_server(mut port: u16, dir: String) -> Result<(u16, broadcast::Sender<()>), String> {
    let (tx, _rx) = broadcast::channel(16);
    let state = LiveServerState {
        tx: tx.clone(),
    };

    // Our router
    let app = Router::new()
        .route("/__live_server_reload", get(reload_handler))
        .fallback(
            get(move |uri: Uri| async move {
                handle_fallback(uri, &dir).await
            })
        )
        .with_state(Arc::new(state));

    let mut listener = None;
    let mut attempts = 0;
    while attempts < 10 {
        match TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).await {
            Ok(l) => {
                listener = Some(l);
                break;
            }
            Err(_) => {
                port += 1;
                attempts += 1;
            }
        }
    }

    let listener = listener.ok_or_else(|| "Failed to bind to any port".to_string())?;
    let final_port = port;

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            log::error!("Live server error: {}", e);
        }
    });

    Ok((final_port, tx))
}

async fn reload_handler(State(state): State<Arc<LiveServerState>>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.tx.subscribe();
    let stream = BroadcastStream::new(rx);

    // Map the broadcast messages into SSE Events
    use tokio_stream::StreamExt;
    let event_stream = stream.filter_map(|res| {
        match res {
            Ok(_) => Some(Ok(Event::default().data("reload"))),
            Err(_) => None,
        }
    });

    Sse::new(event_stream).keep_alive(axum::response::sse::KeepAlive::new())
}

async fn handle_fallback(uri: Uri, base_dir: &str) -> Response {
    let path = uri.path();
    let mut clean_path = path.trim_start_matches('/');
    if clean_path.is_empty() {
        clean_path = "index.html";
    }
    
    // Check if the file requested is an HTML file
    let full_path = Path::new(base_dir).join(clean_path);
    if full_path.is_file() && full_path.extension().map(|e| e == "html").unwrap_or(false) {
        if let Ok(content) = std::fs::read_to_string(&full_path) {
            let mut modified = content;
            if let Some(idx) = modified.rfind("</body>") {
                modified.insert_str(idx, INJECT_SCRIPT);
            } else {
                modified.push_str(INJECT_SCRIPT);
            }
            return Html(modified).into_response();
        }
    } else if full_path.is_dir() {
        let index_path = full_path.join("index.html");
        if index_path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&index_path) {
                let mut modified = content;
                if let Some(idx) = modified.rfind("</body>") {
                    modified.insert_str(idx, INJECT_SCRIPT);
                } else {
                    modified.push_str(INJECT_SCRIPT);
                }
                return Html(modified).into_response();
            }
        }
    }

    // fallback to normal File ServeDir
    // In axum 0.8, ServeDir is a tower Service, so we can't just easily call it from here as a handler without boilerplate
    // Alternatively, we just read the file manually
    if full_path.is_file() {
        // use basic content-type deduction
        let mime = mime_guess::from_path(&full_path).first_or_octet_stream();
        if let Ok(bytes) = std::fs::read(&full_path) {
            return (
                [(axum::http::header::CONTENT_TYPE, mime.as_ref())],
                bytes,
            ).into_response();
        }
    }

    (StatusCode::NOT_FOUND, "Not Found").into_response()
}
