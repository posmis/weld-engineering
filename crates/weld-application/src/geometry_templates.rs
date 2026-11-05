//! Explicit axis-aligned line groups. These are construction tools, not GOST
//! joint types, throat/leg conversions or normative dimension recommendations.
use crate::{
    validate_input, AppError, ApplicationPoint, CalculationInput, SegmentInput, SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateKind {
    Rectangle,
    Parallel,
    UShape,
    LShape,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryTemplateRequest {
    pub schema_version: u32,
    pub kind: TemplateKind,
    pub width_mm: f64,
    pub height_mm: f64,
    pub effective_width_mm: f64,
    pub origin_mm: [f64; 2],
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryTemplateResult {
    pub schema_version: u32,
    pub segments: Vec<SegmentInput>,
}
pub fn generate(request: &GeometryTemplateRequest) -> Result<GeometryTemplateResult, AppError> {
    if request.schema_version != SCHEMA_VERSION {
        return Err(AppError::new("unsupported_schema", Some("schema_version")));
    }
    for (field, value) in [
        ("width_mm", request.width_mm),
        ("height_mm", request.height_mm),
        ("effective_width_mm", request.effective_width_mm),
    ] {
        if !value.is_finite() {
            return Err(AppError::new("non_finite", Some(field)));
        }
        if value <= 0.0 {
            return Err(AppError::new("non_positive_dimension", Some(field)));
        }
    }
    if !request.origin_mm.iter().all(|v| v.is_finite()) {
        return Err(AppError::new("non_finite", Some("origin_mm")));
    }
    let [x, y] = request.origin_mm;
    let xmin = x - request.width_mm / 2.0;
    let xmax = x + request.width_mm / 2.0;
    let ymin = y - request.height_mm / 2.0;
    let ymax = y + request.height_mm / 2.0;
    if ![xmin, xmax, ymin, ymax].iter().all(|v| v.is_finite()) || xmin >= xmax || ymin >= ymax {
        return Err(AppError::new("numerical_range", Some("origin_mm")));
    }
    let a = [xmin, ymin];
    let b = [xmax, ymin];
    let c = [xmax, ymax];
    let d = [xmin, ymax];
    let edges = match request.kind {
        TemplateKind::Rectangle => vec![(a, b), (b, c), (c, d), (d, a)],
        TemplateKind::Parallel => vec![(a, b), (d, c)],
        TemplateKind::UShape => vec![(d, a), (a, b), (b, c)],
        TemplateKind::LShape => vec![(a, d), (d, c)],
    };
    let input = CalculationInput {
        schema_version: SCHEMA_VERSION,
        segments: edges
            .into_iter()
            .map(|(start_mm, end_mm)| SegmentInput {
                start_mm,
                end_mm,
                effective_width_mm: request.effective_width_mm,
            })
            .collect(),
        force_n: [0.0; 3],
        couple_n_mm: [0.0; 3],
        application: ApplicationPoint::Centroid,
    };
    // Apply the same exact intersection, dimension and count validation as hand input.
    validate_input(&input)?;
    Ok(GeometryTemplateResult {
        schema_version: SCHEMA_VERSION,
        segments: input.segments,
    })
}
