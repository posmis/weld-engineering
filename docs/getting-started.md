# Начало работы

Актуальные инструкции для реализованного приложения: [desktop-workflow.md](desktop-workflow.md). Используйте существующий checkout; отдельный worktree без явного запроса не нужен.

Требуются Windows 10/11 x64, Node.js 24, Rust 1.99.1 MSVC (rust-toolchain.toml), C++ Build Tools/Windows SDK и WebView2. Cargo.lock и apps/desktop/package-lock.json фиксируют зависимости. Не запускать сборки и испытания приложения на Linux/macOS.

Из корня: `cargo test --locked -p weld-core -p weld-application`. Из apps/desktop: `npm ci`, `npm test`, `npm run tauri dev`. Полные команды форматирования, Clippy и release-сборки приведены в desktop-workflow.md.
