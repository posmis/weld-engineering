//! Explicit user factors and frozen source loads. No normative combination rules.
use crate::{
    cases::{LoadCase, MAX_CASES},
    forces::{AppliedForce, Sum, MAX_FORCES},
    projects::Project,
    validate_input, AppError, ApplicationPoint, CalculationInput, SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceLoad {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forces: Option<Vec<AppliedForce>>,
    pub force_n: [f64; 3],
    pub couple_n_mm: [f64; 3],
    pub application: ApplicationPoint,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CombinationSource {
    pub case_id: String,
    pub title: String,
    pub factor: f64,
    pub load: SourceLoad,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CombinationMethod {
    UserLinearLoadCombinationV1,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoadCombination {
    pub method_id: CombinationMethod,
    pub sources: Vec<CombinationSource>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CombinationTerm {
    pub case_id: String,
    pub factor: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CombinationRequest {
    pub schema_version: u32,
    pub project: Project,
    pub title: String,
    pub terms: Vec<CombinationTerm>,
}
fn invalid() -> AppError {
    AppError::new("invalid_combination", Some("combination"))
}
fn scaled(value: f64, factor: f64) -> Result<f64, AppError> {
    let n = value * factor;
    if !n.is_finite() || (value != 0.0 && factor != 0.0 && (n == 0.0 || n.is_subnormal())) {
        return Err(AppError::new("numerical_range", Some("combination")));
    }
    Ok(n)
}
fn loads(
    model: &LoadCombination,
    project: &Project,
) -> Result<(Vec<AppliedForce>, [f64; 3]), AppError> {
    if model.sources.is_empty()
        || model.sources.len() > MAX_CASES
        || model.sources.iter().all(|s| s.factor == 0.0)
    {
        return Err(invalid());
    }
    let mut ids = HashSet::new();
    let mut forces = Vec::new();
    let mut moment = [Sum::default(); 3];
    for (index, s) in model.sources.iter().enumerate() {
        if !s.factor.is_finite()
            || s.case_id.trim().is_empty()
            || s.case_id.len() > 64
            || !ids.insert(&s.case_id)
            || s.title.trim().is_empty()
            || s.title.chars().count() > 100
        {
            return Err(invalid());
        }
        let input = CalculationInput {
            schema_version: SCHEMA_VERSION,
            segments: project.input.segments.clone(),
            forces: s.load.forces.clone(),
            force_n: s.load.force_n,
            couple_n_mm: s.load.couple_n_mm,
            application: s.load.application.clone(),
        };
        validate_input(&input)?;
        if s.factor == 0.0 {
            continue;
        }
        let legacy = [AppliedForce {
            inertia: None,
            id: "legacy".into(),
            title: "F1".into(),
            force_n: s.load.force_n,
            application: s.load.application.clone(),
        }];
        for (fi, f) in s
            .load
            .forces
            .as_deref()
            .unwrap_or(&legacy)
            .iter()
            .enumerate()
        {
            let mut force_n = [0.0; 3];
            for (n, v) in force_n.iter_mut().zip(crate::inertia::effective_force(f)?) {
                *n = scaled(v, s.factor)?;
            }
            if force_n.iter().all(|n| *n == 0.0) {
                continue;
            }
            if forces.len() == MAX_FORCES {
                return Err(AppError::new(
                    "combination_force_limit",
                    Some("combination"),
                ));
            }
            forces.push(AppliedForce {
                inertia: None,
                id: format!("c{}-f{}", index + 1, fi + 1),
                title: format!("[{}] {}", s.title, f.title)
                    .chars()
                    .take(100)
                    .collect(),
                force_n,
                application: f.application.clone(),
            });
        }
        for (sum, v) in moment.iter_mut().zip(s.load.couple_n_mm) {
            sum.add(scaled(v, s.factor)?)?;
        }
    }
    Ok((
        forces,
        [moment[0].total()?, moment[1].total()?, moment[2].total()?],
    ))
}
/// Checks a materialized case against frozen sources without looking up live cases.
pub(crate) fn validate_case(case: &LoadCase, project: &Project) -> Result<(), AppError> {
    let Some(model) = &case.combination else {
        return Ok(());
    };
    let (forces, moment) = loads(model, project)?;
    if case.force_n != [0.0; 3]
        || case.application != ApplicationPoint::Centroid
        || case.forces.as_ref() != Some(&forces)
        || case.couple_n_mm != moment
    {
        return Err(AppError::new(
            "combination_load_mismatch",
            Some("casebook.combination"),
        ));
    }
    Ok(())
}
pub fn create(request: &CombinationRequest) -> Result<Project, AppError> {
    if request.schema_version != SCHEMA_VERSION {
        return Err(AppError::new("unsupported_schema", Some("schema_version")));
    }
    request.project.validate()?;
    if request.title.trim().is_empty()
        || request.title.chars().count() > 100
        || request.terms.is_empty()
        || request.terms.len() > MAX_CASES
    {
        return Err(invalid());
    }
    let book = request.project.casebook.as_ref().ok_or_else(invalid)?;
    if book.cases.len() >= MAX_CASES {
        return Err(invalid());
    }
    let mut sources = Vec::new();
    for term in &request.terms {
        let case = book
            .cases
            .iter()
            .find(|c| c.id == term.case_id)
            .ok_or_else(invalid)?;
        if case.combination.is_some() {
            return Err(invalid());
        }
        sources.push(CombinationSource {
            case_id: case.id.clone(),
            title: case.title.clone(),
            factor: term.factor,
            load: SourceLoad {
                forces: case.forces.clone(),
                force_n: case.force_n,
                couple_n_mm: case.couple_n_mm,
                application: case.application.clone(),
            },
        });
    }
    let model = LoadCombination {
        method_id: CombinationMethod::UserLinearLoadCombinationV1,
        sources,
    };
    let (forces, couple) = loads(&model, &request.project)?;
    let mut result = request.project.clone();
    let id = uuid::Uuid::new_v4().to_string();
    let case = LoadCase {
        combination: Some(model),
        forces: Some(forces),
        id: id.clone(),
        title: request.title.clone(),
        force_n: [0.0; 3],
        couple_n_mm: couple,
        application: ApplicationPoint::Centroid,
        last_calculation: None,
    };
    result.input = case.input(&result);
    result.last_calculation = None;
    let book = result.casebook.as_mut().expect("validated casebook");
    book.active_id = id;
    book.cases.push(case);
    result.validate()?;
    // The caller must be able to serialize and save the whole audit trail.
    result.to_json()?;
    Ok(result)
}
