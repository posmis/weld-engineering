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
  if (!input.forces && patch.title === undefined) return { ...input, ...(patch.force_n ? { force_n: patch.force_n } : {}), ...(patch.application ? { application: patch.application } : {}) };
  return replaceForces(input, forceList(input).map(f => f.id === id ? { ...f, ...patch } : f));
}
