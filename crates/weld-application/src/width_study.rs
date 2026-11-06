//! Manual global effective-width scaling. No normative sizing or optimum selection.
use crate::{
    cases::{self, CaseBook, CaseFailure, CaseSummary, LoadCase},
    projects::Project,
    sections::SectionModel,
    user_limits::{self, LimitEvaluation},
    AppError, SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
pub const MAX_CANDIDATES: usize = 16;
pub const MAX_WORK: usize = 32768;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WidthStudyRequest {
    pub schema_version: u32,
    pub project: Project,
    pub factors: Vec<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplyWidthScaleRequest {
    pub schema_version: u32,
    pub project: Project,
    pub factor: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WidthStudyStatus {
    Complete,
    Incomplete,
    Failed,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WidthStudyRow {
    pub factor: f64,
    pub status: WidthStudyStatus,
    pub area_mm2: Option<f64>,
    pub summary: Option<CaseSummary>,
    pub comparison: Option<LimitEvaluation>,
    pub failures: Vec<CaseFailure>,
    pub error: Option<AppError>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WidthStudyResult {
    pub schema_version: u32,
    pub method_id: String,
    pub source_project: Project,
    pub rows: Vec<WidthStudyRow>,
}
fn validate(project: &Project, factors: &[f64]) -> Result<(), AppError> {
    project.to_json()?;
    if factors.is_empty()
        || factors.len() > MAX_CANDIDATES
        || factors
            .iter()
            .enumerate()
            .any(|(i, f)| !f.is_finite() || *f <= 0.0 || factors[..i].contains(f))
    {
        return Err(AppError::new("invalid_width_study", Some("factors")));
    }
    let cases = project.casebook.as_ref().map_or(1, |b| b.cases.len());
    if factors.len() * cases * project.input.segments.len() > MAX_WORK {
        return Err(AppError::new("width_study_budget", Some("factors")));
    }
    Ok(())
}
fn scaled(value: f64, factor: f64) -> Result<f64, AppError> {
    let result = value * factor;
    if !result.is_finite() || result <= 0.0 || result.is_subnormal() {
        return Err(AppError::new("numerical_range", Some("width_scale")));
    }
    Ok(result)
}
fn rescale(project: &Project, factor: f64) -> Result<Project, AppError> {
    let mut result = project.clone();
    for segment in &mut result.input.segments {
        let expected = scaled(crate::sections::effective_width(segment)?, factor)?;
        if let Some(model) = &mut segment.section {
            match model {
                SectionModel::IdealizedRightAngleFillet { leg_1_mm, leg_2_mm } => {
                    *leg_1_mm = scaled(*leg_1_mm, factor)?;
                    *leg_2_mm = scaled(*leg_2_mm, factor)?;
                }
            }
            let width = crate::sections::width(model)?;
            if (width - expected).abs() / expected > f64::EPSILON.sqrt() {
                return Err(AppError::new("numerical_range", Some("width_scale")));
            }
            segment.effective_width_mm = width;
        } else {
            segment.effective_width_mm = expected;
        }
    }
    result.last_calculation = None;
    if let Some(book) = &mut result.casebook {
        for case in &mut book.cases {
            case.last_calculation = None;
        }
    }
    result.validate()?;
    Ok(result)
}
fn recalculate(project: Project) -> Result<(Project, CaseSummary, Vec<CaseFailure>), AppError> {
    if project.casebook.is_some() {
        let batch = cases::calculate_cases(&project)?;
        batch.project.to_json()?;
        return Ok((batch.project, batch.summary, batch.failures));
    }
    let mut result = project;
    result.last_calculation = Some(crate::calculate(&result.input)?);
    let mut temporary = result.clone();
    temporary.casebook = Some(CaseBook {
        schema_version: SCHEMA_VERSION,
        active_id: "single".into(),
        cases: vec![LoadCase {
            combination: None,
            forces: result.input.forces.clone(),
            id: "single".into(),
            title: "LC1".into(),
            force_n: result.input.force_n,
            couple_n_mm: result.input.couple_n_mm,
            application: result.input.application.clone(),
            last_calculation: result.last_calculation.clone(),
        }],
    });
    let summary = cases::summarize_cases(&temporary)?;
    result.to_json()?;
    Ok((result, summary, vec![]))
}
fn candidate(project: &Project, factor: f64) -> Result<(Project, WidthStudyRow), AppError> {
    let scaled = rescale(project, factor)?;
    let area = weld_core::properties(&crate::validate_input(&scaled.input)?)?
        .area
        .value();
    let (updated, summary, failures) = recalculate(scaled)?;
    let mut row = WidthStudyRow {
        factor,
        status: if summary.complete {
            WidthStudyStatus::Complete
        } else {
            WidthStudyStatus::Incomplete
        },
        area_mm2: Some(area),
        summary: Some(summary),
        comparison: None,
        failures,
        error: None,
    };
    if updated.user_limits.is_some() {
        match user_limits::evaluate(&user_limits::EvaluateLimitsRequest {
            schema_version: SCHEMA_VERSION,
            project: updated.clone(),
        }) {
            Ok(value) => row.comparison = Some(value),
            Err(error) => {
                row.status = WidthStudyStatus::Incomplete;
                row.error = Some(error);
            }
        }
    }
    Ok((updated, row))
}
pub fn evaluate(request: &WidthStudyRequest) -> Result<WidthStudyResult, AppError> {
    if request.schema_version != SCHEMA_VERSION {
        return Err(AppError::new("unsupported_schema", Some("schema_version")));
    }
    validate(&request.project, &request.factors)?;
    let rows = request
        .factors
        .iter()
        .map(|&factor| match candidate(&request.project, factor) {
            Ok((_, row)) => row,
            Err(error) => WidthStudyRow {
                factor,
                status: WidthStudyStatus::Failed,
                area_mm2: None,
                summary: None,
                comparison: None,
                failures: vec![],
                error: Some(error),
            },
        })
        .collect();
    Ok(WidthStudyResult {
        schema_version: SCHEMA_VERSION,
        method_id: "global-effective-width-study-v1".into(),
        source_project: request.project.clone(),
        rows,
    })
}
pub fn apply(request: &ApplyWidthScaleRequest) -> Result<Project, AppError> {
    if request.schema_version != SCHEMA_VERSION {
        return Err(AppError::new("unsupported_schema", Some("schema_version")));
    }
    validate(&request.project, &[request.factor])?;
    let (project, row) = candidate(&request.project, request.factor)?;
    if row.status != WidthStudyStatus::Complete {
        return Err(AppError::new("width_study_incomplete", Some("factor")));
    }
    Ok(project)
}
