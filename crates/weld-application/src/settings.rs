//! Editor preferences are independent of project inputs and calculation snapshots.
use crate::AppError;
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditorSettings {
    pub schema_version: u32,
    pub movement_step_mm: f64,
    pub grid_step_mm: f64,
    pub snap_tolerance_px: f64,
    #[serde(default)]
    pub show_grid: bool,
    pub snap_grid: bool,
    pub snap_endpoints: bool,
    pub snap_midpoints: bool,
    pub snap_axes: bool,
}
impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            movement_step_mm: 1.0,
            grid_step_mm: 1.0,
            snap_tolerance_px: 10.0,
            show_grid: false,
            snap_grid: false,
            snap_endpoints: true,
            snap_midpoints: false,
            snap_axes: false,
        }
    }
}
impl EditorSettings {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.schema_version != 1
            || !self.movement_step_mm.is_finite()
            || self.movement_step_mm <= 0.0
            || !self.grid_step_mm.is_finite()
            || self.grid_step_mm <= 0.0
            || !self.snap_tolerance_px.is_finite()
            || !(1.0..=64.0).contains(&self.snap_tolerance_px)
        {
            return Err(AppError::new("invalid_settings", None));
        }
        Ok(())
    }
}
