use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::sync::watch;

/// MJPEG HTTP server that streams preview frames on `http://127.0.0.1:{port}/preview`.
///
/// The browser renders `multipart/x-mixed-replace` natively — hardware-accelerated
/// image decoding, zero JS per frame, no IPC overhead.
pub struct MjpegServer {
    port: u16,
    task: tokio::task::JoinHandle<()>,
    stop: Arc<AtomicBool>,
}

impl MjpegServer {
    /// Start the MJPEG server on a random available port.
    /// Returns immediately; the server runs in a background tokio task.
    pub async fn start(rx: watch::Receiver<Option<Vec<u8>>>) -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("MJPEG bind failed: {}", e))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = stop.clone();

        eprintln!("[screen] MJPEG server listening on 127.0.0.1:{}", port);

        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    result = listener.accept() => {
                        match result {
                            Ok((stream, _addr)) => {
                                let rx = rx.clone();
                                let stop = stop_clone.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = handle_connection(stream, rx, stop).await {
                                        // Client disconnected — normal
                                        let _ = e;
                                    }
                                });
                            }
                            Err(e) => {
                                eprintln!("[screen] MJPEG accept error: {}", e);
                                break;
                            }
                        }
                    }
                }
            }
        });

        Ok(Self { port, task, stop })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn stop(self) {
        self.stop.store(true, Ordering::Release);
        self.task.abort();
        eprintln!("[screen] MJPEG server stopped");
    }
}

const BOUNDARY: &str = "frame";

async fn handle_connection(
    mut stream: tokio::net::TcpStream,
    mut rx: watch::Receiver<Option<Vec<u8>>>,
    stop: Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Read the HTTP request (we don't care about the contents, just consume it)
    let mut req_buf = vec![0u8; 4096];
    let _ = stream.read(&mut req_buf).await?;

    // Send HTTP response headers
    let header = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: multipart/x-mixed-replace; boundary={}\r\n\
         Cache-Control: no-cache, no-store\r\n\
         Connection: close\r\n\
         Access-Control-Allow-Origin: *\r\n\
         \r\n",
        BOUNDARY
    );
    stream.write_all(header.as_bytes()).await?;

    // Stream JPEG frames
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }

        // Wait for the next frame (watch::changed skips stale values)
        rx.changed().await?;

        let jpeg = {
            let val = rx.borrow_and_update();
            match val.as_ref() {
                Some(data) => data.clone(),
                None => continue,
            }
        };

        let part = format!(
            "--{}\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n",
            BOUNDARY,
            jpeg.len()
        );
        stream.write_all(part.as_bytes()).await?;
        stream.write_all(&jpeg).await?;
        stream.write_all(b"\r\n").await?;
    }

    Ok(())
}

use tokio::io::AsyncReadExt;
