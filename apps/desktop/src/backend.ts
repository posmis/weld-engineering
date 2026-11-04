import type { EditorSettings } from './editorMovement';
import { invoke } from '@tauri-apps/api/core';
import type { CalculationInput, CalculationResult, Project, Revision } from './contracts';
export const backend = {
  getEditorSettings: () => invoke<EditorSettings>('get_editor_settings'),
  saveEditorSettings: (settings: EditorSettings) => invoke<void>('save_editor_settings', { settings }),
  calculate: (input: CalculationInput) => invoke<CalculationResult>('calculate_joint', { input }),
  save: (project: Project) => invoke<string>('save_project', { project }),
  list: () => invoke<Revision[]>('list_projects'),
  open: (id: string) => invoke<Project>('open_project', { id }),
  import: (text: string) => invoke<Project>('import_project', { text }),
  export: (project: Project) => invoke<string>('export_project', { project }),
};
