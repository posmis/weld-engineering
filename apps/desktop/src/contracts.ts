export type Vec3 = [number, number, number];
export type SectionModel = {kind: 'idealized_right_angle_fillet'; leg_1_mm:number;leg_2_mm:number};
export interface SectionRequest {schema_version:1;model:SectionModel}
export interface SectionResult {schema_version:1;model:SectionModel;effective_width_mm:number;method_id:string;status:'idealized_geometry'}
export interface SegmentInput { section?: SectionModel; start_mm: [number, number]; end_mm: [number, number]; effective_width_mm: number }
export interface MassLoad {mass_kg:number;gravity_m_s2:Vec3;acceleration_m_s2:Vec3}
export interface MassLoadRequest {schema_version:1;model:MassLoad}
export interface MassLoadResult {schema_version:1;model:MassLoad;force_n:Vec3;method_id:string}
export interface AppliedForce { inertia?:MassLoad; id: string; title: string; force_n: Vec3; application: { kind: 'centroid' } | { kind: 'point'; point_mm: Vec3 } }
export interface CalculationInput {
  forces?: AppliedForce[];
  schema_version: 1; segments: SegmentInput[]; force_n: Vec3; couple_n_mm: Vec3;
  application: { kind: 'centroid' } | { kind: 'point'; point_mm: Vec3 };
}
export interface NominalDistribution {
  segments: { start_mpa: Vec3; end_mpa: Vec3 }[];
  normal_range_mpa: [number, number]; max_shear_mpa: number;
  bending_rcond: number | null; equilibrium_error: number;
}
export interface CalculationResult {
  resultant_force_n?: Vec3;
  schema_version: 1; engine_version: string; method_id: string; input_snapshot: CalculationInput;
  geometry: { length_mm: number; area_mm2: number; centroid_mm: [number, number]; ix_mm4: number; iy_mm4: number; ixy_mm4: number; polar_mm4: number };
  moment_at_centroid_n_mm: Vec3; traction_mpa: Vec3 | null; distribution?: NominalDistribution;
  analysis_status: 'computed' | 'unsupported_loading'; strength_status: 'unsupported_calculation';
  validation_status: 'not_independently_validated'; warnings: string[];
}
export type MaterialPropertyKind='yield_strength'|'tensile_strength'|'elastic_modulus'|'density';
export interface CustomProperty {kind:MaterialPropertyKind;value:number;thickness_mm:[number,number];temperature_c:[number,number];source:string}
export interface MaterialCard {kind:'custom';designation:string;product_form:string|null;condition:string|null;properties:CustomProperty[]}
export interface MaterialSelection {context:{thickness_mm:number;temperature_c:number};base:MaterialCard|null;weld:MaterialCard|null}
export interface MaterialRequest {schema_version:1;selection:MaterialSelection}
export interface ResolvedMaterial {designation:string|null;properties:{kind:MaterialPropertyKind;unit:string;value:number|null;source:string|null;status:'unknown'|'user_provided'}[]}
export interface MaterialEvaluation {schema_version:1;selection:MaterialSelection;base:ResolvedMaterial;weld:ResolvedMaterial}
export type LimitComponent='tension'|'compression'|'shear';
export interface StressLimit {value_mpa:number;source:string}
export interface UserLimits {method_id:'independent-nominal-components-v1';tension:StressLimit;compression:StressLimit;shear:StressLimit}
export interface LimitPoint {segment_index:number;endpoint:'start'|'end'}
export interface ComponentCheck {demand_mpa:number;limit_mpa:number;ratio:number;point:LimitPoint|null}
export interface CaseLimitCheck {case_id:string;title:string;status:'within_user_limits'|'exceeds_user_limits'|'unavailable';reason:string|null;analysis_method_id:string|null;tension:ComponentCheck|null;compression:ComponentCheck|null;shear:ComponentCheck|null}
export interface LimitEvaluation {schema_version:1;limits:UserLimits;total:number;available:number;exceeded:number;status:'within_user_limits'|'exceeds_user_limits'|'incomplete';maximum_ratio:number|null;governing:{case_id:string;component:LimitComponent;point:LimitPoint|null}|null;cases:CaseLimitCheck[];strength_status:'unsupported_calculation';validation_status:'not_independently_validated'}
export interface Project { user_limits?:UserLimits; materials?:MaterialSelection; schema_version: 1; title: string; input: CalculationInput; last_calculation: CalculationResult | null; casebook?: CaseBook }
export interface Revision { id: string; title: string; saved_at_unix_ms: string }
export function newProject(): Project {
  return { schema_version: 1, title: 'Новый проект', input: { schema_version: 1,
    segments: [{ start_mm: [-50, 0], end_mm: [50, 0], effective_width_mm: 2 }],
    force_n: [0, 0, 600], couple_n_mm: [0, 0, 0], application: { kind: 'centroid' } }, last_calculation: null };
}

