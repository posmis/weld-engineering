import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { GeometryTransformDialog } from './GeometryTransformDialog';
import { backend } from './backend';
import { newProject, type GeometryTemplateResult } from './contracts';
import ru from './locales/ru.json';
vi.mock('./backend', () => ({ backend: { transformGroup: vi.fn() } }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
const describe = () => 'Ошибка преобразования';
const segments = newProject().input.segments;
const rotated: GeometryTemplateResult = { schema_version: 1, segments: [{ start_mm: [0, -50], end_mm: [0, 50], effective_width_mm: 2 }] };
test('only the current Rust preview can be applied and source geometry stays visible', async () => {
  vi.useFakeTimers(); let first!: (v: GeometryTemplateResult) => void, second!: (v: GeometryTemplateResult) => void;
  vi.mocked(backend.transformGroup).mockReturnValueOnce(new Promise(done => { first = done; })).mockReturnValueOnce(new Promise(done => { second = done; }));
  const apply = vi.fn(); const { container } = render(<GeometryTransformDialog segments={segments} t={ru} describeError={describe} onApply={apply} onCancel={() => {}}/>);
  await act(async () => { vi.advanceTimersByTime(200); });
  fireEvent.change(screen.getByLabelText('Операция'), { target: { value: 'rotate' } });
  await act(async () => { first(rotated); vi.advanceTimersByTime(200); });
  expect((screen.getByRole('button', { name: 'Применить преобразование' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { second(rotated); });
  expect(container.querySelector('.transform-original line')).toBeTruthy(); expect(container.querySelector('.transform-proposed line')).toBeTruthy();
  expect(vi.mocked(backend.transformGroup).mock.calls[1][0]).toEqual({ schema_version: 1, segments, transform: { kind: 'rotate', origin_mm: [0, 0], angle_deg: 90 } });
  fireEvent.click(screen.getByRole('button', { name: 'Применить преобразование' })); expect(apply).toHaveBeenCalledWith(rotated.segments);
});
test('invalid fields cancel requests; a backend error blocks Apply without hiding Cancel', async () => {
  vi.useFakeTimers(); vi.mocked(backend.transformGroup).mockRejectedValue({ code: 'numerical_range' }); const cancel = vi.fn();
  render(<GeometryTransformDialog segments={segments} t={ru} describeError={describe} onApply={() => {}} onCancel={cancel}/>);
  fireEvent.change(screen.getByLabelText('Смещение X, mm'), { target: { value: '' } });
  await act(async () => { vi.advanceTimersByTime(400); }); expect(backend.transformGroup).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe('Введите конечные координаты и угол.');
  fireEvent.change(screen.getByLabelText('Смещение X, mm'), { target: { value: '1e308' } });
  await act(async () => { vi.advanceTimersByTime(200); });
  expect(screen.getByRole('alert').textContent).toBe('Ошибка преобразования');
  expect((screen.getByRole('button', { name: 'Применить преобразование' }) as HTMLButtonElement).disabled).toBe(true);
  const last=screen.getByRole('button',{name:'Отмена'});act(()=>last.focus());fireEvent.keyDown(last,{key:'Tab'});
  expect(document.activeElement).toBe(screen.getByLabelText('Операция'));fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(cancel).toHaveBeenCalledOnce();
});

test('copy preview rejects a combined-group overlap without allowing an old preview to be applied', async () => {
  vi.useFakeTimers();vi.mocked(backend.transformGroup).mockResolvedValueOnce({schema_version:1,segments:[...segments,...rotated.segments]}).mockRejectedValueOnce({code:'overlapping_segments'});
  render(<GeometryTransformDialog segments={segments} copyIndex={0} t={ru} describeError={describe} onApply={()=>{}} onCancel={()=>{}}/>);
  await act(async()=>{vi.advanceTimersByTime(200);});
  expect((screen.getByRole('button',{name:'Применить преобразование'}) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('Смещение Y, mm'),{target:{value:'0'}});
  expect((screen.getByRole('button',{name:'Применить преобразование'}) as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>{vi.advanceTimersByTime(200);});
  expect(screen.getByRole('alert').textContent).toBe('Ошибка преобразования');expect((screen.getByRole('button',{name:'Применить преобразование'}) as HTMLButtonElement).disabled).toBe(true);
});
