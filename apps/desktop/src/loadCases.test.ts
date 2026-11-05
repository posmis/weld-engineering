import {duplicateForce,updateForce} from './forceInputs';
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

test('force collections belong to their load case and survive independent edits and switching', () => {
  let p=newProject();
  p={...p,input:{...p.input,force_n:[0,0,0],application:{kind:'centroid'},forces:[{id:'a',title:'F1',force_n:[0,0,600],application:{kind:'centroid'}}]}};
  const cloned=addCase(p,'LC2');const first=cloned.casebook!.cases[0].id;
  const changed=editInput(cloned,{...cloned.input,forces:cloned.input.forces!.map(f=>({...f,force_n:[0,0,-300]}))});
  expect(activateCase(changed,first).input.forces?.[0].force_n).toEqual([0,0,600]);
  expect(changed.casebook!.cases[1].forces?.[0].force_n).toEqual([0,0,-300]);
});

test('copied mass force preserves independent source arrays and case edits preserve the original source',()=>{
 const original=newProject(),model={mass_kg:10,gravity_m_s2:[0,0,-10] as [number,number,number],acceleration_m_s2:[2,0,0] as [number,number,number]};original.input=updateForce(original.input,'legacy-force',{inertia:model,force_n:[-20,0,-100]});
 const copied=duplicateForce(original.input,'legacy-force','copy')!;expect(copied.input.forces![1].inertia).toEqual(model);expect(copied.input.forces![1].inertia!.gravity_m_s2).not.toBe(model.gravity_m_s2);
 const cases=addCase(original,'LC2'),changed=editInput(cases,updateForce(cases.input,'legacy-force',{inertia:{...model,mass_kg:20},force_n:[-40,0,-200]}));expect(changed.input.forces![0].inertia!.mass_kg).toBe(20);expect(activateCase(changed,changed.casebook!.cases[0].id).input.forces![0].inertia!.mass_kg).toBe(10);
});
