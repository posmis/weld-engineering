use weld_application::{
    calculate,
    projects::{Project, ProjectStore},
    AnalysisStatus, ApplicationPoint, CalculationInput, SegmentInput, StrengthStatus,
};

fn input() -> CalculationInput {
    CalculationInput {
        schema_version: 1,
        segments: vec![SegmentInput {
            start_mm: [-50.0, 0.0],
            end_mm: [50.0, 0.0],
            effective_width_mm: 2.0,
        }],
        force_n: [400.0, -200.0, 600.0],
        couple_n_mm: [0.0; 3],
        application: ApplicationPoint::Centroid,
    }
}

#[test]
fn service_returns_real_components_without_strength_acceptance() {
    let result = calculate(&input()).unwrap();
    assert_eq!(result.geometry.area_mm2, 200.0);
    assert_eq!(result.traction_mpa, Some([2.0, -1.0, 3.0]));
    assert_eq!(result.analysis_status, AnalysisStatus::Computed);
    assert_eq!(
        result.strength_status,
        StrengthStatus::UnsupportedCalculation
    );
    assert_eq!(result.input_snapshot, input());
}

#[test]
fn eccentricity_is_transformed_and_torsion_returns_a_distribution() {
    let mut request = input();
    request.force_n = [0.0, 10.0, 0.0];
    request.application = ApplicationPoint::Point {
        point_mm: [100.0, 0.0, 0.0],
    };
    let result = calculate(&request).unwrap();
    assert_eq!(result.moment_at_centroid_n_mm, [0.0, 0.0, 1000.0]);
    assert_eq!(result.analysis_status, AnalysisStatus::Computed);
    assert!(result.traction_mpa.is_none());
    assert!(result.distribution.is_some());
    request.application = ApplicationPoint::Centroid;
    request.couple_n_mm[2] = 1e-30;
    // A 1e-30 torsional increment cannot be represented on a 0.05 MPa background.
    // Refuse it instead of silently returning a uniform field.
    assert_eq!(calculate(&request).unwrap_err().code, "numerical_range");
}

#[test]
fn moment_cancellation_at_centroid_is_handled_by_equilibrium() {
    let mut request = input();
    request.force_n = [0.0, 10.0, 0.0];
    request.application = ApplicationPoint::Point {
        point_mm: [100.0, 0.0, 0.0],
    };
    request.couple_n_mm = [0.0, 0.0, -1000.0];
    assert_eq!(
        calculate(&request).unwrap().traction_mpa,
        Some([0.0, 0.05, 0.0])
    );
}

#[test]
fn invalid_schema_nonfinite_and_limits_are_rejected() {
    let mut request = input();
    request.schema_version = 2;
    assert_eq!(calculate(&request).unwrap_err().code, "unsupported_schema");
    request = input();
    request.force_n[0] = f64::INFINITY;
    assert_eq!(calculate(&request).unwrap_err().code, "non_finite");
    request = input();
    request.segments = vec![request.segments[0].clone(); 257];
    assert_eq!(calculate(&request).unwrap_err().code, "segment_count");
}

#[test]
fn overlapping_or_crossing_elements_do_not_double_count_area() {
    let mut request = input();
    request.segments.push(request.segments[0].clone());
    assert_eq!(
        calculate(&request).unwrap_err().code,
        "overlapping_segments"
    );
    request = input();
    request.segments.push(SegmentInput {
        start_mm: [0.0, -10.0],
        end_mm: [0.0, 10.0],
        effective_width_mm: 2.0,
    });
    assert_eq!(calculate(&request).unwrap_err().code, "crossing_segments");
    request.segments[1].start_mm = [50.0, 0.0];
    request.segments[1].end_mm = [50.0, 10.0];
    assert_eq!(calculate(&request).unwrap().geometry.area_mm2, 220.0);
}

