use weld_application::{
    calculate,
    projects::{Project, ProjectStore},
    AnalysisStatus, ApplicationPoint, CalculationInput, SegmentInput,
};
fn input() -> CalculationInput {
    CalculationInput {
        forces: None,
        schema_version: 1,
        segments: [-20.0, 20.0]
            .map(|y| SegmentInput {
                section: None,
                start_mm: [-50.0, y],
                end_mm: [50.0, y],
                effective_width_mm: 2.0,
            })
            .to_vec(),
        force_n: [0.0, 0.0, 600.0],
        couple_n_mm: [160000.0, 0.0, 0.0],
        application: ApplicationPoint::Centroid,
    }
}
#[test]
fn bending_distribution_is_connected_to_real_rust_results_and_sqlite_snapshots() {
    let input = input();
    let result = calculate(&input).unwrap();
    assert_eq!(result.analysis_status, AnalysisStatus::Computed);
    assert!(result.traction_mpa.is_none());
    assert_eq!(result.method_id, "elastic-line-traction-v1");
    assert_eq!(
        result.distribution.as_ref().unwrap().normal_range_mpa,
        [-18.5, 21.5]
    );
    let mut project = Project {
        materials: None,
        casebook: None,
        schema_version: 1,
        title: "Изгиб".into(),
        input,
        last_calculation: Some(result),
    };
    project.last_calculation.as_mut().unwrap().engine_version = "historical-engine".into();
    let store = ProjectStore::in_memory().unwrap();
    let id = store.save(&project).unwrap();
    assert_eq!(store.load(&id).unwrap(), project);
    assert_eq!(
        Project::from_json(&project.to_json().unwrap()).unwrap(),
        project
    );
}
#[test]
fn incompatible_bending_has_geometry_and_a_reason_but_no_stresses() {
    let mut input = input();
    input.segments.truncate(1);
    let result = calculate(&input).unwrap();
    assert_eq!(result.analysis_status, AnalysisStatus::UnsupportedLoading);
    assert!(result.distribution.is_none());
    assert!(result.traction_mpa.is_none());
    assert!(result
        .warnings
        .iter()
        .any(|v| v == "ill_conditioned_section"));
    assert_eq!(result.geometry.area_mm2, 200.0);
}
#[test]
fn malformed_distribution_snapshots_are_rejected_without_recalculating_them() {
    let input = input();
    let project = Project {
        materials: None,
        casebook: None,
        schema_version: 1,
        title: "Test".into(),
        last_calculation: Some(calculate(&input).unwrap()),
        input,
    };
    for change in 0..6 {
        let mut p = project.clone();
        let result = p.last_calculation.as_mut().unwrap();
        match change {
            0 => {
                result.distribution.as_mut().unwrap().segments.pop();
            }
            1 => result.distribution.as_mut().unwrap().segments[0].end_mpa[2] = f64::NAN,
            2 => result.distribution.as_mut().unwrap().equilibrium_error = 1.0,
            3 => result.distribution.as_mut().unwrap().normal_range_mpa[0] = 999.0,
            4 => result.traction_mpa = Some([0.0; 3]),
            _ => result.analysis_status = AnalysisStatus::UnsupportedLoading,
        }
        assert_eq!(p.validate().unwrap_err().code, "invalid_snapshot");
    }
}
#[test]
fn old_uniform_snapshots_keep_their_original_json_without_a_new_field() {
    let mut input = input();
    input.couple_n_mm = [0.0; 3];
    let project = Project {
        materials: None,
        casebook: None,
        schema_version: 1,
        title: "Legacy".into(),
        last_calculation: Some(calculate(&input).unwrap()),
        input,
    };
    let json = project.to_json().unwrap();
    assert!(!json.contains("distribution"));
    assert_eq!(Project::from_json(&json).unwrap(), project);
}
#[test]
fn eccentric_force_equals_an_equivalent_couple_at_the_centroid() {
    let mut a = input();
    a.couple_n_mm = [0.0; 3];
    a.force_n = [0.0, 0.0, 600.0];
    a.application = ApplicationPoint::Point {
        point_mm: [30.0, 20.0, 0.0],
    };
    let mut b = a.clone();
    b.application = ApplicationPoint::Centroid;
    b.couple_n_mm = [12000.0, -18000.0, 0.0];
    assert_eq!(
        calculate(&a).unwrap().distribution,
        calculate(&b).unwrap().distribution
    );
}
