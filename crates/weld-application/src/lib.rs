//! GUI-independent application boundary. No normative acceptance method is enabled.
pub mod cases;
pub mod combinations;
pub mod forces;
pub mod geometry_templates;
pub mod geometry_transform;
pub mod inertia;
pub mod intermittent;
pub mod materials;
pub mod projects;
pub mod quantities;
pub mod sections;
pub mod settings;
pub mod user_limits;
pub mod width_study;

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
            weld_core::Error::IllConditionedSection => "ill_conditioned_section",
        };
        Self::new(code, None)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SegmentInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<sections::SectionModel>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forces: Option<Vec<forces::AppliedForce>>,
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
pub struct SegmentTraction {
    pub start_mpa: [f64; 3],
    pub end_mpa: [f64; 3],
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NominalDistribution {
    pub segments: Vec<SegmentTraction>,
    pub normal_range_mpa: [f64; 2],
    pub max_shear_mpa: f64,
    pub bending_rcond: Option<f64>,
    pub equilibrium_error: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalculationResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resultant_force_n: Option<[f64; 3]>,
    pub schema_version: u32,
    pub engine_version: String,
    pub method_id: String,
    pub input_snapshot: CalculationInput,
    pub geometry: GeometryResult,
    pub moment_at_centroid_n_mm: [f64; 3],
    pub traction_mpa: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distribution: Option<NominalDistribution>,
    pub analysis_status: AnalysisStatus,
    pub strength_status: StrengthStatus,
    pub validation_status: ValidationStatus,
    pub warnings: Vec<String>,
}

impl NominalDistribution {
    /// Structural snapshot validation only: never recalculates historical mechanics.
    pub fn valid_for(&self, result: &CalculationResult) -> bool {
        use weld_core::nominal::PRECISION_LIMIT;
        if self.segments.len() != result.input_snapshot.segments.len()
            || self.segments.is_empty()
            || !self.equilibrium_error.is_finite()
            || !(0.0..=PRECISION_LIMIT).contains(&self.equilibrium_error)
            || !self.max_shear_mpa.is_finite()
            || self.max_shear_mpa < 0.0
            || !self.normal_range_mpa.iter().all(|v| v.is_finite())
        {
            return false;
        }
        let bending = result.moment_at_centroid_n_mm[..2]
            .iter()
            .any(|v| *v != 0.0);
        match self.bending_rcond {
            Some(rcond)
                if bending && rcond.is_finite() && rcond > PRECISION_LIMIT && rcond <= 1.0 => {}
            None if !bending => {}
            _ => return false,
        }
        let mut low = f64::INFINITY;
        let mut high = f64::NEG_INFINITY;
        let mut shear: f64 = 0.0;
        for segment in &self.segments {
            for value in [segment.start_mpa, segment.end_mpa] {
                if value.iter().any(|v| !v.is_finite()) {
                    return false;
                }
                low = low.min(value[2]);
                high = high.max(value[2]);
                shear = shear.max(value[0].hypot(value[1]));
            }
        }
        low == self.normal_range_mpa[0]
            && high == self.normal_range_mpa[1]
            && shear.is_finite()
            && (shear - self.max_shear_mpa).abs()
                <= 16.0 * f64::EPSILON * shear.max(self.max_shear_mpa)
    }
}

fn point(p: [f64; 2]) -> Result<Point2, AppError> {
    Ok(Point2 {
        x: Millimetres::new(p[0])?,
        y: Millimetres::new(p[1])?,
    })
}

/// Exact rational predicates for the finite binary coordinates supplied by the
/// caller. No geometric tolerance or rounding can turn a crossing into a pass.
/// AABB rejection keeps disjoint pairs out of the more expensive predicates.
fn check_layout(segments: &[SegmentInput]) -> Result<(), AppError> {
    use num_rational::BigRational;
    use std::cmp::Ordering;
    type ExactPoint = [BigRational; 2];
    let exact: Vec<[ExactPoint; 2]> = segments
        .iter()
        .map(|s| {
            [s.start_mm, s.end_mm].map(|p| {
                p.map(|x| BigRational::from_float(x).expect("coordinates already checked finite"))
            })
        })
        .collect();
    let orientation = |p: &ExactPoint, q: &ExactPoint, r: &ExactPoint| {
        let value = (&q[0] - &p[0]) * (&r[1] - &p[1]) - (&q[1] - &p[1]) * (&r[0] - &p[0]);
        value.cmp(&BigRational::from_integer(0.into()))
    };
    let opposite = |a: Ordering, b: Ordering| {
        (a == Ordering::Less && b == Ordering::Greater)
            || (a == Ordering::Greater && b == Ordering::Less)
    };
    let within = |p: [f64; 2], s: &SegmentInput| {
        (0..2).all(|axis| {
            p[axis] >= s.start_mm[axis].min(s.end_mm[axis])
                && p[axis] <= s.start_mm[axis].max(s.end_mm[axis])
        })
    };
    for (i, a) in segments.iter().enumerate() {
        for (j, b) in segments.iter().enumerate().skip(i + 1) {
            if (0..2).any(|axis| {
                a.start_mm[axis].min(a.end_mm[axis]) > b.start_mm[axis].max(b.end_mm[axis])
                    || b.start_mm[axis].min(b.end_mm[axis]) > a.start_mm[axis].max(a.end_mm[axis])
            }) {
                continue;
            }
            let [p, q] = &exact[i];
            let [s, t] = &exact[j];
            let o1 = orientation(p, q, s);
            let o2 = orientation(p, q, t);
            let o3 = orientation(s, t, p);
            let o4 = orientation(s, t, q);
            if [o1, o2, o3, o4].iter().all(|o| *o == Ordering::Equal) {
                let axis = usize::from(a.start_mm[0] == a.end_mm[0]);
                let low = a.start_mm[axis]
                    .min(a.end_mm[axis])
                    .max(b.start_mm[axis].min(b.end_mm[axis]));
                let high = a.start_mm[axis]
                    .max(a.end_mm[axis])
                    .min(b.start_mm[axis].max(b.end_mm[axis]));
                if high > low {
                    return Err(AppError::new("overlapping_segments", Some("segments")));
                }
                continue;
            }
            let intersects = (opposite(o1, o2) && opposite(o3, o4))
                || (o1 == Ordering::Equal && within(b.start_mm, a))
                || (o2 == Ordering::Equal && within(b.end_mm, a))
                || (o3 == Ordering::Equal && within(a.start_mm, b))
                || (o4 == Ordering::Equal && within(a.end_mm, b));
            let shared_endpoint = [a.start_mm, a.end_mm]
                .iter()
                .any(|p| *p == b.start_mm || *p == b.end_mm);
            if intersects && !shared_endpoint {
                return Err(AppError::new("crossing_segments", Some("segments")));
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
    forces::validate(input)?;
    let segments: Vec<Segment> = input
        .segments
        .iter()
        .map(|s| {
            Ok(Segment {
                start: point(s.start_mm)?,
                end: point(s.end_mm)?,
                effective_width: Millimetres::new(sections::effective_width(s)?)?,
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
    let (total_force, moment) = forces::resultants(
        input,
        [geometry.centroid.x.value(), geometry.centroid.y.value()],
    )?;
    let f = total_force.map(Newtons::new);
    let force = [f[0].clone()?, f[1].clone()?, f[2].clone()?];
    let m = moment.map(NewtonMillimetres::new);
    let typed_moment = [m[0].clone()?, m[1].clone()?, m[2].clone()?];

    // Exact zero only: do not silently discard a small applied moment.
    let direct_only = moment.iter().all(|x| *x == 0.0);
    let traction = if direct_only {
        let value = weld_core::centred_direct_traction(&segments, force)?;
        Some([
            value.shear_x.value(),
            value.shear_y.value(),
            value.normal_z.value(),
        ])
    } else {
        None
    };
    let mut ill_conditioned = false;
    let distribution = if direct_only {
        None
    } else {
        match weld_core::nominal::nominal_traction(&segments, force, typed_moment) {
            Ok(value) => Some(NominalDistribution {
                segments: value
                    .segments
                    .into_iter()
                    .map(|s| SegmentTraction {
                        start_mpa: s.start.map(weld_core::Megapascals::value),
                        end_mpa: s.end.map(weld_core::Megapascals::value),
                    })
                    .collect(),
                normal_range_mpa: value.normal_range.map(weld_core::Megapascals::value),
                max_shear_mpa: value.max_shear.value(),
                bending_rcond: value.bending_rcond,
                equilibrium_error: value.equilibrium_error,
            }),
            Err(weld_core::Error::IllConditionedSection) => {
                ill_conditioned = true;
                None
            }
            Err(error) => return Err(error.into()),
        }
    };
    let supported = direct_only || distribution.is_some();
    let mut warnings = vec![
        "nominal_model_only".into(),
        "no_strength_acceptance".into(),
        "not_independently_validated".into(),
    ];
    if input.segments.iter().any(|s| s.section.is_some()) {
        warnings.push("idealized_section_geometry".into());
    }
    if ill_conditioned {
        warnings.push("ill_conditioned_section".into());
    }
    Ok(CalculationResult {
        resultant_force_n: input.forces.as_ref().map(|_| total_force),
        schema_version: SCHEMA_VERSION,
        engine_version: env!("CARGO_PKG_VERSION").into(),
        method_id: if direct_only {
            "uniform-direct-traction-v1"
        } else {
            "elastic-line-traction-v1"
        }
        .into(),
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
        distribution,
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
