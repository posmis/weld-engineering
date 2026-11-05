//! Opt-in loopback transport over the same application service used by Tauri.
use axum::{
    extract::{rejection::JsonRejection, DefaultBodyLimit, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use weld_application::{projects::Project, AppError, CalculationInput, MAX_DOCUMENT_BYTES};

#[derive(Clone)]
struct ApiState {
    token: Arc<str>,
    workers: Arc<Semaphore>,
}
fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(AppError::new(code, None))).into_response()
}
async fn authorize(State(state): State<ApiState>, request: Request, next: Next) -> Response {
    // Native clients only: no browser origins, CORS, cookies or query-string credentials.
    if request.headers().contains_key(header::ORIGIN) {
        return error(StatusCode::FORBIDDEN, "browser_origin_rejected");
    }
    let authorized = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|v| same_token(v.as_bytes(), state.token.as_bytes()));
    if !authorized {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    next.run(request).await
}
fn same_token(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |diff, (x, y)| diff | (x ^ y)) == 0
}
fn json_input<T>(value: Result<Json<T>, JsonRejection>) -> Result<T, (StatusCode, Json<AppError>)> {
    value.map(|Json(value)| value).map_err(|e| {
        let code = if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
            "document_too_large"
        } else {
            "invalid_json"
        };
        (e.status(), Json(AppError::new(code, None)))
    })
}

async fn work<T: Serialize + Send + 'static>(
    state: ApiState,
    action: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Response {
    let Ok(permit) = state.workers.try_acquire_owned() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "api_busy");
    };
    let task = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        action()
    });
    // A timed-out/disconnected caller cannot release the worker permit early.
    match tokio::time::timeout(Duration::from_secs(15), task).await {
        Ok(Ok(Ok(value))) => Json(value).into_response(),
        Ok(Ok(Err(e))) => (StatusCode::UNPROCESSABLE_ENTITY, Json(e)).into_response(),
        Ok(Err(_)) => error(StatusCode::INTERNAL_SERVER_ERROR, "calculation_failed"),
        Err(_) => error(StatusCode::REQUEST_TIMEOUT, "calculation_timeout"),
    }
}
async fn calculate(
    State(state): State<ApiState>,
    input: Result<Json<CalculationInput>, JsonRejection>,
) -> Response {
    match json_input(input) {
        Ok(input) => work(state, move || weld_application::calculate(&input)).await,
        Err(e) => e.into_response(),
    }
}
async fn cases(
    State(state): State<ApiState>,
    project: Result<Json<Project>, JsonRejection>,
) -> Response {
    match json_input(project) {
        Ok(p) => work(state, move || weld_application::cases::calculate_cases(&p)).await,
        Err(e) => e.into_response(),
    }
}
async fn validate(
    State(state): State<ApiState>,
    project: Result<Json<Project>, JsonRejection>,
) -> Response {
    match json_input(project) {
        Ok(p) => {
            work(state, move || {
                p.to_json()?;
                Ok(p)
            })
            .await
        }
        Err(e) => e.into_response(),
    }
}
async fn intermittent(
    State(state): State<ApiState>,
    request: Result<Json<weld_application::intermittent::IntermittentInput>, JsonRejection>,
) -> Response {
    match json_input(request) {
        Ok(request) => {
            work(state, move || {
                weld_application::intermittent::generate(&request)
            })
            .await
        }
        Err(e) => e.into_response(),
    }
}
async fn group_template(
    State(state): State<ApiState>,
    request: Result<
        Json<weld_application::geometry_templates::GeometryTemplateRequest>,
        JsonRejection,
    >,
) -> Response {
    match json_input(request) {
        Ok(request) => {
            work(state, move || {
                weld_application::geometry_templates::generate(&request)
            })
            .await
        }
        Err(e) => e.into_response(),
    }
}
async fn group_transform(
    State(state): State<ApiState>,
    request: Result<
        Json<weld_application::geometry_transform::GeometryTransformRequest>,
        JsonRejection,
    >,
) -> Response {
    match json_input(request) {
        Ok(request) => {
            work(state, move || {
                weld_application::geometry_transform::transform(&request)
            })
            .await
        }
        Err(e) => e.into_response(),
    }
}
async fn section(
    State(state): State<ApiState>,
    request: Result<Json<weld_application::sections::SectionRequest>, JsonRejection>,
) -> Response {
    match json_input(request) {
        Ok(request) => work(state, move || weld_application::sections::derive(&request)).await,
        Err(e) => e.into_response(),
    }
}
async fn mass_load(
    State(state): State<ApiState>,
    request: Result<Json<weld_application::inertia::MassLoadRequest>, JsonRejection>,
) -> Response {
    match json_input(request) {
        Ok(request) => work(state, move || weld_application::inertia::derive(&request)).await,
        Err(e) => e.into_response(),
    }
}
async fn combination(
    State(state): State<ApiState>,
    request: Result<Json<weld_application::combinations::CombinationRequest>, JsonRejection>,
) -> Response {
    match json_input(request) {
        Ok(request) => {
            work(state, move || {
                weld_application::combinations::create(&request)
            })
            .await
        }
        Err(e) => e.into_response(),
    }
}
async fn capabilities() -> Json<serde_json::Value> {
    Json(
        serde_json::json!({"schema_version": 1, "engine_version": env!("CARGO_PKG_VERSION"),
        "methods": ["uniform-direct-traction-v1", "elastic-line-traction-v1"],
        "strength_status": "unsupported_calculation", "validation_status": "not_independently_validated",
        "limits": {"document_bytes": MAX_DOCUMENT_BYTES, "segments": weld_application::MAX_SEGMENTS, "cases": weld_application::cases::MAX_CASES, "workers": 2, "timeout_seconds": 15},
        "unsupported": ["normative_strength", "fatigue", "pressure", "laser", "optimization", "verified_material_database", "manufacturing_acceptance"]}),
    )
}
pub fn router(token: String) -> Router {
    let state = ApiState {
        token: token.into(),
        workers: Arc::new(Semaphore::new(2)),
    };
    Router::new()
        .route("/api/v1/calculate", post(calculate))
        .route("/api/v1/geometry/intermittent", post(intermittent))
        .route("/api/v1/geometry/template", post(group_template))
        .route("/api/v1/geometry/transform", post(group_transform))
        .route("/api/v1/sections/derive", post(section))
        .route("/api/v1/loads/mass", post(mass_load))
        .route("/api/v1/cases/calculate", post(cases))
        .route("/api/v1/cases/combine", post(combination))
        .route("/api/v1/projects/validate", post(validate))
        .route("/api/v1/capabilities", get(capabilities))
        .route(
            "/api/v1/openapi.json",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "application/json")],
                    include_str!("../../../docs/openapi.json"),
                )
            }),
        )
        .fallback(|| async { error(StatusCode::NOT_FOUND, "route_not_found") })
        .method_not_allowed_fallback(|| async {
            error(StatusCode::METHOD_NOT_ALLOWED, "method_not_allowed")
        })
        .layer(DefaultBodyLimit::max(MAX_DOCUMENT_BYTES))
        .layer(middleware::from_fn_with_state(state.clone(), authorize))
        .with_state(state)
}
