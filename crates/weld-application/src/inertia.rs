//! Explicit mass/acceleration provenance, no inferred dynamic or safety factors.
use crate::{AppError, SCHEMA_VERSION};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MassLoad {
    pub mass_kg: f64,
    pub gravity_m_s2: [f64; 3],
    pub acceleration_m_s2: [f64; 3],
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MassLoadRequest {
    pub schema_version: u32,
    pub model: MassLoad,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MassLoadResult {
    pub schema_version: u32,
    pub model: MassLoad,
    pub force_n: [f64; 3],
    pub method_id: String,
}
pub fn force(model: &MassLoad) -> Result<[f64; 3], AppError> {
    let gravity = model
        .gravity_m_s2
        .map(weld_core::MetresPerSecondSquared::new);
    let acceleration = model
        .acceleration_m_s2
        .map(weld_core::MetresPerSecondSquared::new);
    Ok(weld_core::inertia::equivalent_force(
        weld_core::Kilograms::new(model.mass_kg)?,
        [
            gravity[0].clone()?,
            gravity[1].clone()?,
            gravity[2].clone()?,
        ],
        [
            acceleration[0].clone()?,
            acceleration[1].clone()?,
            acceleration[2].clone()?,
        ],
    )?
    .map(|n| n.value()))
}
pub fn derive(request: &MassLoadRequest) -> Result<MassLoadResult, AppError> {
    if request.schema_version != SCHEMA_VERSION {
        return Err(AppError::new("unsupported_schema", Some("schema_version")));
    }
    Ok(MassLoadResult {
        schema_version: SCHEMA_VERSION,
        model: request.model.clone(),
        force_n: force(&request.model)?,
        method_id: "translating-mass-equivalent-load-v1".into(),
    })
}
pub fn effective_force(value: &crate::forces::AppliedForce) -> Result<[f64; 3], AppError> {
    let Some(model) = &value.inertia else {
        return Ok(value.force_n);
    };
    let derived = force(model)?;
    for (actual, expected) in value.force_n.into_iter().zip(derived) {
        if !actual.is_finite()
            || if expected == 0.0 {
                actual != 0.0
            } else {
                ((actual - expected) / expected).abs() > 8.0 * f64::EPSILON
            }
        {
            return Err(AppError::new("mass_force_mismatch", Some("forces.inertia")));
        }
    }
    Ok(derived)
}
