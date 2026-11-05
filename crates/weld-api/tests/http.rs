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
    assert_eq!(spec["paths"].as_object().unwrap().len(), 9);
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

#[tokio::test]
async fn group_template_endpoint_returns_explicit_geometry_usable_by_the_same_calculator() {
    let request = request(
        "/api/v1/geometry/template",
        serde_json::json!({"schema_version":1,"kind":"rectangle","width_mm":100,"height_mm":40,"effective_width_mm":2,"origin_mm":[10,-5]}),
    );
    let response = weld_api::router("test-token".into())
        .oneshot(request)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let group: weld_application::geometry_templates::GeometryTemplateResult =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let mut joint: weld_application::CalculationInput = serde_json::from_value(input()).unwrap();
    joint.segments = group.segments;
    let result = weld_application::calculate(&joint).unwrap();
    assert_eq!(result.geometry.area_mm2, 560.0);
    assert_eq!(result.geometry.centroid_mm, [10.0, -5.0]);
}

#[tokio::test]
async fn transform_endpoint_returns_rotated_geometry_and_rejects_unknown_operation_fields() {
    let mut body = serde_json::json!({"schema_version":1,"segments":input()["segments"],"transform":{"kind":"rotate","origin_mm":[0,0],"angle_deg":90}});
    let response = weld_api::router("test-token".into())
        .oneshot(request("/api/v1/geometry/transform", body.clone()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let value: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(
        value["segments"][0]["start_mm"],
        serde_json::json!([0.0, -50.0])
    );
    assert_eq!(
        value["segments"][0]["end_mm"],
        serde_json::json!([0.0, 50.0])
    );
    body["transform"]["rotate_loads"] = true.into();
    let response = weld_api::router("test-token".into())
        .oneshot(request("/api/v1/geometry/transform", body))
        .await
        .unwrap();
    assert!(!response.status().is_success());
}

#[tokio::test]
async fn simultaneous_forces_are_summed_by_the_real_calculation_route() {
    let mut i = input();
    i["force_n"] = serde_json::json!([0, 0, 0]);
    i["forces"] = serde_json::json!([{"id":"a","title":"F1","force_n":[0,0,300],"application":{"kind":"point","point_mm":[-25,0,0]}},{"id":"b","title":"F2","force_n":[0,0,300],"application":{"kind":"point","point_mm":[25,0,0]}}]);
    let r = weld_api::router("test-token".into())
        .oneshot(request("/api/v1/calculate", i.clone()))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let v: serde_json::Value =
        serde_json::from_slice(&r.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(v["resultant_force_n"], serde_json::json!([0.0, 0.0, 600.0]));
    assert_eq!(v["traction_mpa"], serde_json::json!([0.0, 0.0, 3.0]));
    let snapshot: weld_application::CalculationInput =
        serde_json::from_value(v["input_snapshot"].clone()).unwrap();
    let original: weld_application::CalculationInput = serde_json::from_value(i).unwrap();
    assert_eq!(snapshot, original);
}

#[tokio::test]
async fn section_derivation_endpoint_produces_traceable_geometry_usable_by_calculate() {
    let body = serde_json::json!({"schema_version":1,"model":{"kind":"idealized_right_angle_fillet","leg_1_mm":3,"leg_2_mm":4}});
    let response = weld_api::router("test-token".into())
        .oneshot(request("/api/v1/sections/derive", body))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let value: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(value["status"], "idealized_geometry");
    assert_eq!(value["effective_width_mm"], 2.4);
    let mut i = input();
    i["segments"][0]["effective_width_mm"] = value["effective_width_mm"].clone();
    i["segments"][0]["section"] = value["model"].clone();
    let r = weld_api::router("test-token".into())
        .oneshot(request("/api/v1/calculate", i))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let v: serde_json::Value =
        serde_json::from_slice(&r.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(v["geometry"]["area_mm2"], 240.0);
    assert_eq!(v["traction_mpa"][2], 2.5);
    assert_eq!(v["strength_status"], "unsupported_calculation");
}
