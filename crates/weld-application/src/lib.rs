//! GUI-independent application boundary. No normative acceptance method is enabled.
pub mod projects;

use serde::{Deserialize, Serialize};
use weld_core::{Millimetres, NewtonMillimetres, Newtons, Point2, Segment};

pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_SEGMENTS: usize = 256;
pub const MAX_DOCUMENT_BYTES: usize = 1_048_576;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppError {
    pub code: String,
    pub field: Option<String>,
}
impl AppError {
    pub fn new(code: &str, field: Option<&str>) -> Self {
        Self {
            code: code.into(),
            field: field.map(str::to_owned),
        }
    }
}
impl From<weld_core::Error> for AppError {
    fn from(error: weld_core::Error) -> Self {
        let code = match error {
            weld_core::Error::NonFinite => "non_finite",
            weld_core::Error::NonPositiveDimension => "non_positive_dimension",
            weld_core::Error::EmptyGroup => "empty_group",
            weld_core::Error::ZeroLength => "zero_length",
            weld_core::Error::NumericalRange => "numerical_range",
            weld_core::Error::UnsupportedMethod => "unsupported_method",
        };
        Self::new(code, None)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SegmentInput {
    pub start_mm: [f64; 2],
    pub end_mm: [f64; 2],
    pub effective_width_mm: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ApplicationPoint {
    Centroid,
    Point { point_mm: [f64; 3] },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalculationInput {
    pub schema_version: u32,
    pub segments: Vec<SegmentInput>,
    pub force_n: [f64; 3],
    pub couple_n_mm: [f64; 3],
    pub application: ApplicationPoint,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryResult {
    pub length_mm: f64,
    pub area_mm2: f64,
    pub centroid_mm: [f64; 2],
    pub ix_mm4: f64,
    pub iy_mm4: f64,
    pub ixy_mm4: f64,
    pub polar_mm4: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisStatus {
    Computed,
    UnsupportedLoading,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrengthStatus {
    UnsupportedCalculation,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationStatus {
    NotIndependentlyValidated,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalculationResult {
    pub schema_version: u32,
    pub engine_version: String,
    pub method_id: String,
    pub input_snapshot: CalculationInput,
    pub geometry: GeometryResult,
    pub moment_at_centroid_n_mm: [f64; 3],
    pub traction_mpa: Option<[f64; 3]>,
    pub analysis_status: AnalysisStatus,
    pub strength_status: StrengthStatus,
    pub validation_status: ValidationStatus,
    pub warnings: Vec<String>,
}

fn point(p: [f64; 2]) -> Result<Point2, AppError> {
    Ok(Point2 {
        x: Millimetres::new(p[0])?,
        y: Millimetres::new(p[1])?,
    })
}

/// Conservative layout boundary: segments may meet at endpoints, but must not
/// cross or overlap. Roundoff-ambiguous near-collinear pairs are rejected.
/// EPSILON.sqrt() limits unresolved geometric predicates, not engineering size.
fn check_layout(segments: &[SegmentInput]) -> Result<(), AppError> {
    for (i, a) in segments.iter().enumerate() {
        for b in &segments[i + 1..] {
            let scale = [a.start_mm, a.end_mm, b.start_mm, b.end_mm]
                .iter()
                .flatten()
                .fold(1.0_f64, |v, x| v.max(x.abs()));
            let p = a.start_mm.map(|x| x / scale);
            let q = a.end_mm.map(|x| x / scale);
            let s = b.start_mm.map(|x| x / scale);
            let t = b.end_mm.map(|x| x / scale);
            let delta = |x: [f64; 2], y: [f64; 2]| [x[0] - y[0], x[1] - y[1]];
            let cross = |x: [f64; 2], y: [f64; 2]| x[0] * y[1] - x[1] * y[0];
            let d = delta(q, p);
            let e = delta(t, s);
            let v = delta(s, p);
            let den = cross(d, e);
            let tol = f64::EPSILON.sqrt();
            if den.abs() <= tol * d[0].hypot(d[1]) * e[0].hypot(e[1]) {
                if cross(v, d).abs() <= tol * d[0].hypot(d[1]) * v[0].hypot(v[1]).max(tol) {
                    let axis = usize::from(d[1].abs() > d[0].abs());
                    let low = p[axis].min(q[axis]).max(s[axis].min(t[axis]));
                    let high = p[axis].max(q[axis]).min(s[axis].max(t[axis]));
                    if high > low {
                        return Err(AppError::new("overlapping_segments", Some("segments")));
                    }
                }
            } else {
                let u = cross(v, e) / den;
                let w = cross(v, d) / den;
                if (0.0..=1.0).contains(&u) && (0.0..=1.0).contains(&w) {
                    let shared_endpoint = [a.start_mm, a.end_mm]
                        .iter()
                        .any(|p| *p == b.start_mm || *p == b.end_mm);
                    if !shared_endpoint {
                        return Err(AppError::new("crossing_segments", Some("segments")));
                    }
                }
            }
        }
    }
    Ok(())
}

pub fn validate_input(input: &CalculationInput) -> Result<Vec<Segment>, AppError> {
    if input.schema_version != SCHEMA_VERSION {
        return Err(AppError::new("unsupported_schema", Some("schema_version")));
    }
    if input.segments.is_empty() || input.segments.len() > MAX_SEGMENTS {
        return Err(AppError::new("segment_count", Some("segments")));
    }
    let segments: Vec<Segment> = input
        .segments
        .iter()
        .map(|s| {
            Ok(Segment {
                start: point(s.start_mm)?,
                end: point(s.end_mm)?,
                effective_width: Millimetres::new(s.effective_width_mm)?,
            })
        })
        .collect::<Result<_, AppError>>()?;
    for s in &segments {
        if s.effective_width.value() <= 0.0 {
            return Err(AppError::new("non_positive_dimension", Some("segments")));
        }
        if s.start.x == s.end.x && s.start.y == s.end.y {
            return Err(AppError::new("zero_length", Some("segments")));
        }
    }
    for value in input.force_n.iter().chain(input.couple_n_mm.iter()) {
        if !value.is_finite() {
            return Err(AppError::new("non_finite", None));
        }
    }
    if let ApplicationPoint::Point { point_mm } = input.application {
        if point_mm.iter().any(|x| !x.is_finite()) {
            return Err(AppError::new("non_finite", Some("application")));
        }
    }
    check_layout(&input.segments)?;
    Ok(segments)
}

pub fn calculate(input: &CalculationInput) -> Result<CalculationResult, AppError> {
    let segments = validate_input(input)?;
    let geometry = weld_core::properties(&segments)?;
    let f = input.force_n.map(Newtons::new);
    let force = [f[0].clone()?, f[1].clone()?, f[2].clone()?];
    let m = input.couple_n_mm.map(NewtonMillimetres::new);
    let couple = [m[0].clone()?, m[1].clone()?, m[2].clone()?];
    let centroid = [
        geometry.centroid.x,
        geometry.centroid.y,
        Millimetres::new(0.0)?,
    ];
    let application = match input.application {
        ApplicationPoint::Centroid => centroid,
        ApplicationPoint::Point { point_mm } => [
            Millimetres::new(point_mm[0])?,
            Millimetres::new(point_mm[1])?,
            Millimetres::new(point_mm[2])?,
        ],
    };
    let moment = weld_core::moment_about(force, couple, application, centroid)?
        .map(NewtonMillimetres::value);
    // Exact zero only: do not silently discard a small applied moment.
    let supported = moment.iter().all(|x| *x == 0.0);
    let traction = if supported {
        let value = weld_core::centred_direct_traction(&segments, force)?;
        Some([
            value.shear_x.value(),
            value.shear_y.value(),
            value.normal_z.value(),
        ])
    } else {
        None
    };
    let mut warnings = vec![
        "nominal_model_only".into(),
        "no_strength_acceptance".into(),
        "not_independently_validated".into(),
    ];
    if !supported {
        warnings.push("moments_not_supported".into());
    }
    Ok(CalculationResult {
        schema_version: SCHEMA_VERSION,
        engine_version: env!("CARGO_PKG_VERSION").into(),
        method_id: "uniform-direct-traction-v1".into(),
        input_snapshot: input.clone(),
        geometry: GeometryResult {
            length_mm: geometry.length.value(),
            area_mm2: geometry.area.value(),
            centroid_mm: [geometry.centroid.x.value(), geometry.centroid.y.value()],
            ix_mm4: geometry.ix.value(),
            iy_mm4: geometry.iy.value(),
            ixy_mm4: geometry.ixy.value(),
            polar_mm4: geometry.polar.value(),
        },
        moment_at_centroid_n_mm: moment,
        traction_mpa: traction,
        analysis_status: if supported {
            AnalysisStatus::Computed
        } else {
            AnalysisStatus::UnsupportedLoading
        },
        strength_status: StrengthStatus::UnsupportedCalculation,
        validation_status: ValidationStatus::NotIndependentlyValidated,
        warnings,
    })
}
