// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { createReport } from './report';
import { newProject } from './contracts';

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
