//! Explicit user thresholds for independent nominal components. Never strength acceptance.
use crate::{
    projects::Project, AnalysisStatus, AppError, CalculationResult, StrengthStatus,
    ValidationStatus, SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LimitMethod {
    IndependentNominalComponentsV1,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StressLimit {
    pub value_mpa: f64,
    pub source: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UserLimits {
    pub method_id: LimitMethod,
    pub tension: StressLimit,
    pub compression: StressLimit,
    pub shear: StressLimit,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ValidateLimitsRequest {
    pub schema_version: u32,
    pub limits: UserLimits,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvaluateLimitsRequest {
    pub schema_version: u32,
    pub project: Project,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LimitComponent {
    Tension,
    Compression,
    Shear,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Endpoint {
    Start,
    End,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LimitPoint {
    pub segment_index: usize,
    pub endpoint: Endpoint,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComponentCheck {
    pub demand_mpa: f64,
    pub limit_mpa: f64,
    pub ratio: f64,
    pub point: Option<LimitPoint>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaseLimitStatus {
    WithinUserLimits,
    ExceedsUserLimits,
    Unavailable,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComparisonStatus {
    WithinUserLimits,
    ExceedsUserLimits,
    Incomplete,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaseLimitCheck {
    pub case_id: String,
    pub title: String,
    pub status: CaseLimitStatus,
    pub reason: Option<String>,
    pub analysis_method_id: Option<String>,
    pub tension: Option<ComponentCheck>,
    pub compression: Option<ComponentCheck>,
    pub shear: Option<ComponentCheck>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LimitGoverning {
    pub case_id: String,
    pub component: LimitComponent,
    pub point: Option<LimitPoint>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LimitEvaluation {
    pub schema_version: u32,
    pub limits: UserLimits,
    pub total: usize,
    pub available: usize,
    pub exceeded: usize,
    pub status: ComparisonStatus,
    pub maximum_ratio: Option<f64>,
    pub governing: Option<LimitGoverning>,
    pub cases: Vec<CaseLimitCheck>,
    pub strength_status: StrengthStatus,
    pub validation_status: ValidationStatus,
}
pub fn validate(limits: &UserLimits) -> Result<(), AppError> {
    for limit in [&limits.tension, &limits.compression, &limits.shear] {
        if !limit.value_mpa.is_finite()
            || limit.value_mpa <= 0.0
            || limit.source.trim().is_empty()
            || limit.source.chars().count() > 500
        {
            return Err(AppError::new("invalid_user_limits", Some("user_limits")));
        }
    }
    Ok(())
}
pub fn validate_request(request: &ValidateLimitsRequest) -> Result<UserLimits, AppError> {
    if request.schema_version != SCHEMA_VERSION {
        return Err(AppError::new("unsupported_schema", Some("schema_version")));
    }
    validate(&request.limits)?;
    Ok(request.limits.clone())
}
fn check(
    demand: f64,
    point: Option<LimitPoint>,
    limit: &StressLimit,
) -> Result<ComponentCheck, AppError> {
    let ratio = demand / limit.value_mpa;
    if !ratio.is_finite() || (demand > 0.0 && (ratio == 0.0 || ratio.is_subnormal())) {
        return Err(AppError::new("numerical_range", Some("user_limits")));
    }
    Ok(ComponentCheck {
        demand_mpa: demand,
        limit_mpa: limit.value_mpa,
        ratio,
        point,
    })
}
fn case(
    id: &str,
    title: &str,
    result: Option<&CalculationResult>,
    limits: &UserLimits,
) -> Result<CaseLimitCheck, AppError> {
    let mut row = CaseLimitCheck {
        case_id: id.into(),
        title: title.into(),
        status: CaseLimitStatus::Unavailable,
        reason: Some("not_computed".into()),
        analysis_method_id: result.map(|r| r.method_id.clone()),
        tension: None,
        compression: None,
        shear: None,
    };
    let Some(result) = result else {
        return Ok(row);
    };
    if result.analysis_status != AnalysisStatus::Computed {
        row.reason = Some("unsupported_loading".into());
        return Ok(row);
    }
    let mut demand = [0.0_f64; 3];
    let mut points = [None; 3];
    for index in 0..result.input_snapshot.segments.len() {
        let values = if let Some(v) = result.traction_mpa {
            [v, v]
        } else if let Some(d) = &result.distribution {
            [d.segments[index].start_mpa, d.segments[index].end_mpa]
        } else {
            return Err(AppError::new("snapshot_mismatch", None));
        };
        for (endpoint, value) in [Endpoint::Start, Endpoint::End].into_iter().zip(values) {
            let shear = value[0].hypot(value[1]);
            if !shear.is_finite() {
                return Err(AppError::new("numerical_range", Some("user_limits")));
            }
            for (i, v) in [value[2].max(0.0), (-value[2]).max(0.0), shear]
                .into_iter()
                .enumerate()
            {
                if v > demand[i] {
                    demand[i] = v;
                    points[i] = Some(LimitPoint {
                        segment_index: index,
                        endpoint,
                    });
                }
            }
        }
    }
    row.tension = Some(check(demand[0], points[0], &limits.tension)?);
    row.compression = Some(check(demand[1], points[1], &limits.compression)?);
    row.shear = Some(check(demand[2], points[2], &limits.shear)?);
    row.reason = None;
    row.status = if [&row.tension, &row.compression, &row.shear]
        .into_iter()
        .flatten()
        .any(|c| c.ratio > 1.0)
    {
        CaseLimitStatus::ExceedsUserLimits
    } else {
        CaseLimitStatus::WithinUserLimits
    };
    Ok(row)
}
pub fn evaluate(request: &EvaluateLimitsRequest) -> Result<LimitEvaluation, AppError> {
    if request.schema_version != SCHEMA_VERSION {
        return Err(AppError::new("unsupported_schema", Some("schema_version")));
    }
    request.project.validate()?;
    let p = &request.project;
    let limits = p
        .user_limits
        .as_ref()
        .ok_or_else(|| AppError::new("missing_user_limits", Some("user_limits")))?;
    let cases = if let Some(book) = &p.casebook {
        book.cases
            .iter()
            .map(|c| case(&c.id, &c.title, c.last_calculation.as_ref(), limits))
            .collect::<Result<Vec<_>, _>>()?
    } else {
        vec![case("single", "LC1", p.last_calculation.as_ref(), limits)?]
    };
    let available = cases
        .iter()
        .filter(|c| c.status != CaseLimitStatus::Unavailable)
        .count();
    let exceeded = cases
        .iter()
        .filter(|c| c.status == CaseLimitStatus::ExceedsUserLimits)
        .count();
    let mut maximum_ratio = None;
    let mut governing = None;
    for c in &cases {
        for (component, check) in [
            (LimitComponent::Tension, &c.tension),
            (LimitComponent::Compression, &c.compression),
            (LimitComponent::Shear, &c.shear),
        ] {
            if let Some(check) = check {
                if maximum_ratio.is_none_or(|old| check.ratio > old) {
                    maximum_ratio = Some(check.ratio);
                    governing = Some(LimitGoverning {
                        case_id: c.case_id.clone(),
                        component,
                        point: check.point,
                    });
                }
            }
        }
    }
    let status = if available < cases.len() {
        ComparisonStatus::Incomplete
    } else if exceeded > 0 {
        ComparisonStatus::ExceedsUserLimits
    } else {
        ComparisonStatus::WithinUserLimits
    };
    Ok(LimitEvaluation {
        schema_version: SCHEMA_VERSION,
        limits: limits.clone(),
        total: cases.len(),
        available,
        exceeded,
        status,
        maximum_ratio,
        governing,
        cases,
        strength_status: StrengthStatus::UnsupportedCalculation,
        validation_status: ValidationStatus::NotIndependentlyValidated,
    })
}
