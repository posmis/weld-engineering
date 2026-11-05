// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { expect, test, vi } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFPage } from 'pdf-lib';
import { createReport } from './report';
import { newProject, type CalculationResult } from './contracts';

test('Cyrillic multipage report is a readable PDF with the original project attachment and no input mutation', async () => {
  const project = newProject(); project.title = 'Проверка отчёта — инженерный проект';
  project.input.segments = Array.from({ length: 80 }, (_, i) => ({ start_mm: [0, i * 10], end_mm: [100, i * 10], effective_width_mm: 2 }));
  const before = JSON.stringify(project);
  const bytes = await createReport(project, new Uint8Array(await readFile('src/assets/NotoSans-Regular.ttf')), null, new Date('2026-11-04T12:00:00Z'));
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getTitle()).toBe(project.title); expect(pdf.getPageCount()).toBeGreaterThan(2);
  const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('EmbeddedFiles'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
  expect(names.size()).toBe(4);
  const filenames = Array.from({ length: names.size() / 2 }, (_, i) => names.lookup(i * 2, PDFHexString).decodeText());
  expect(filenames).toContain('weld-project.json'); expect(filenames).toContain('NotoSans-OFL.txt');
  expect(JSON.stringify(project)).toBe(before);
});


test('multi-force report lists every point and uses the Rust resultant for F/A substitution', async () => {
  const project=newProject();project.input={...project.input,force_n:[0,0,0],forces:[{id:'a',title:'F1',force_n:[0,0,300],application:{kind:'point',point_mm:[-25,0,0]}},{id:'b',title:'F2',force_n:[0,0,300],application:{kind:'point',point_mm:[25,0,0]}}]};
  project.last_calculation={schema_version:1,engine_version:'test',method_id:'uniform-direct-traction-v1',input_snapshot:project.input,geometry:{length_mm:100,area_mm2:200,centroid_mm:[0,0],ix_mm4:0,iy_mm4:166666.66666666666,ixy_mm4:0,polar_mm4:166666.66666666666},moment_at_centroid_n_mm:[0,0,0],resultant_force_n:[0,0,600],traction_mpa:[0,0,3],analysis_status:'computed',strength_status:'unsupported_calculation',validation_status:'not_independently_validated',warnings:[]} satisfies CalculationResult;
  const draw=vi.spyOn(PDFPage.prototype,'drawText');
  try {
    await createReport(project,new Uint8Array(await readFile('src/assets/NotoSans-Regular.ttf')),null);
    const text=draw.mock.calls.map(c=>c[0]).join('\n');
    expect(text).toContain('F1 [N]: 0 / 0 / 300');expect(text).toContain('F2 [N]: 0 / 0 / 300');expect(text).toContain('-25 / 0 / 0');expect(text).toContain('(600 N) / (200 mm²) = 3 MPa');
  } finally { draw.mockRestore(); }
});


test('section provenance is printed with its geometric assumptions and no normative verdict',async()=>{
 const project=newProject();project.input.segments[0]={...project.input.segments[0],effective_width_mm:2.4,section:{kind:'idealized_right_angle_fillet',leg_1_mm:3,leg_2_mm:4}};
 const draw=vi.spyOn(PDFPage.prototype,'drawText');try{await createReport(project,new Uint8Array(await readFile('src/assets/NotoSans-Regular.ttf')),null);const text=draw.mock.calls.map(c=>c[0]).join('\n');expect(text).toContain('k1 / k2 [mm]: 3 / 4');expect(text).toContain('right-angle-fillet-altitude-v1');expect(text).toContain('соответствие ГОСТ не проверено');}finally{draw.mockRestore();}
});

test('mass provenance is printed with explicit SI units and the attachment reaction sign',async()=>{
 const project=newProject();project.input.force_n=[0,0,0];project.input.forces=[{id:'mass',title:'Mass 1',force_n:[-20,0,-100],application:{kind:'point',point_mm:[10,20,30]},inertia:{mass_kg:10,gravity_m_s2:[0,0,-10],acceleration_m_s2:[2,0,0]}}];
 const draw=vi.spyOn(PDFPage.prototype,'drawText');try{await createReport(project,new Uint8Array(await readFile('src/assets/NotoSans-Regular.ttf')),null);const text=draw.mock.calls.map(c=>c[0]).join('\n');expect(text).toContain('F = m*(g - a)');expect(text).toContain('m=10 kg');expect(text).toContain('g [m/s²]: 0 / 0 / -10');expect(text).toContain('translating-mass-equivalent-load-v1');}finally{draw.mockRestore();}
});

