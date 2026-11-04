use rusqlite::Connection;
use weld_application::{projects::ProjectStore, settings::EditorSettings};
#[test]
fn invalid_preferences_do_not_overwrite_saved_settings() {
    let store = ProjectStore::in_memory().unwrap();
    assert_eq!(store.editor_settings().unwrap(), EditorSettings::default());
    let saved = EditorSettings {
        movement_step_mm: 5.0,
        ..Default::default()
    };
    store.save_editor_settings(&saved).unwrap();
    for step in [0.0, -1.0, f64::INFINITY, f64::NAN] {
        assert!(store
            .save_editor_settings(&EditorSettings {
                movement_step_mm: step,
                ..saved.clone()
            })
            .is_err());
    }
    for radius in [0.0, 65.0, f64::NAN] {
        assert!(store
            .save_editor_settings(&EditorSettings {
                snap_tolerance_px: radius,
                ..saved.clone()
            })
            .is_err());
    }
    assert_eq!(store.editor_settings().unwrap(), saved);
}
#[test]
fn version_one_database_migrates_without_losing_project_documents_and_preferences_persist() {
    let path = std::env::temp_dir().join(format!("weld-settings-{}.sqlite", uuid::Uuid::new_v4()));
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch("CREATE TABLE project_revisions(id TEXT PRIMARY KEY, title TEXT NOT NULL, saved_at_unix_ms TEXT NOT NULL, document TEXT NOT NULL);
        INSERT INTO project_revisions VALUES ('old','preserved','1','original snapshot'); PRAGMA user_version=1;").unwrap();
    drop(connection);
    let settings = EditorSettings {
        movement_step_mm: 0.5,
        snap_grid: true,
        ..Default::default()
    };
    let store = ProjectStore::open(&path).unwrap();
    store.save_editor_settings(&settings).unwrap();
    drop(store);
    let store = ProjectStore::open(&path).unwrap();
    assert_eq!(store.editor_settings().unwrap(), settings);
    drop(store);
    let connection = Connection::open(&path).unwrap();
    let document: String = connection
        .query_row(
            "SELECT document FROM project_revisions WHERE id='old'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(document, "original snapshot");
    drop(connection);
    std::fs::remove_file(path).unwrap();
}
