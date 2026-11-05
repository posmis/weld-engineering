import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { GeometryTemplateDialog } from './GeometryTemplateDialog';
import { backend } from './backend';
import type { GeometryTemplateResult } from './contracts';
import ru from './locales/ru.json';
vi.mock('./backend', () => ({ backend: { groupTemplate: vi.fn() } }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
const describe = () => 'Ошибка генерации';
const parallel: GeometryTemplateResult = { schema_version: 1, segments: [
  { start_mm: [-50, -20], end_mm: [50, -20], effective_width_mm: 2 },
  { start_mm: [-50, 20], end_mm: [50, 20], effective_width_mm: 2 },
] };
test('a late preview cannot enable Apply for a different shape', async () => {
  vi.useFakeTimers(); let first!: (v: GeometryTemplateResult) => void, second!: (v: GeometryTemplateResult) => void;
  vi.mocked(backend.groupTemplate).mockReturnValueOnce(new Promise(done => { first = done; })).mockReturnValueOnce(new Promise(done => { second = done; }));
  const apply = vi.fn(); render(<GeometryTemplateDialog t={ru} describeError={describe} onApply={apply} onCancel={() => {}}/>);
  await act(async () => { vi.advanceTimersByTime(200); });
  fireEvent.change(screen.getByLabelText('Схема'), { target: { value: 'parallel' } });
  await act(async () => { first(parallel); vi.advanceTimersByTime(200); });
  expect((screen.getByRole('button', { name: 'Заменить геометрию' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { second(parallel); });
  expect(screen.getByRole('img', { name: 'Предварительный просмотр группы швов' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Заменить геометрию' })); expect(apply).toHaveBeenCalledWith(parallel.segments);
  expect(vi.mocked(backend.groupTemplate).mock.calls[1][0].kind).toBe('parallel');
});
test('empty dimensions cancel pending preview requests and do not produce geometry', async () => {
  vi.useFakeTimers(); const apply = vi.fn(), cancel = vi.fn();
  render(<GeometryTemplateDialog t={ru} describeError={describe} onApply={apply} onCancel={cancel}/>);
  fireEvent.change(screen.getByLabelText('Высота H, mm'), { target: { value: '' } });
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(backend.groupTemplate).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' })); expect(cancel).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled();
});
test('Escape closes the preview and Tab stays within the modal', () => {
  vi.useFakeTimers(); const cancel = vi.fn();
  render(<GeometryTemplateDialog t={ru} describeError={describe} onApply={() => {}} onCancel={cancel}/>);
  const last = screen.getByRole('button', { name: 'Отмена' }); act(() => last.focus()); fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(screen.getByLabelText('Схема'));
  fireEvent.keyDown(screen.getByLabelText('Схема'), { key: 'Escape' }); expect(cancel).toHaveBeenCalledOnce();
});
