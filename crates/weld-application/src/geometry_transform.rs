//! Rigid XY editing of explicit line geometry; loads remain in the global frame.
use crate::{
    geometry_templates::GeometryTemplateResult, validate_input, AppError, ApplicationPoint,
    CalculationInput, SegmentInput, SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MirrorAxis {
    X,
    Y,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Transform {
    Translate {
        delta_mm: [f64; 2],
    },
    Rotate {
        origin_mm: [f64; 2],
        angle_deg: f64,
    },
    Mirror {
        origin_mm: [f64; 2],
        axis: MirrorAxis,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryTransformRequest {
    pub schema_version: u32,
    pub segments: Vec<SegmentInput>,
    pub transform: Transform,
}
pub fn transform(request: &GeometryTransformRequest) -> Result<GeometryTemplateResult, AppError> {
    let mut input = CalculationInput {
        schema_version: request.schema_version,
        segments: request.segments.clone(),
        force_n: [0.0; 3],
        couple_n_mm: [0.0; 3],
        application: ApplicationPoint::Centroid,
    };
    validate_input(&input)?;
    let finite = match request.transform {
        Transform::Translate { delta_mm } => delta_mm.iter().all(|v| v.is_finite()),
        Transform::Rotate {
            origin_mm,
            angle_deg,
        } => origin_mm.iter().all(|v| v.is_finite()) && angle_deg.is_finite(),
        Transform::Mirror { origin_mm, .. } => origin_mm.iter().all(|v| v.is_finite()),
    };
    if !finite {
        return Err(AppError::new("non_finite", Some("transform")));
    }
    let (sin, cos) = if let Transform::Rotate { angle_deg, .. } = request.transform {
        // Exact quarter turns preserve shared coordinates and horizontal/vertical edges.
        match angle_deg.rem_euclid(360.0) {
            0.0 => (0.0, 1.0),
            90.0 => (1.0, 0.0),
            180.0 => (0.0, -1.0),
            270.0 => (-1.0, 0.0),
            angle => angle.to_radians().sin_cos(),
        }
    } else {
        (0.0, 1.0)
    };
    let point = |p: [f64; 2]| match request.transform {
        Transform::Translate { delta_mm } => [p[0] + delta_mm[0], p[1] + delta_mm[1]],
        Transform::Rotate {
            origin_mm: [x, y], ..
        } => {
            let dx = p[0] - x;
            let dy = p[1] - y;
            [dx * cos - dy * sin + x, dx * sin + dy * cos + y]
        }
        Transform::Mirror { origin_mm, axis } => {
            let i = match axis {
                MirrorAxis::X => 1,
                MirrorAxis::Y => 0,
            };
            let mut next = p;
            next[i] = origin_mm[i] + (origin_mm[i] - p[i]);
            next
        }
    };
    for segment in &mut input.segments {
        let old = (segment.end_mm[0] - segment.start_mm[0])
            .hypot(segment.end_mm[1] - segment.start_mm[1]);
        segment.start_mm = point(segment.start_mm);
        segment.end_mm = point(segment.end_mm);
        let next = (segment.end_mm[0] - segment.start_mm[0])
            .hypot(segment.end_mm[1] - segment.start_mm[1]);
        if !old.is_finite()
            || !next.is_finite()
            || next <= 0.0
            || (next - old).abs() > old * f64::EPSILON.sqrt()
        {
            return Err(AppError::new("numerical_range", Some("transform")));
        }
    }
    validate_input(&input)?;
    Ok(GeometryTemplateResult {
        schema_version: SCHEMA_VERSION,
        segments: input.segments,
    })
}