export interface SourceLoad {forces?:AppliedForce[];force_n:Vec3;couple_n_mm:Vec3;application:CalculationInput['application']}
export interface CombinationSource {case_id:string;title:string;factor:number;load:SourceLoad}
export interface LoadCombination {method_id:'user-linear-load-combination-v1';sources:CombinationSource[]}
export interface CombinationRequest {replace_case_id?:string;schema_version:1;project:Project;title:string;terms:{case_id:string;factor:number}[]}
export interface LoadCase { combination?:LoadCombination; forces?: AppliedForce[]; id: string; title: string; force_n: Vec3; couple_n_mm: Vec3; application: CalculationInput['application']; last_calculation: CalculationResult | null }
export interface CaseBook { schema_version: 1; active_id: string; cases: LoadCase[] }
export interface GoverningValue { value_mpa: number; case_id: string; segment_index: number; endpoint: string }
export interface CaseSummary { total: number; computed: number; complete: boolean; normal_min: GoverningValue | null; normal_max: GoverningValue | null; shear_max: GoverningValue | null }
export interface BatchResult { project: Project; summary: CaseSummary; failures: { case_id: string; error: { code: string; field: string | null } }[] }

export interface IntermittentInput { input: CalculationInput; segment_index: number; weld_length_mm: number; pitch_mm: number; count: number }

export type TemplateKind = 'rectangle' | 'parallel' | 'u_shape' | 'l_shape';
export interface GeometryTemplateRequest { schema_version: 1; kind: TemplateKind; width_mm: number; height_mm: number; effective_width_mm: number; origin_mm: [number, number] }
export interface GeometryTemplateResult { schema_version: 1; segments: SegmentInput[] }

export type GeometryTransform = { kind: 'translate'; delta_mm: [number, number] }
  | { kind: 'rotate'; origin_mm: [number, number]; angle_deg: number }
  | { kind: 'mirror'; origin_mm: [number, number]; axis: 'x' | 'y' };
export interface GeometryTransformRequest { copy_index?: number; schema_version: 1; segments: SegmentInput[]; transform: GeometryTransform }

export interface WidthStudyRequest {schema_version:1;project:Project;factors:number[]}
export interface WidthStudyRow {factor:number;status:'complete'|'incomplete'|'failed';area_mm2:number|null;summary:CaseSummary|null;comparison:LimitEvaluation|null;failures:{case_id:string;error:{code:string;field:string|null}}[];error:{code:string;field:string|null}|null}
export interface WidthStudyResult {schema_version:1;method_id:string;source_project:Project;rows:WidthStudyRow[]}

export interface QuantityRequest {schema_version:1;segments:SegmentInput[];materials:MaterialSelection|null}
export interface QuantityResult {schema_version:1;method_id:string;source:QuantityRequest;total_segments:number;known_segments:number;complete:boolean;known_volume_mm3:number;volume_mm3:number|null;mass_kg:number|null;density_kg_m3:number|null;density_source:string|null;segments:{segment_index:number;length_mm:number;section_area_mm2:number|null;volume_mm3:number|null;mass_kg:number|null}[]}