#[test]
fn sqlite_revision_round_trip_preserves_the_original_snapshot() {
    let store = ProjectStore::in_memory().unwrap();
    let mut project = Project {
        schema_version: 1,
        title: "Кронштейн".into(),
        input: input(),
        last_calculation: Some(calculate(&input()).unwrap()),
    };
    // Simulate opening a historical result produced by a previous engine version.
    project.last_calculation.as_mut().unwrap().engine_version = "historical-engine".into();
    let first = store.save(&project).unwrap();
    let second = store.save(&project).unwrap();
    assert_ne!(first, second);
    assert_eq!(store.list().unwrap().len(), 2);
    assert_eq!(store.load(&first).unwrap(), project);
    assert_eq!(
        store
            .load(&second)
            .unwrap()
            .last_calculation
            .unwrap()
            .engine_version,
        "historical-engine"
    );
}

#[test]
fn stale_snapshot_and_unknown_import_schema_are_rejected() {
    let mut project = Project {
        schema_version: 1,
        title: "Test".into(),
        input: input(),
        last_calculation: Some(calculate(&input()).unwrap()),
    };
    project.input.force_n[0] += 1.0;
    assert_eq!(project.validate().unwrap_err().code, "snapshot_mismatch");
    project.last_calculation = None;
    let json = project.to_json().unwrap();
    assert_eq!(Project::from_json(&json).unwrap(), project);
    let value = json.replace("\"schema_version\": 1", "\"schema_version\": 999");
    assert_eq!(
        Project::from_json(&value).unwrap_err().code,
        "unsupported_schema"
    );
    assert_eq!(
        Project::from_json(&" ".repeat(1_048_577)).unwrap_err().code,
        "document_too_large"
    );
    assert_eq!(Project::from_json("{}").unwrap_err().code, "invalid_json");
}

#[test]
fn future_database_migration_does_not_modify_the_database() {
    let path = std::env::temp_dir().join(format!("weld-{}.sqlite", uuid::Uuid::new_v4()));
    {
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection.pragma_update(None, "user_version", 999).unwrap();
    }
    assert!(ProjectStore::open(&path).is_err());
    let connection = rusqlite::Connection::open(&path).unwrap();
    let version: u32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 999);
    drop(connection);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn corrupted_snapshot_cannot_expose_stresses_for_unsupported_loading() {
    let mut project = Project {
        schema_version: 1,
        title: "Test".into(),
        input: input(),
        last_calculation: Some(calculate(&input()).unwrap()),
    };
    project.last_calculation.as_mut().unwrap().analysis_status = AnalysisStatus::UnsupportedLoading;
    assert_eq!(project.validate().unwrap_err().code, "invalid_snapshot");
    project.last_calculation = Some(calculate(&input()).unwrap());
    project.last_calculation.as_mut().unwrap().geometry.area_mm2 = f64::NAN;
    assert_eq!(project.validate().unwrap_err().code, "invalid_snapshot");
}

#[test]
fn near_parallel_crossing_is_not_lost_to_a_floating_tolerance() {
    let mut request = input();
    request.segments = vec![
        SegmentInput {
            start_mm: [0.0, 0.0],
            end_mm: [1.0, 0.0],
            effective_width_mm: 1.0,
        },
        SegmentInput {
            start_mm: [0.0, -5e-11],
            end_mm: [1.0, 5e-11],
            effective_width_mm: 1.0,
        },
    ];
    assert_eq!(calculate(&request).unwrap_err().code, "crossing_segments");
}

#[test]
fn translated_oblique_parallel_segments_are_valid() {
    let mut request = input();
    request.segments = vec![
        SegmentInput {
            start_mm: [1e12, 1e12],
            end_mm: [1e12 + 10.0, 1e12 + 10.0],
            effective_width_mm: 1.0,
        },
        SegmentInput {
            start_mm: [1e12, 1e12 + 1.0],
            end_mm: [1e12 + 10.0, 1e12 + 11.0],
            effective_width_mm: 1.0,
        },
    ];
    assert!(calculate(&request).is_ok());
}
