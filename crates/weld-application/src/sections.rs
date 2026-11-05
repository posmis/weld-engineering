//! Explicit section provenance for geometric idealizations. Not a GOST catalog.
use crate::{AppError, SegmentInput, SCHEMA_VERSION};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SectionModel {
    IdealizedRightAngleFillet { leg_1_mm: f64, leg_2_mm: f64 },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SectionRequest {
    pub schema_version: u32,
    pub model: SectionModel,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SectionResult {
    pub schema_version: u32,
    pub model: SectionModel,
    pub effective_width_mm: f64,
    pub method_id: String,
    pub status: SectionStatus,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SectionStatus {
    IdealizedGeometry,
}
pub fn width(model: &SectionModel) -> Result<f64, AppError> {
    match *model {
        SectionModel::IdealizedRightAngleFillet { leg_1_mm, leg_2_mm } => {
            Ok(weld_core::section::right_angle_fillet_throat(
                weld_core::Millimetres::new(leg_1_mm)?,
                weld_core::Millimetres::new(leg_2_mm)?,
            )?
            .value())
        }
    }
}
pub fn derive(request: &SectionRequest) -> Result<SectionResult, AppError> {
    if request.schema_version != SCHEMA_VERSION {
        return Err(AppError::new("unsupported_schema", Some("schema_version")));
    }
    Ok(SectionResult {
        schema_version: SCHEMA_VERSION,
        model: request.model.clone(),
        effective_width_mm: width(&request.model)?,
        method_id: "right-angle-fillet-altitude-v1".into(),
        status: SectionStatus::IdealizedGeometry,
    })
}
pub fn effective_width(segment: &SegmentInput) -> Result<f64, AppError> {
    let supplied = weld_core::Millimetres::new(segment.effective_width_mm)?.value();
    if let Some(model) = &segment.section {
        let derived = width(model)?;
        if supplied <= 0.0 || (supplied - derived).abs() / derived > 8.0 * f64::EPSILON {
            return Err(AppError::new(
                "section_width_mismatch",
                Some("segments.section"),
            ));
        }
        return Ok(derived);
    }
    Ok(supplied)
}
