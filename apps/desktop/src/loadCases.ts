import type { CalculationInput, CalculationResult, LoadCase, Project } from './contracts';
import { sameValue } from './projectHistory';
export const maxCases = 32;
function fromProject(project: Project, id: string, title: string): LoadCase {
  return { id, title, force_n: project.input.force_n, couple_n_mm: project.input.couple_n_mm, application: project.input.application, last_calculation: project.last_calculation };
}
export function editInput(project: Project, input: CalculationInput): Project {
  const geometryChanged = !sameValue(project.input.segments, input.segments);
  return { ...project, input, last_calculation: null, ...(project.casebook ? { casebook: { ...project.casebook, cases: project.casebook.cases.map(c => c.id === project.casebook?.active_id
    ? { ...c, force_n: input.force_n, couple_n_mm: input.couple_n_mm, application: input.application, last_calculation: null }
    : geometryChanged ? { ...c, last_calculation: null } : c) } } : {}) };
}
export function withCalculation(project: Project, value: CalculationResult): Project {
  return { ...project, last_calculation: value, ...(project.casebook ? { casebook: { ...project.casebook, cases: project.casebook.cases.map(c => c.id === project.casebook?.active_id ? { ...c, last_calculation: value } : c) } } : {}) };
}
export function activateCase(project: Project, id: string): Project {
  const c = project.casebook?.cases.find(c => c.id === id);
  if (!c || !project.casebook) return project;
  return { ...project, input: { ...project.input, force_n: c.force_n, couple_n_mm: c.couple_n_mm, application: c.application }, last_calculation: c.last_calculation, casebook: { ...project.casebook, active_id: id } };
}
export function addCase(project: Project, title: string): Project {
  const cases = project.casebook?.cases ?? [fromProject(project, crypto.randomUUID(), 'LC1')];
  if (cases.length >= maxCases) return project;
  const id = crypto.randomUUID();
  const c = { ...fromProject(project, id, title), last_calculation: null };
  return activateCase({ ...project, casebook: { schema_version: 1, active_id: id, cases: [...cases, c] } }, id);
}
export function removeCase(project: Project): Project {
  if (!project.casebook || project.casebook.cases.length <= 1) return project;
  const cases = project.casebook.cases.filter(c => c.id !== project.casebook?.active_id);
  return activateCase({ ...project, casebook: { ...project.casebook, cases } }, cases[0].id);
}
