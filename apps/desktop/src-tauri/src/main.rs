#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
compile_error!("Initial Weld Engineering desktop development targets Windows only.");

use std::sync::Mutex;
use tauri::Manager;
use weld_application::{
    calculate,
    projects::{Project, ProjectStore, Revision},
    settings::EditorSettings,
    AppError, CalculationInput, CalculationResult,
};

#[tauri::command]
fn calculate_load_cases(
    project: Project,
) -> Result<weld_application::cases::BatchResult, AppError> {
    weld_application::cases::calculate_cases(&project)
}
#[tauri::command]
fn summarize_load_cases(
    project: Project,
) -> Result<weld_application::cases::CaseSummary, AppError> {
    weld_application::cases::summarize_cases(&project)
}

type Store = Mutex<ProjectStore>;
#[tauri::command]
fn calculate_joint(input: CalculationInput) -> Result<CalculationResult, AppError> {
    calculate(&input)
}
#[tauri::command]
fn save_project(project: Project, store: tauri::State<'_, Store>) -> Result<String, AppError> {
    store
        .lock()
        .map_err(|_| AppError::new("database_error", None))?
        .save(&project)
}
#[tauri::command]
fn list_projects(store: tauri::State<'_, Store>) -> Result<Vec<Revision>, AppError> {
    store
        .lock()
        .map_err(|_| AppError::new("database_error", None))?
        .list()
}
#[tauri::command]
fn open_project(id: String, store: tauri::State<'_, Store>) -> Result<Project, AppError> {
    store
        .lock()
        .map_err(|_| AppError::new("database_error", None))?
        .load(&id)
}
#[tauri::command]
fn import_project(text: String) -> Result<Project, AppError> {
    Project::from_json(&text)
}
#[tauri::command]
fn export_project(project: Project) -> Result<String, AppError> {
    project.to_json()
}

#[tauri::command]
fn get_editor_settings(store: tauri::State<'_, Store>) -> Result<EditorSettings, AppError> {
    store
        .lock()
        .map_err(|_| AppError::new("database_error", None))?
        .editor_settings()
}
#[tauri::command]
fn save_editor_settings(
    settings: EditorSettings,
    store: tauri::State<'_, Store>,
) -> Result<(), AppError> {
    store
        .lock()
        .map_err(|_| AppError::new("database_error", None))?
        .save_editor_settings(&settings)
}
#[tauri::command]
async fn save_pdf_report(bytes: Vec<u8>) -> Result<bool, AppError> {
    if bytes.len() > 16 * 1024 * 1024 || !bytes.starts_with(b"%PDF-") {
        return Err(AppError::new("invalid_report", None));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .set_title("Weld Engineering — PDF")
            .add_filter("PDF", &["pdf"])
            .set_file_name("weld-report.pdf")
            .save_file()
        else {
            return Ok(false);
        };
        std::fs::write(path, bytes).map_err(|_| AppError::new("report_write_error", None))?;
        Ok(true)
    })
    .await
    .map_err(|_| AppError::new("report_write_error", None))?
}
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let store = ProjectStore::open(&directory.join("projects.sqlite"))
                .map_err(|_| std::io::Error::other("Cannot initialize project database"))?;
            app.manage(Mutex::new(store));
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(debug_assertions)]
                let developer_tools =
                    std::env::var_os("WELD_DEVTOOLS").is_some_and(|value| value == "1");
                #[cfg(not(debug_assertions))]
                let developer_tools = false;
                window.with_webview(move |view| {
                    // WebView2 settings are applied to this UI-thread-owned controller.
                    let configured = unsafe {
                        view.controller().CoreWebView2().and_then(|webview| {
                            let settings = webview.Settings()?;
                            settings.SetAreDefaultContextMenusEnabled(false)?;
                            settings.SetAreDevToolsEnabled(developer_tools)?;
                            if developer_tools {
                                webview.OpenDevToolsWindow()?;
                            }
                            Ok(())
                        })
                    };
                    if let Err(error) = configured {
                        eprintln!("Cannot configure desktop WebView settings: {error}");
                    }
                })?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_pdf_report,
            calculate_joint,
            calculate_load_cases,
            summarize_load_cases,
            save_project,
            list_projects,
            open_project,
            import_project,
            export_project,
            get_editor_settings,
            save_editor_settings
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run Weld Engineering");
}
