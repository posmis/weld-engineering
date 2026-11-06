//! Prismatic right-triangle quantities; no deposited-metal allowance or strength verdict.
use crate::{
    materials::{self, MaterialSelection, PropertyKind},
    sections::SectionModel,
    AppError, ApplicationPoint, CalculationInput, SegmentInput, SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuantityRequest {
    pub schema_version: u32,
    pub segments: Vec<SegmentInput>,
    pub materials: Option<MaterialSelection>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SegmentQuantity {
    pub segment_index: usize,
    pub length_mm: f64,
    pub section_area_mm2: Option<f64>,
    pub volume_mm3: Option<f64>,
    pub mass_kg: Option<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuantityResult {
    pub schema_version: u32,
    pub method_id: String,
    pub source: QuantityRequest,
    pub total_segments: usize,
    pub known_segments: usize,
    pub complete: bool,
    pub known_volume_mm3: f64,
    pub volume_mm3: Option<f64>,
    pub mass_kg: Option<f64>,
    pub density_kg_m3: Option<f64>,
    pub density_source: Option<String>,
    pub segments: Vec<SegmentQuantity>,
}
fn positive(value: f64) -> Result<f64, AppError> {
    if !value.is_finite() || value <= 0.0 || value.is_subnormal() {
        Err(AppError::new("numerical_range", Some("quantities")))
    } else {
        Ok(value)
    }
}
fn mass(volume: f64, density: Option<f64>) -> Result<Option<f64>, AppError> {
    density
        .map(|d| positive(positive(volume * 1e-9)? * d))
        .transpose()
}
pub fn evaluate(request: &QuantityRequest) -> Result<QuantityResult, AppError> {
    if request.schema_version != SCHEMA_VERSION {
        return Err(AppError::new("unsupported_schema", Some("schema_version")));
    }
    let input = CalculationInput {
        schema_version: SCHEMA_VERSION,
        segments: request.segments.clone(),
        force_n: [0.0; 3],
        couple_n_mm: [0.0; 3],
        application: ApplicationPoint::Centroid,
        forces: None,
    };
    let joint = crate::validate_input(&input)?;
    weld_core::properties(&joint)?;
    let density = request
        .materials
        .as_ref()
        .map(|selection| {
            materials::evaluate(&materials::MaterialRequest {
                schema_version: SCHEMA_VERSION,
                selection: selection.clone(),
            })
        })
        .transpose()?
        .and_then(|evaluation| {
            evaluation
                .weld
                .properties
                .into_iter()
                .find(|p| p.kind == PropertyKind::Density)
        });
    let density_value = density.as_ref().and_then(|p| p.value);
    let density_source = density.and_then(|p| p.source);
    let mut segments = Vec::with_capacity(request.segments.len());
    let mut known_volume = 0.0;
    let mut known = 0;
    for (index, segment) in request.segments.iter().enumerate() {
        let length = positive(
            (segment.end_mm[0] - segment.start_mm[0])
                .hypot(segment.end_mm[1] - segment.start_mm[1]),
        )?;
        let area = match segment.section {
            Some(SectionModel::IdealizedRightAngleFillet { leg_1_mm, leg_2_mm }) => {
                Some(positive(positive(leg_1_mm * 0.5)? * leg_2_mm)?)
            }
            None => None,
        };
        let volume = area.map(|a| positive(a * length)).transpose()?;
        if let Some(v) = volume {
            known_volume = positive(known_volume + v)?;
            known += 1;
        }
        segments.push(SegmentQuantity {
            segment_index: index,
            length_mm: length,
            section_area_mm2: area,
            volume_mm3: volume,
            mass_kg: volume
                .map(|v| mass(v, density_value))
                .transpose()?
                .flatten(),
        });
    }
    let complete = known == request.segments.len();
    let volume = complete.then_some(known_volume);
    Ok(QuantityResult {
        schema_version: SCHEMA_VERSION,
        method_id: "prismatic-right-triangle-quantities-v1".into(),
        source: request.clone(),
        total_segments: segments.len(),
        known_segments: known,
        complete,
        known_volume_mm3: known_volume,
        volume_mm3: volume,
        mass_kg: volume
            .map(|v| mass(v, density_value))
            .transpose()?
            .flatten(),
        density_kg_m3: density_value,
        density_source,
        segments,
    })
}
