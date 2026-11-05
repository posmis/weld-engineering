import type { AppliedForce, CalculationInput } from './contracts';
export const maxForces = 64;
export function forceList(input: CalculationInput): AppliedForce[] {
  return input.forces ?? [{ id: 'legacy-force', title: 'F1', force_n: input.force_n, application: input.application }];
}
export function forceFields(value: { forces?: AppliedForce[] }): { forces?: AppliedForce[] } {
  return value.forces === undefined ? {} : { forces: value.forces };
}
export function replaceForces(input: CalculationInput, forces: AppliedForce[]): CalculationInput {
  return { ...input, force_n: [0, 0, 0], application: { kind: 'centroid' }, forces };
}
export function updateForce(input: CalculationInput, id: string, patch: Partial<AppliedForce>): CalculationInput {
  if (!input.forces && patch.title === undefined && patch.inertia === undefined) return { ...input, ...(patch.force_n ? { force_n: patch.force_n } : {}), ...(patch.application ? { application: patch.application } : {}) };
  return replaceForces(input, forceList(input).map(f => f.id === id ? { ...f, ...patch } : f));
}

export function duplicateForce(input: CalculationInput, sourceId: string, copySuffix: string): { input: CalculationInput; id: string } | null {
  const forces = forceList(input), source = forces.find(f => f.id === sourceId);
  if (!source || forces.length >= maxForces) return null;
  let count = 1, title = '';
  do {
    const suffix = ` (${copySuffix}${count > 1 ? ` ${count}` : ''})`;
    title = Array.from(source.title).slice(0, 100 - Array.from(suffix).length).join('') + suffix;
    count++;
  } while (forces.some(f => f.title === title));
  const id = crypto.randomUUID();
  const copy: AppliedForce = { ...(source.inertia ? {inertia:{...source.inertia,gravity_m_s2:[...source.inertia.gravity_m_s2],acceleration_m_s2:[...source.inertia.acceleration_m_s2]}} : {}), id, title, force_n: [...source.force_n], application: source.application.kind === 'centroid' ? { kind:'centroid' } : { kind:'point',point_mm:[...source.application.point_mm] } };
  return { input: replaceForces(input,[...forces,copy]), id };
}
