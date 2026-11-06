//! Immutable SQLite revisions. Loading preserves original results; it never recalculates.
use crate::{
    validate_input, AppError, CalculationInput, CalculationResult, MAX_DOCUMENT_BYTES,
    SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub production_parameters: Option<crate::production::ProductionParameters>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_limits: Option<crate::user_limits::UserLimits>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub materials: Option<crate::materials::MaterialSelection>,
    pub schema_version: u32,
    pub title: String,
    pub input: CalculationInput,
    pub last_calculation: Option<CalculationResult>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub casebook: Option<crate::cases::CaseBook>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Revision {
    pub id: String,
    pub title: String,
    pub saved_at_unix_ms: String,
}
pub struct ProjectStore {
    connection: Connection,
}
fn db_error(_: rusqlite::Error) -> AppError {
    AppError::new("database_error", None)
}

impl Project {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(AppError::new("unsupported_schema", Some("schema_version")));
        }
        if self.title.trim().is_empty() || self.title.chars().count() > 200 {
            return Err(AppError::new("invalid_title", Some("title")));
        }
        if let Some(p) = &self.production_parameters {
            crate::production::validate(p)?;
        }
        if let Some(limits) = &self.user_limits {
            crate::user_limits::validate(limits)?;
        }
        if let Some(materials) = &self.materials {
            crate::materials::validate(materials)?;
        }
        validate_input(&self.input)?;
        if let Some(result) = &self.last_calculation {
            if result.schema_version != SCHEMA_VERSION || result.input_snapshot != self.input {
                return Err(AppError::new("snapshot_mismatch", Some("last_calculation")));
            }
            let g = &result.geometry;
            let numbers = [
                g.length_mm,
                g.area_mm2,
                g.centroid_mm[0],
                g.centroid_mm[1],
                g.ix_mm4,
                g.iy_mm4,
                g.ixy_mm4,
                g.polar_mm4,
            ];
            let finite = numbers
                .iter()
                .chain(result.moment_at_centroid_n_mm.iter())
                .all(|v| v.is_finite())
                && result
                    .traction_mpa
                    .as_ref()
                    .is_none_or(|v| v.iter().all(|x| x.is_finite()));
            let finite = finite
                && result
                    .resultant_force_n
                    .as_ref()
                    .is_none_or(|v| v.iter().all(|x| x.is_finite()))
                && (result.input_snapshot.forces.is_some() == result.resultant_force_n.is_some());
            let consistent = match result.analysis_status {
                crate::AnalysisStatus::Computed => {
                    (result.traction_mpa.is_some()
                        && result.distribution.is_none()
                        && result.moment_at_centroid_n_mm.iter().all(|x| *x == 0.0))
                        || (result.traction_mpa.is_none()
                            && result.moment_at_centroid_n_mm.iter().any(|x| *x != 0.0)
                            && result.method_id == "elastic-line-traction-v1"
                            && result
                                .distribution
                                .as_ref()
                                .is_some_and(|d| d.valid_for(result)))
                }
                crate::AnalysisStatus::UnsupportedLoading => {
                    result.traction_mpa.is_none() && result.distribution.is_none()
                }
            };
            if !finite
                || !consistent
                || g.area_mm2 <= 0.0
                || g.length_mm <= 0.0
                || g.ix_mm4 < 0.0
                || g.iy_mm4 < 0.0
                || g.polar_mm4 < 0.0
            {
                return Err(AppError::new("invalid_snapshot", Some("last_calculation")));
            }
        }
        if let Some(book) = &self.casebook {
            book.validate(self)?;
        }
        Ok(())
    }
    pub fn from_json(text: &str) -> Result<Self, AppError> {
        if text.len() > MAX_DOCUMENT_BYTES {
            return Err(AppError::new("document_too_large", None));
        }
        let value: Self =
            serde_json::from_str(text).map_err(|_| AppError::new("invalid_json", None))?;
        value.validate()?;
        Ok(value)
    }
    pub fn to_json(&self) -> Result<String, AppError> {
        self.validate()?;
        let text =
            serde_json::to_string_pretty(self).map_err(|_| AppError::new("invalid_json", None))?;
        if text.len() > MAX_DOCUMENT_BYTES {
            return Err(AppError::new("document_too_large", None));
        }
        Ok(text)
    }
}
impl ProjectStore {
    pub fn open(path: &Path) -> Result<Self, AppError> {
        Self::from_connection(Connection::open(path).map_err(db_error)?)
    }
    pub fn in_memory() -> Result<Self, AppError> {
        Self::from_connection(Connection::open_in_memory().map_err(db_error)?)
    }
    fn from_connection(connection: Connection) -> Result<Self, AppError> {
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(db_error)?;
        if version > 2 {
            return Err(AppError::new("unsupported_database_schema", None));
        }
        if version == 0 {
            connection.execute_batch("BEGIN IMMEDIATE;
                CREATE TABLE project_revisions (id TEXT PRIMARY KEY, title TEXT NOT NULL, saved_at_unix_ms TEXT NOT NULL, document TEXT NOT NULL);
                PRAGMA user_version = 1; COMMIT;").map_err(db_error)?;
        }
        if version < 2 {
            connection
                .execute_batch(
                    "BEGIN IMMEDIATE;
                CREATE TABLE application_settings (name TEXT PRIMARY KEY, document TEXT NOT NULL);
                PRAGMA user_version = 2; COMMIT;",
                )
                .map_err(db_error)?;
        }
        Ok(Self { connection })
    }
    pub fn editor_settings(&self) -> Result<crate::settings::EditorSettings, AppError> {
        let text: Option<String> = self
            .connection
            .query_row(
                "SELECT document FROM application_settings WHERE name='editor_v1'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;
        match text {
            None => Ok(crate::settings::EditorSettings::default()),
            Some(text) => {
                let settings: crate::settings::EditorSettings = serde_json::from_str(&text)
                    .map_err(|_| AppError::new("invalid_settings", None))?;
                settings.validate()?;
                Ok(settings)
            }
        }
    }
    pub fn save_editor_settings(
        &self,
        settings: &crate::settings::EditorSettings,
    ) -> Result<(), AppError> {
        settings.validate()?;
        let text =
            serde_json::to_string(settings).map_err(|_| AppError::new("invalid_settings", None))?;
        self.connection
            .execute(
                "INSERT INTO application_settings(name, document) VALUES ('editor_v1', ?1)
            ON CONFLICT(name) DO UPDATE SET document=excluded.document",
                [text],
            )
            .map_err(db_error)?;
        Ok(())
    }
    pub fn save(&self, project: &Project) -> Result<String, AppError> {
        let text = project.to_json()?;
        let id = uuid::Uuid::new_v4().to_string();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| AppError::new("clock_error", None))?
            .as_millis()
            .to_string();
        self.connection.execute("INSERT INTO project_revisions (id, title, saved_at_unix_ms, document) VALUES (?1, ?2, ?3, ?4)",
            params![id, project.title, timestamp, text]).map_err(db_error)?;
        Ok(id)
    }
    pub fn list(&self) -> Result<Vec<Revision>, AppError> {
        let mut statement = self.connection.prepare("SELECT id, title, saved_at_unix_ms FROM project_revisions ORDER BY length(saved_at_unix_ms) DESC, saved_at_unix_ms DESC, rowid DESC LIMIT 100").map_err(db_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok(Revision {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    saved_at_unix_ms: row.get(2)?,
                })
            })
            .map_err(db_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
    }
    pub fn load(&self, id: &str) -> Result<Project, AppError> {
        let text: String = self
            .connection
            .query_row(
                "SELECT document FROM project_revisions WHERE id=?1",
                [id],
                |row| row.get(0),
            )
            .map_err(|e| {
                if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
                    AppError::new("project_not_found", None)
                } else {
                    db_error(e)
                }
            })?;
        Project::from_json(&text)
    }
}