test('combination report prints factors and frozen point loads without a normative verdict',async()=>{
 const p=newProject(),load={force_n:[0,0,300] as [number,number,number],couple_n_mm:[0,0,0] as [number,number,number],application:{kind:'point' as const,point_mm:[10,20,30] as [number,number,number]}};p.input.force_n=[0,0,600];p.casebook={schema_version:1,active_id:'c',cases:[{id:'c',title:'2A',force_n:p.input.force_n,couple_n_mm:p.input.couple_n_mm,application:p.input.application,last_calculation:null,combination:{method_id:'user-linear-load-combination-v1',sources:[{case_id:'a',title:'A',factor:2,load}]}}]};
 const draw=vi.spyOn(PDFPage.prototype,'drawText');try{await createReport(p,new Uint8Array(await readFile('src/assets/NotoSans-Regular.ttf')),null);const text=draw.mock.calls.map(c=>c[0]).join('\n');expect(text).toContain('user-linear-load-combination-v1');expect(text).toContain('коэффициент 2');expect(text).toContain('10 / 20 / 30');expect(text).toContain('коэффициенты не назначены по нормам');}finally{draw.mockRestore();}
});

test('material report distinguishes user-provided values from unknown properties and rejects stale applicability',async()=>{
 const p=newProject();p.materials={context:{thickness_mm:10,temperature_c:20},base:{kind:'custom',designation:'Synthetic base',product_form:null,condition:null,properties:[{kind:'yield_strength',value:300,thickness_mm:[0,20],temperature_c:[20,20],source:'User M-001'}]},weld:null};
 const evaluation={schema_version:1 as const,selection:p.materials,base:{designation:'Synthetic base',properties:[{kind:'yield_strength' as const,unit:'MPa',value:300,source:'User M-001',status:'user_provided' as const},{kind:'tensile_strength' as const,unit:'MPa',value:null,source:null,status:'unknown' as const}]},weld:{designation:null,properties:[]}};const font=new Uint8Array(await readFile('src/assets/NotoSans-Regular.ttf'));const draw=vi.spyOn(PDFPage.prototype,'drawText');try{await createReport(p,font,null,new Date(),evaluation);const text=draw.mock.calls.map(c=>c[0]).join('\n');expect(text).toContain('Источник свойства: User M-001');expect(text).toContain('Для контекста Rp0.2: 300 MPa');expect(text).toContain('Для контекста Rm: неизвестно');expect(text).toContain('не проверенная база ГОСТ');}finally{draw.mockRestore();}
 const stale=structuredClone(evaluation);stale.selection.context.thickness_mm=21;await expect(createReport(p,font,null,new Date(),stale)).rejects.toThrow('does not match');
});

test('user limit report keeps comparison separate from normative strength and embeds its raw ratios',async()=>{
 const p=newProject();p.user_limits={method_id:'independent-nominal-components-v1',tension:{value_mpa:1,source:'User T-001'},compression:{value_mpa:10,source:'User C-001'},shear:{value_mpa:5,source:'User S-001'}};const check={schema_version:1 as const,limits:p.user_limits,total:1,available:0,exceeded:0,status:'incomplete' as const,maximum_ratio:null,governing:null,cases:[],strength_status:'unsupported_calculation' as const,validation_status:'not_independently_validated' as const};const font=new Uint8Array(await readFile('src/assets/NotoSans-Regular.ttf'));const draw=vi.spyOn(PDFPage.prototype,'drawText');let bytes!:Uint8Array;try{bytes=await createReport(p,font,null,new Date(),null,check);const text=draw.mock.calls.map(c=>c[0]).join('\n');expect(text).toContain('Контроль неполон');expect(text).toContain('Не нормативная прочность');expect(text).toContain('User T-001');}finally{draw.mockRestore();}const pdf=await PDFDocument.load(bytes);const names=pdf.catalog.lookup(PDFName.of('Names'),PDFDict).lookup(PDFName.of('EmbeddedFiles'),PDFDict).lookup(PDFName.of('Names'),PDFArray);const filenames=Array.from({length:names.size()/2},(_,i)=>names.lookup(i*2,PDFHexString).decodeText());expect(filenames).toContain('user-limit-comparison.json');const stale=structuredClone(check);stale.limits.tension.value_mpa=2;await expect(createReport(p,font,null,new Date(),null,stale)).rejects.toThrow('does not match');
});
