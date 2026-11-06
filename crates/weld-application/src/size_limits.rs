//! Explicit user size ranges; no normative or manufacturing limits are supplied.
use crate::{
    sections::{self, SectionModel},
    AppError, SegmentInput,
};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SizeDimension {
    EffectiveWidth,
    #[serde(rename = "leg_1")]
    Leg1,
    #[serde(rename = "leg_2")]
    Leg2,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SizeConstraint {
    pub dimension: SizeDimension,
    pub minimum_mm: f64,
    pub maximum_mm: f64,
    pub source: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SizeStatus {
    WithinLimits,
    ExceedsLimits,
    Unknown,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SizeValue {
    pub segment_index: usize,
    pub value_mm: Option<f64>,
    pub status: SizeStatus,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConstraintCheck {
    pub constraint: SizeConstraint,
    pub status: SizeStatus,
    pub values: Vec<SizeValue>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SizeCheck {
    pub status: SizeStatus,
    pub checks: Vec<ConstraintCheck>,
}
pub fn validate(constraints: &[SizeConstraint]) -> Result<(), AppError> {
    if constraints.len() > 3
        || constraints.iter().enumerate().any(|(i, c)| {
            !c.minimum_mm.is_finite()
                || !c.maximum_mm.is_finite()
                || c.minimum_mm <= 0.0
                || c.maximum_mm < c.minimum_mm
                || c.source.trim().is_empty()
                || c.source.chars().count() > 500
                || constraints[..i].iter().any(|p| p.dimension == c.dimension)
        })
    {
        return Err(AppError::new(
            "invalid_size_constraints",
            Some("constraints"),
        ));
    }
    Ok(())
}
fn status(values: impl Iterator<Item = SizeStatus>) -> SizeStatus {
    let mut result = SizeStatus::WithinLimits;
    for value in values {
        if value == SizeStatus::ExceedsLimits {
            return value;
        }
        if value == SizeStatus::Unknown {
            result = value;
        }
    }
    result
}
pub fn evaluate(
    segments: &[SegmentInput],
    constraints: &[SizeConstraint],
) -> Result<Option<SizeCheck>, AppError> {
    validate(constraints)?;
    if constraints.is_empty() {
        return Ok(None);
    }
    if segments.is_empty() {
        return Err(AppError::new("invalid_size_constraints", Some("segments")));
    }
    let widths = segments
        .iter()
        .map(sections::effective_width)
        .collect::<Result<Vec<_>, _>>()?;
    let checks = constraints
        .iter()
        .map(|constraint| {
            let values = segments
                .iter()
                .enumerate()
                .map(|(i, s)| {
                    let value = match constraint.dimension {
                        SizeDimension::EffectiveWidth => Some(widths[i]),
                        SizeDimension::Leg1 | SizeDimension::Leg2 => {
                            s.section.as_ref().map(|model| match model {
                                SectionModel::IdealizedRightAngleFillet { leg_1_mm, leg_2_mm } => {
                                    if constraint.dimension == SizeDimension::Leg1 {
                                        *leg_1_mm
                                    } else {
                                        *leg_2_mm
                                    }
                                }
                            })
                        }
                    };
                    SizeValue {
                        segment_index: i,
                        value_mm: value,
                        status: match value {
                            None => SizeStatus::Unknown,
                            Some(v) if v < constraint.minimum_mm || v > constraint.maximum_mm => {
                                SizeStatus::ExceedsLimits
                            }
                            _ => SizeStatus::WithinLimits,
                        },
                    }
                })
                .collect::<Vec<_>>();
            ConstraintCheck {
                constraint: constraint.clone(),
                status: status(values.iter().map(|v| v.status)),
                values,
            }
        })
        .collect::<Vec<_>>();
    Ok(Some(SizeCheck {
        status: status(checks.iter().map(|c| c.status)),
        checks,
    }))
}
