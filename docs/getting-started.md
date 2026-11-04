# Начало работы — Windows 10/11 x64

Используйте существующий checkout: облачные задания уже изолированы, отдельный Git worktree без явного запроса не нужен.

Установите официальный stable Rust MSVC через rustup и Visual Studio Build Tools с C++ workload/Windows SDK. В PowerShell из корня репозитория:

```powershell
rustup toolchain install stable --profile minimal --component rustfmt --component clippy
cargo +stable fmt --all -- --check
cargo +stable clippy --workspace --all-targets -- -D warnings
cargo +stable test --workspace
```

Эти команды подготовлены для Windows, но в текущей Linux-среде не выполнялись. Зафиксировать точную версию Rust и lockfile после первого успешного Windows-прогона. Внешних Cargo-зависимостей сейчас нет.

Tauri/React, WebView2 и SQLite ещё не реализованы: команды запуска приложения отсутствуют. Не устанавливать Linux GUI-зависимости и не выполнять Linux/macOS сборки. При реализации Tauri использовать официальные требования Windows Tauri 2 и WebView2; frontend не должен выполнять инженерные вычисления.
