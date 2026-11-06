import type { EditorSettings } from './editorMovement';
import { invoke } from '@tauri-apps/api/core';
import type { BatchResult, CaseSummary, QuantityRequest, QuantityResult, WidthStudyRequest, WidthStudyResult, UserLimits, LimitEvaluation, MaterialRequest, MaterialEvaluation, CombinationRequest, MassLoadRequest, MassLoadResult, SectionRequest, SectionResult, GeometryTransformRequest, GeometryTemplateRequest, GeometryTemplateResult, IntermittentInput, CalculationInput, CalculationResult, Project, Revision } from './contracts';
export const backend = {
  getEditorSettings: () => invoke<EditorSettings>('get_editor_settings'),
  saveEditorSettings: (settings: EditorSettings) => invoke<void>('save_editor_settings', { settings }),
  quantities: (request:QuantityRequest)=>invoke<QuantityResult>('evaluate_quantities',{request}),
  widthStudy: (request:WidthStudyRequest)=>invoke<WidthStudyResult>('evaluate_width_study',{request}),
  applyWidthScale: (request:{schema_version:1;project:Project;factor:number})=>invoke<Project>('apply_width_scale',{request}),
  validateUserLimits: (request:{schema_version:1;limits:UserLimits})=>invoke<UserLimits>('validate_user_limits',{request}),
  evaluateUserLimits: (request:{schema_version:1;project:Project})=>invoke<LimitEvaluation>('evaluate_user_limits',{request}),
  evaluateMaterials: (request:MaterialRequest)=>invoke<MaterialEvaluation>('evaluate_materials',{request}),
  combineCases: (request: CombinationRequest) => invoke<Project>('create_load_combination', { request }),
  deriveMassLoad: (request: MassLoadRequest) => invoke<MassLoadResult>('derive_mass_load', { request }),
  deriveSection: (request: SectionRequest) => invoke<SectionResult>('derive_section', { request }),
  transformGroup: (request: GeometryTransformRequest) => invoke<GeometryTemplateResult>('transform_group', { request }),
  groupTemplate: (request: GeometryTemplateRequest) => invoke<GeometryTemplateResult>('generate_group_template', { request }),
  intermittent: (request: IntermittentInput) => invoke<CalculationInput>('generate_intermittent', { request }),
  savePdf: (bytes: Uint8Array) => invoke<string | null>('save_pdf_report', { bytes: Array.from(bytes) }),
  calculateCases: (project: Project) => invoke<BatchResult>('calculate_load_cases', { project }),
  summarizeCases: (project: Project) => invoke<CaseSummary>('summarize_load_cases', { project }),
  calculate: (input: CalculationInput) => invoke<CalculationResult>('calculate_joint', { input }),
  save: (project: Project) => invoke<string>('save_project', { project }),
  list: () => invoke<Revision[]>('list_projects'),
  open: (id: string) => invoke<Project>('open_project', { id }),
  import: (text: string) => invoke<Project>('import_project', { text }),
  export: (project: Project) => invoke<string>('export_project', { project }),
};
