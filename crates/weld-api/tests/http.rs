use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use tower::ServiceExt;
fn input() -> serde_json::Value {
    serde_json::json!({"schema_version":1,"segments":[{"start_mm":[-50,0],"end_mm":[50,0],"effective_width_mm":2}],"force_n":[400,-200,600],"couple_n_mm":[0,0,0],"application":{"kind":"centroid"}})
}
fn request(path: &str, body: serde_json::Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(path)
        .header("Authorization", "Bearer test-token")
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}
#[tokio::test]
async fn rest_analysis_matches_the_application_service_and_never_accepts_strength() {
    let response = weld_api::router("test-token".into())
        .oneshot(request("/api/v1/calculate", input()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let value: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(value["traction_mpa"], serde_json::json!([2.0, -1.0, 3.0]));
    assert_eq!(value["strength_status"], "unsupported_calculation");
    let expected = weld_application::calculate(&serde_json::from_value(input()).unwrap()).unwrap();
    assert_eq!(value, serde_json::to_value(expected).unwrap());
}
#[tokio::test]
async fn authentication_browser_origin_and_request_limits_are_enforced() {
    let app = weld_api::router("test-token".into());
    let no_token = Request::builder()
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(no_token).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    let mut browser = request("/api/v1/calculate", input());
    browser
        .headers_mut()
        .insert("Origin", "http://example.test".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(browser).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let large = Request::builder()
        .method("POST")
        .uri("/api/v1/calculate")
        .header("Authorization", "Bearer test-token")
        .header("Content-Type", "application/json")
        .body(Body::from(" ".repeat(1_048_577)))
        .unwrap();
    assert_eq!(
        app.oneshot(large).await.unwrap().status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
}
#[tokio::test]
async fn unknown_fields_and_invalid_geometry_return_errors_not_results() {
    let mut invalid = input();
    invalid["unverified_standard"] = true.into();
    let app = weld_api::router("test-token".into());
    assert_eq!(
        app.clone()
            .oneshot(request("/api/v1/calculate", invalid))
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut invalid = input();
    invalid["segments"][0]["effective_width_mm"] = 0.into();
    let response = app
        .oneshot(request("/api/v1/calculate", invalid))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let value: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(value["code"], "non_positive_dimension");
    assert!(value.get("traction_mpa").is_none());
}
#[test]
fn published_openapi_contains_the_actual_routes_and_no_unimplemented_strength_endpoint() {
    let spec: serde_json::Value =
        serde_json::from_str(include_str!("../../../docs/openapi.json")).unwrap();
    assert_eq!(spec["openapi"], "3.1.0");
    assert_eq!(spec["paths"].as_object().unwrap().len(), 6);
    assert!(spec["paths"].get("/api/v1/optimize").is_none());
    assert_eq!(
        spec["components"]["schemas"]["CalculationResult"]["properties"]["strength_status"]
            ["const"],
        "unsupported_calculation"
    );
}

#[tokio::test]
async fn intermittent_geometry_is_generated_by_the_shared_service() {
    let request = request(
        "/api/v1/geometry/intermittent",
        serde_json::json!({"input": input(), "segment_index": 0, "weld_length_mm":20, "pitch_mm":40, "count":3}),
    );
    let response = weld_api::router("test-token".into())
        .oneshot(request)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let value: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(value["segments"].as_array().unwrap().len(), 3);
    assert_eq!(
        value["segments"][2]["end_mm"],
        serde_json::json!([50.0, 0.0])
    );
}
