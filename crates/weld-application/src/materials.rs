//! User-provided material cards and explicit applicability. No normative catalog.
use crate::{AppError, SCHEMA_VERSION};
use serde::{Deserialize, Serialize};
pub const MAX_PROPERTIES: usize = 32;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropertyKind {
    YieldStrength,
    TensileStrength,
    ElasticModulus,
    Density,
}
impl PropertyKind {
    pub fn unit(self) -> &'static str {
        if self == Self::Density {
            "kg/m3"
        } else {
            "MPa"
        }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CustomProperty {
    pub kind: PropertyKind,
    pub value: f64,
    /// Exclusive lower, inclusive upper: (t_min,t_max].
    pub thickness_mm: [f64; 2],
    /// Both endpoints inclusive. No interpolation.
    pub temperature_c: [f64; 2],
    pub source: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaterialKind {
    Custom,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MaterialCard {
    pub kind: MaterialKind,
    pub designation: String,
    pub product_form: Option<String>,
    pub condition: Option<String>,
    pub properties: Vec<CustomProperty>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MaterialContext {
    pub thickness_mm: f64,
    pub temperature_c: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MaterialSelection {
    pub context: MaterialContext,
    pub base: Option<MaterialCard>,
    pub weld: Option<MaterialCard>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MaterialRequest {
    pub schema_version: u32,
    pub selection: MaterialSelection,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropertyStatus {
    Unknown,
    UserProvided,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolvedProperty {
    pub kind: PropertyKind,
    pub unit: String,
    pub value: Option<f64>,
    pub source: Option<String>,
    pub status: PropertyStatus,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolvedMaterial {
    pub designation: Option<String>,
    pub properties: Vec<ResolvedProperty>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MaterialEvaluation {
    pub schema_version: u32,
    pub selection: MaterialSelection,
    pub base: ResolvedMaterial,
    pub weld: ResolvedMaterial,
}
fn text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max
}
fn invalid() -> AppError {
    AppError::new("invalid_material", Some("materials"))
}
pub fn validate(selection: &MaterialSelection) -> Result<(), AppError> {
    let ctx = &selection.context;
    if !ctx.thickness_mm.is_finite()
        || ctx.thickness_mm <= 0.0
        || !ctx.temperature_c.is_finite()
        || ctx.temperature_c < -273.15
    {
        return Err(invalid());
    }
    for card in [&selection.base, &selection.weld].into_iter().flatten() {
        if !text(&card.designation, 100)
            || card.product_form.as_ref().is_some_and(|s| !text(s, 100))
            || card.condition.as_ref().is_some_and(|s| !text(s, 200))
            || card.properties.len() > MAX_PROPERTIES
        {
            return Err(invalid());
        }
        for (i, p) in card.properties.iter().enumerate() {
            if !p.value.is_finite()
                || p.value <= 0.0
                || !p
                    .thickness_mm
                    .iter()
                    .chain(p.temperature_c.iter())
                    .all(|n| n.is_finite())
                || p.thickness_mm[0] < 0.0
                || p.thickness_mm[1] <= p.thickness_mm[0]
                || p.temperature_c[0] < -273.15
                || p.temperature_c[1] < p.temperature_c[0]
                || !text(&p.source, 500)
            {
                return Err(invalid());
            }
            for q in &card.properties[..i] {
                if p.kind == q.kind
                    && p.thickness_mm[0].max(q.thickness_mm[0])
                        < p.thickness_mm[1].min(q.thickness_mm[1])
                    && p.temperature_c[0].max(q.temperature_c[0])
                        <= p.temperature_c[1].min(q.temperature_c[1])
                {
                    return Err(AppError::new(
                        "material_property_overlap",
                        Some("materials.properties"),
                    ));
                }
            }
        }
    }
    Ok(())
}
fn resolve(card: Option<&MaterialCard>, ctx: &MaterialContext) -> ResolvedMaterial {
    let properties = [
        PropertyKind::YieldStrength,
        PropertyKind::TensileStrength,
        PropertyKind::ElasticModulus,
        PropertyKind::Density,
    ]
    .into_iter()
    .map(|kind| {
        let matched = card.and_then(|c| {
            c.properties.iter().find(|p| {
                p.kind == kind
                    && ctx.thickness_mm > p.thickness_mm[0]
                    && ctx.thickness_mm <= p.thickness_mm[1]
                    && ctx.temperature_c >= p.temperature_c[0]
                    && ctx.temperature_c <= p.temperature_c[1]
            })
        });
        ResolvedProperty {
            kind,
            unit: kind.unit().into(),
            value: matched.map(|p| p.value),
            source: matched.map(|p| p.source.clone()),
            status: if matched.is_some() {
                PropertyStatus::UserProvided
            } else {
                PropertyStatus::Unknown
            },
        }
    })
    .collect();
    ResolvedMaterial {
        designation: card.map(|c| c.designation.clone()),
        properties,
    }
}
pub fn evaluate(request: &MaterialRequest) -> Result<MaterialEvaluation, AppError> {
    if request.schema_version != SCHEMA_VERSION {
        return Err(AppError::new("unsupported_schema", Some("schema_version")));
    }
    validate(&request.selection)?;
    let s = &request.selection;
    Ok(MaterialEvaluation {
        schema_version: SCHEMA_VERSION,
        selection: s.clone(),
        base: resolve(s.base.as_ref(), &s.context),
        weld: resolve(s.weld.as_ref(), &s.context),
    })
}
