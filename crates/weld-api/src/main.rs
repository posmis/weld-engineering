#[cfg(not(target_os = "windows"))]
compile_error!("Initial Weld Engineering API development targets Windows only.");
use std::{io::Write, path::PathBuf};
struct TokenFile {
    path: PathBuf,
    token: String,
}
impl Drop for TokenFile {
    fn drop(&mut self) {
        if std::fs::read_to_string(&self.path).is_ok_and(|value| value == self.token) {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut port: u16 = 1421;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--help" {
            println!("weld-api [--port 1421]\nLoopback only. Token file: %LOCALAPPDATA%/WeldEngineering/api-PORT.token\nCtrl+C stops the API and removes its token file.");
            return Ok(());
        }
        if arg != "--port" {
            return Err("Unknown argument. Use --help.".into());
        }
        port = args.next().ok_or("Missing port")?.parse()?;
        if port == 0 {
            return Err("Port must be 1..65535".into());
        }
    }
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    let directory =
        PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is missing")?)
            .join("WeldEngineering");
    std::fs::create_dir_all(&directory)?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let path = directory.join(format!("api-{port}.token"));
    // This file lives under the Windows user's local profile; never print credentials.
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&path)?;
    file.write_all(token.as_bytes())?;
    file.sync_all()?;
    drop(file); // Release the Windows write handle before clients read the token.
    let _token_file = TokenFile {
        path: path.clone(),
        token: token.clone(),
    };
    println!("Weld Engineering API: http://127.0.0.1:{port}/api/v1\nBearer token file: {}\nStrength calculation is unavailable. Ctrl+C to stop.", path.display());
    axum::serve(listener, weld_api::router(token))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
