//! User-defined single-operation time/cost model. No WPS, price catalog or normative acceptance.
use crate::{
    materials::MaterialSelection,
    quantities::{self, QuantityResult},
    AppError, SegmentInput, SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductionParameters {
    pub process_label: String,
    pub currency_label: String,
    pub source: String,
    pub travel_speed_mm_min: f64,
    pub passes: u32,
    pub arc_time_fraction: f64,
    pub preparation_minutes: f64,
    pub inspection_minutes: f64,
    pub labor_rate_per_hour: f64,
    pub equipment_rate_per_hour: f64,
    pub consumable_price_per_kg: f64,
    pub deposition_efficiency: f64,
    pub external_inspection_cost: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ValidateProductionRequest {
    pub schema_version: u32,
    pub parameters: ProductionParameters,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductionRequest {
    pub schema_version: u32,
    pub segments: Vec<SegmentInput>,
    pub materials: Option<MaterialSelection>,
    pub parameters: ProductionParameters,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductionResult {
    pub schema_version: u32,
    pub method_id: String,
    pub source: ProductionRequest,
    pub quantities: QuantityResult,
    pub complete: bool,
    pub arc_on_minutes: f64,
    pub welding_elapsed_minutes: f64,
    pub total_minutes: f64,
    pub consumed_mass_kg: Option<f64>,
    pub material_cost: Option<f64>,
    pub labor_cost: f64,
    pub equipment_cost: f64,
    pub external_inspection_cost: f64,
    pub known_subtotal: f64,
    pub total_cost: Option<f64>,
}
fn text(v: &str, max: usize) -> bool {
    !v.trim().is_empty() && v.chars().count() <= max
}
pub fn validate(p: &ProductionParameters) -> Result<(), AppError> {
    let nonnegative = [
        p.preparation_minutes,
        p.inspection_minutes,
        p.labor_rate_per_hour,
        p.equipment_rate_per_hour,
        p.consumable_price_per_kg,
        p.external_inspection_cost,
    ];
    if !text(&p.process_label, 100)
        || !text(&p.currency_label, 12)
        || !text(&p.source, 500)
        || !p.travel_speed_mm_min.is_finite()
        || p.travel_speed_mm_min <= 0.0
        || p.passes == 0
        || [p.arc_time_fraction, p.deposition_efficiency]
            .iter()
            .any(|v| !v.is_finite() || *v <= 0.0 || *v > 1.0)
        || nonnegative.iter().any(|v| !v.is_finite() || *v < 0.0)
    {
        return Err(AppError::new(
            "invalid_production_parameters",
            Some("production_parameters"),
        ));
    }
    Ok(())
}
pub fn validate_request(r: &ValidateProductionRequest) -> Result<ProductionParameters, AppError> {
    if r.schema_version != SCHEMA_VERSION {
        return Err(AppError::new("unsupported_schema", Some("schema_version")));
    }
    validate(&r.parameters)?;
    Ok(r.parameters.clone())
}
fn number(v: f64, positive: bool) -> Result<f64, AppError> {
    if !v.is_finite() || v < 0.0 || v.is_subnormal() || (positive && v == 0.0) {
        Err(AppError::new("numerical_range", Some("production_cost")))
    } else {
        Ok(v)
    }
}
fn mul(a: f64, b: f64) -> Result<f64, AppError> {
    number(a * b, a > 0.0 && b > 0.0)
}
fn div(a: f64, b: f64) -> Result<f64, AppError> {
    number(a / b, a > 0.0)
}
pub fn evaluate(r: &ProductionRequest) -> Result<ProductionResult, AppError> {
    if r.schema_version != SCHEMA_VERSION {
        return Err(AppError::new("unsupported_schema", Some("schema_version")));
    }
    validate(&r.parameters)?;
    let q = quantities::evaluate(&quantities::QuantityRequest {
        schema_version: SCHEMA_VERSION,
        segments: r.segments.clone(),
        materials: r.materials.clone(),
    })?;
    let p = &r.parameters;
    let length = q
        .segments
        .iter()
        .try_fold(0.0, |sum, s| number(sum + s.length_mm, true))?;
    let arc = div(mul(length, f64::from(p.passes))?, p.travel_speed_mm_min)?;
    let elapsed = div(arc, p.arc_time_fraction)?;
    let total = number(
        number(p.preparation_minutes + elapsed, true)? + p.inspection_minutes,
        true,
    )?;
    let labor = mul(div(total, 60.0)?, p.labor_rate_per_hour)?;
    let equipment = mul(div(elapsed, 60.0)?, p.equipment_rate_per_hour)?;
    let subtotal = number(
        number(labor + equipment, false)? + p.external_inspection_cost,
        false,
    )?;
    let consumed = q
        .mass_kg
        .map(|m| div(m, p.deposition_efficiency))
        .transpose()?;
    let material = consumed
        .map(|m| mul(m, p.consumable_price_per_kg))
        .transpose()?;
    let cost = material.map(|m| number(subtotal + m, false)).transpose()?;
    Ok(ProductionResult {
        schema_version: SCHEMA_VERSION,
        method_id: "user-travel-time-cost-v1".into(),
        source: r.clone(),
        quantities: q,
        complete: cost.is_some(),
        arc_on_minutes: arc,
        welding_elapsed_minutes: elapsed,
        total_minutes: total,
        consumed_mass_kg: consumed,
        material_cost: material,
        labor_cost: labor,
        equipment_cost: equipment,
        external_inspection_cost: p.external_inspection_cost,
        known_subtotal: subtotal,
        total_cost: cost,
    })
}
