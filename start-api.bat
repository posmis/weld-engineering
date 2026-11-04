@echo off
setlocal
cd /d "%~dp0"
where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust/Cargo was not found. Install Rust for Windows x64 and restart the terminal.
  pause
  exit /b 1
)
echo Starting the local calculation API. Keep this window open. Ctrl+C to stop.
cargo run --locked --release -p weld-api -- %*
if errorlevel 1 (
  echo API startup failed. See the error above.
  pause
  exit /b 1
)
