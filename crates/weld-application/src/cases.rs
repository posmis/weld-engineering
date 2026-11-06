//! Shared geometry, independent load cases, and component envelopes. No load combinations
//! or normative acceptance factors are inferred from the list of cases. Explicit frozen
//! combinations are created separately by the combinations module.
use crate::{
    calculate, projects::Project, AppError, ApplicationPoint, CalculationInput, CalculationResult,
    SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_CASES: usize = 32;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoadCase {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub combination: Option<crate::combinations::LoadCombination>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forces: Option<Vec<crate::forces::AppliedForce>>,
    pub id: String,
    pub title: String,
    pub force_n: [f64; 3],
    pub couple_n_mm: [f64; 3],
    pub application: ApplicationPoint,
    pub last_calculation: Option<CalculationResult>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaseBook {
    pub schema_version: u32,
    pub active_id: String,
    pub cases: Vec<LoadCase>,
}
impl LoadCase {
    pub fn input(&self, project: &Project) -> CalculationInput {
        CalculationInput {
            forces: self.forces.clone(),
            force_n: self.force_n,
            couple_n_mm: self.couple_n_mm,
            application: self.application.clone(),
            ..project.input.clone()
        }
    }
}
impl CaseBook {
    pub(crate) fn validate(&self, project: &Project) -> Result<(), AppError> {
        if self.schema_version != SCHEMA_VERSION
            || self.cases.is_empty()
            || self.cases.len() > MAX_CASES
        {
            return Err(AppError::new("invalid_cases", Some("casebook")));
        }
        let mut ids = HashSet::new();
        for case in &self.cases {
            if case.id.trim().is_empty()
                || case.id.len() > 64
                || !ids.insert(&case.id)
                || case.title.trim().is_empty()
                || case.title.chars().count() > 100
            {
                return Err(AppError::new("invalid_cases", Some("casebook.cases")));
            }
            crate::combinations::validate_case(case, project)?;
            // The same snapshot validator as single-case projects; never recompute history.
            Project {
                production_parameters: None,
                user_limits: None,
                materials: None,
                schema_version: project.schema_version,
                title: project.title.clone(),
                input: case.input(project),
                last_calculation: case.last_calculation.clone(),
                casebook: None,
            }
            .validate()?;
        }
        let active = self
            .cases
            .iter()
            .find(|case| case.id == self.active_id)
            .ok_or_else(|| AppError::new("invalid_cases", Some("casebook.active_id")))?;
        if active.input(project) != project.input
            || active.last_calculation != project.last_calculation
        {
            return Err(AppError::new(
                "snapshot_mismatch",
                Some("casebook.active_id"),
            ));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoverningValue {
    pub value_mpa: f64,
    pub case_id: String,
    pub segment_index: usize,
    pub endpoint: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseSummary {
    pub total: usize,
    pub computed: usize,
    pub complete: bool,
    pub normal_min: Option<GoverningValue>,
    pub normal_max: Option<GoverningValue>,
    pub shear_max: Option<GoverningValue>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseFailure {
    pub case_id: String,
    pub error: AppError,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchResult {
    pub project: Project,
    pub summary: CaseSummary,
    pub failures: Vec<CaseFailure>,
}
/// Independent cases only. A failed case stays uncomputed; it cannot disappear from completeness.
pub fn calculate_cases(project: &Project) -> Result<BatchResult, AppError> {
    project.validate()?;
    let mut updated = project.clone();
    let mut failures = Vec::new();
    let book = updated
        .casebook
        .as_mut()
        .ok_or_else(|| AppError::new("invalid_cases", Some("casebook")))?;
    for case in &mut book.cases {
        match calculate(&case.input(project)) {
            Ok(result) => case.last_calculation = Some(result),
            Err(error) => {
                case.last_calculation = None;
                failures.push(CaseFailure {
                    case_id: case.id.clone(),
                    error,
                });
            }
        }
    }
    updated.last_calculation = book
        .cases
        .iter()
        .find(|case| case.id == book.active_id)
        .and_then(|case| case.last_calculation.clone());
    let summary = summarize_cases(&updated)?;
    Ok(BatchResult {
        project: updated,
        summary,
        failures,
    })
}
pub fn summarize_cases(project: &Project) -> Result<CaseSummary, AppError> {
    project.validate()?;
    let book = project
        .casebook
        .as_ref()
        .ok_or_else(|| AppError::new("invalid_cases", Some("casebook")))?;
    let mut summary = CaseSummary {
        total: book.cases.len(),
        computed: 0,
        complete: false,
        normal_min: None,
        normal_max: None,
        shear_max: None,
    };
    for case in &book.cases {
        let Some(result) = &case.last_calculation else {
            continue;
        };
        if result.analysis_status != crate::AnalysisStatus::Computed {
            continue;
        }
        summary.computed += 1;
        for index in 0..project.input.segments.len() {
            let values = if let Some(uniform) = result.traction_mpa {
                [uniform, uniform]
            } else if let Some(distribution) = &result.distribution {
                [
                    distribution.segments[index].start_mpa,
                    distribution.segments[index].end_mpa,
                ]
            } else {
                continue;
            };
            for (endpoint, value) in ["start", "end"].into_iter().zip(values) {
                let shear = value[0].hypot(value[1]);
                if !shear.is_finite() {
                    return Err(AppError::new("numerical_range", None));
                }
                let governing = |v| GoverningValue {
                    value_mpa: v,
                    case_id: case.id.clone(),
                    segment_index: index,
                    endpoint: endpoint.into(),
                };
                if summary
                    .normal_min
                    .as_ref()
                    .is_none_or(|old| value[2] < old.value_mpa)
                {
                    summary.normal_min = Some(governing(value[2]));
                }
                if summary
                    .normal_max
                    .as_ref()
                    .is_none_or(|old| value[2] > old.value_mpa)
                {
                    summary.normal_max = Some(governing(value[2]));
                }
                if summary
                    .shear_max
                    .as_ref()
                    .is_none_or(|old| shear > old.value_mpa)
                {
                    summary.shear_max = Some(governing(shear));
                }
            }
        }
    }
    summary.complete = summary.computed == summary.total;
    Ok(summary)
}
