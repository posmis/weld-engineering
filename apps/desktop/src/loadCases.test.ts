import { expect, test } from 'vitest';
import { newProject, type CalculationResult } from './contracts';
import { activateCase, addCase, editInput, removeCase, withCalculation } from './loadCases';
const result = (project = newProject()) => ({ input_snapshot: project.input } as CalculationResult);
test('load edits invalidate only the current case, geometry invalidates every case, switching restores the saved snapshot', () => {
  const initial = newProject(); initial.last_calculation = result(initial);
  const copied = addCase(initial, 'Reverse');
  const edited = editInput(copied, { ...copied.input, force_n: [0, 0, -600] });
  const calculated = withCalculation(edited, result(edited));
  const first = activateCase(calculated, calculated.casebook!.cases[0].id);
  expect(first.input.force_n[2]).toBe(600);
  expect(first.last_calculation).toEqual(initial.last_calculation);
  expect(first.casebook!.cases[1].last_calculation).not.toBeNull();
  const geometry = editInput(first, { ...first.input, segments: first.input.segments.map(s => ({ ...s, effective_width_mm: 4 })) });
  expect(geometry.casebook!.cases.every(c => c.last_calculation === null)).toBe(true);
  expect(calculated.casebook!.cases.every(c => c.last_calculation !== null)).toBe(true);
  const removed = removeCase(calculated);
  expect(removed.casebook!.cases).toHaveLength(1);
  expect(removed.input.force_n[2]).toBe(600);
  expect(removeCase(removed)).toBe(removed);
});
test('legacy single-case documents remain unchanged until a case is added', () => {
  const p = newProject(); expect(editInput(p, { ...p.input, force_n: [0, 0, 10] }).casebook).toBeUndefined();
  expect(withCalculation(p, result(p)).casebook).toBeUndefined();
});
