export type Vec3 = [number, number, number];
export interface SegmentInput { start_mm: [number, number]; end_mm: [number, number]; effective_width_mm: number }
export interface CalculationInput {
  schema_version: 1; segments: SegmentInput[]; force_n: Vec3; couple_n_mm: Vec3;
  application: { kind: 'centroid' } | { kind: 'point'; point_mm: Vec3 };
}
export interface CalculationResult {
  schema_version: 1; engine_version: string; method_id: string; input_snapshot: CalculationInput;
  geometry: { length_mm: number; area_mm2: number; centroid_mm: [number, number]; ix_mm4: number; iy_mm4: number; ixy_mm4: number; polar_mm4: number };
  moment_at_centroid_n_mm: Vec3; traction_mpa: Vec3 | null;
  analysis_status: 'computed' | 'unsupported_loading'; strength_status: 'unsupported_calculation';
  validation_status: 'not_independently_validated'; warnings: string[];
}
export interface Project { schema_version: 1; title: string; input: CalculationInput; last_calculation: CalculationResult | null }
export interface Revision { id: string; title: string; saved_at_unix_ms: string }
export function newProject(): Project {
  return { schema_version: 1, title: 'Новый проект', input: { schema_version: 1,
    segments: [{ start_mm: [-50, 0], end_mm: [50, 0], effective_width_mm: 2 }],
    force_n: [0, 0, 600], couple_n_mm: [0, 0, 0], application: { kind: 'centroid' } }, last_calculation: null };
}
