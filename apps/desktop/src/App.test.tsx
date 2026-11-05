import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultSettings } from './editorMovement';
import { App } from './App';
import { backend } from './backend';
import { desktopWindow } from './desktopWindow';
import { newProject, type CalculationResult } from './contracts';

vi.mock('./backend', () => ({ backend: { getEditorSettings: vi.fn(), saveEditorSettings: vi.fn(), calculate: vi.fn(), calculateCases: vi.fn(), intermittent: vi.fn(), groupTemplate: vi.fn(), transformGroup: vi.fn(), summarizeCases: vi.fn(), save: vi.fn(), list: vi.fn(), open: vi.fn(), import: vi.fn(), export: vi.fn() } }));
vi.mock('./desktopWindow', () => ({ desktopWindow: { listenClose: vi.fn(), close: vi.fn() } }));
beforeEach(() => { vi.mocked(backend.summarizeCases).mockResolvedValue({ total: 2, computed: 0, complete: false, normal_min: null, normal_max: null, shear_max: null }); vi.mocked(backend.getEditorSettings).mockResolvedValue({ ...defaultSettings }); vi.mocked(backend.saveEditorSettings).mockResolvedValue(undefined); vi.mocked(desktopWindow.listenClose).mockResolvedValue(() => {}); vi.mocked(desktopWindow.close).mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function result(): CalculationResult {
  return { schema_version: 1, engine_version: 'test', method_id: 'uniform-direct-traction-v1', input_snapshot: newProject().input,
    geometry: { length_mm: 100, area_mm2: 200, centroid_mm: [0, 0], ix_mm4: 0, iy_mm4: 1, ixy_mm4: 0, polar_mm4: 1 },
    moment_at_centroid_n_mm: [0, 0, 0], traction_mpa: [0, 0, 3], analysis_status: 'computed', strength_status: 'unsupported_calculation',
    validation_status: 'not_independently_validated', warnings: [] };
}

test('submits geometry to Rust boundary and invalidates the displayed result after an edit', async () => {
  vi.mocked(backend.calculate).mockResolvedValue(result());
  await renderApp();
  await act(async () => { fireEvent.click(screen.getByText('Рассчитать')); });
  expect(screen.getByText('Номинальные компоненты F/A')).toBeTruthy();
  expect(backend.calculate).toHaveBeenCalledWith(newProject().input);
  expect(screen.getByText('Проверка прочности недоступна')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('S1 a'), { target: { value: '4' } });
  expect(screen.queryByText('Номинальные компоненты F/A')).toBeNull();
  expect((screen.getByLabelText('S1 a') as HTMLInputElement).value).toBe('4');
  expect(backend.calculate).toHaveBeenCalledTimes(1);
});

test('renders unsupported eccentric loading without presenting nominal stresses', async () => {
  const value = result(); value.traction_mpa = null; value.analysis_status = 'unsupported_loading'; value.moment_at_centroid_n_mm = [0, 0, 1000];
  vi.mocked(backend.calculate).mockResolvedValue(value);
  await renderApp();
  await act(async () => { fireEvent.click(screen.getByText('Рассчитать')); });
  expect(screen.getByText(/Результирующий момент ненулевой/)).toBeTruthy();
  expect(screen.queryByText('Номинальные компоненты F/A')).toBeNull();
});

test('empty numeric input does not silently become zero or reach the calculation boundary', async () => {
  await renderApp();
  fireEvent.change(screen.getByLabelText('force_n z'), { target: { value: '' } });
  await act(async () => { fireEvent.click(screen.getByText('Рассчитать')); });
  expect(screen.getByRole('alert').textContent).toContain('Обнаружено неконечное число');
  expect(backend.calculate).not.toHaveBeenCalled();
});

test('right click uses editor commands and browser inspection shortcuts are suppressed without blocking copy', async () => {
  const { container } = await renderApp();
  const field = screen.getByLabelText('S1 X1');
  const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  fireEvent(field, context);
  expect(context.defaultPrevented).toBe(true);
  expect(screen.queryByRole('menu')).toBeNull();
  const copy = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
  fireEvent(field, copy); expect(copy.defaultPrevented).toBe(false);
  const inspect = new KeyboardEvent('keydown', { key: 'F12', bubbles: true, cancelable: true });
  fireEvent(field, inspect); expect(inspect.defaultPrevented).toBe(true);
  const svg = container.querySelector('svg')!;
  Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
  fireEvent.contextMenu(svg, { clientX: 300, clientY: 250 });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Добавить участок здесь' }));
  expect(screen.getByLabelText('S2 X1')).toBeTruthy();
  expect(screen.queryByRole('menu')).toBeNull();
});

function pointer(target: Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}

test('drag uses a stable equal-scale viewport and Escape restores the saved result and clean state', async () => {
  vi.mocked(backend.calculate).mockResolvedValue(result());
  vi.mocked(backend.save).mockResolvedValue('saved-revision');
  const { container } = await renderApp();
  await act(async () => { fireEvent.click(screen.getByText('Рассчитать')); });
  await act(async () => { fireEvent.click(screen.getByText('Сохранить ревизию')); });
  expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
  const svg = container.querySelector('svg')!;
  Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
  pointer(screen.getByRole('button', { name: 'S1 Начало' }), 'pointerdown', 80, 200);
  pointer(svg, 'pointermove', 124, 156);
  expect(Number((screen.getByLabelText('S1 X1') as HTMLInputElement).value)).toBeCloseTo(-40);
  expect(Number((screen.getByLabelText('S1 Y1') as HTMLInputElement).value)).toBeCloseTo(10);
  pointer(svg, 'pointermove', 168, 112);
  expect(Number((screen.getByLabelText('S1 X1') as HTMLInputElement).value)).toBeCloseTo(-30);
  expect(Number((screen.getByLabelText('S1 Y1') as HTMLInputElement).value)).toBeCloseTo(20);
  expect(screen.queryByText('Номинальные компоненты F/A')).toBeNull();
  fireEvent.keyDown(svg, { key: 'Escape' });
  expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-50');
  expect(screen.getByText('Номинальные компоненты F/A')).toBeTruthy();
  expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
  expect(backend.calculate).toHaveBeenCalledTimes(1);
});

test('keyboard endpoint edits update model coordinates and invalidate the result', async () => {
  vi.mocked(backend.calculate).mockResolvedValue(result());
  await renderApp();
  await act(async () => { fireEvent.click(screen.getByText('Рассчитать')); });
  fireEvent.keyDown(screen.getByRole('button', { name: 'S1 Начало' }), { key: 'ArrowRight' });
  fireEvent.keyDown(screen.getByRole('button', { name: 'S1 Начало' }), { key: 'ArrowUp', shiftKey: true });
  expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-49');
  expect((screen.getByLabelText('S1 Y1') as HTMLInputElement).value).toBe('10');
  expect(screen.queryByText('Номинальные компоненты F/A')).toBeNull();
});

test('new project can be cancelled or discarded without an implicit save', async () => {
  await renderApp();
  fireEvent.change(screen.getByLabelText('Название проекта'), { target: { value: 'Не потерять' } });
  fireEvent.click(screen.getByText('Создать'));
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  fireEvent.click(screen.getByText('Отмена'));
  expect((screen.getByLabelText('Название проекта') as HTMLInputElement).value).toBe('Не потерять');
  expect(screen.queryByRole('alertdialog')).toBeNull();
  fireEvent.click(screen.getByText('Создать'));
  await act(async () => { fireEvent.click(screen.getByText('Не сохранять')); });
  expect((screen.getByLabelText('Название проекта') as HTMLInputElement).value).toBe('Новый проект');
  expect(backend.save).not.toHaveBeenCalled();
});

test('failed save keeps the unsaved project and dialog; successful save precedes replacement', async () => {
  vi.mocked(backend.save).mockRejectedValueOnce({ code: 'database_error' }).mockResolvedValueOnce('revision');
  await renderApp();
  fireEvent.change(screen.getByLabelText('Название проекта'), { target: { value: 'Исходный проект' } });
  fireEvent.click(screen.getByText('Создать'));
  await act(async () => { fireEvent.click(screen.getByText('Сохранить и продолжить')); });
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('Ошибка локальной базы проектов');
  expect((screen.getByLabelText('Название проекта') as HTMLInputElement).value).toBe('Исходный проект');
  await act(async () => { fireEvent.click(screen.getByText('Сохранить и продолжить')); });
  expect(vi.mocked(backend.save).mock.calls[1][0].title).toBe('Исходный проект');
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect((screen.getByLabelText('Название проекта') as HTMLInputElement).value).toBe('Новый проект');
});

test('opening a revision waits for discard confirmation and never recalculates its stored result', async () => {
  vi.mocked(backend.list).mockResolvedValue([{ id: 'revision', title: 'Другой проект', saved_at_unix_ms: '1' }]);
  vi.mocked(backend.open).mockResolvedValue({ ...newProject(), title: 'Другой проект', last_calculation: result() });
  await renderApp();
  fireEvent.change(screen.getByLabelText('Название проекта'), { target: { value: 'Мои изменения' } });
  await act(async () => { fireEvent.click(screen.getByText('Открыть ревизию')); });
  fireEvent.click(screen.getByRole('button', { name: /^Другой проект ·/ }));
  expect(backend.open).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByText('Не сохранять')); });
  expect(backend.open).toHaveBeenCalledWith('revision');
  expect(backend.calculate).not.toHaveBeenCalled();
  expect(screen.getByText('Номинальные компоненты F/A')).toBeTruthy();
});


test('native window close is intercepted for unsaved data and confirmed explicitly', async () => {
  await renderApp();
  fireEvent.change(screen.getByLabelText('Название проекта'), { target: { value: 'Несохранённый' } });
  const handler = vi.mocked(desktopWindow.listenClose).mock.calls[0][0];
  const event = { preventDefault: vi.fn() };
  act(() => handler(event));
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Отмена'));
  expect(desktopWindow.close).not.toHaveBeenCalled();
  act(() => handler(event));
  await act(async () => { fireEvent.click(screen.getByText('Не сохранять')); });
  expect(desktopWindow.close).toHaveBeenCalledTimes(1);
});

test('import does not replace unsaved input until the user confirms', async () => {
  vi.mocked(backend.import).mockResolvedValue({ ...newProject(), title: 'Импортированный проект' });
  const { container } = await renderApp();
  fireEvent.change(screen.getByLabelText('Название проекта'), { target: { value: 'Несохранённый проект' } });
  const file = new File(['{}'], 'project.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => '{}' });
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } });
  expect(backend.import).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Название проекта') as HTMLInputElement).value).toBe('Несохранённый проект');
  await act(async () => { fireEvent.click(screen.getByText('Не сохранять')); });
  expect((screen.getByLabelText('Название проекта') as HTMLInputElement).value).toBe('Импортированный проект');
  expect(screen.getByText('Есть несохранённые изменения')).toBeTruthy();
});

test('a late calculation for a cancelled drag cannot overwrite the restored saved result', async () => {
  let resolveRequest!: (value: CalculationResult) => void;
  vi.mocked(backend.calculate).mockResolvedValueOnce(result()).mockImplementationOnce(() => new Promise(resolve => { resolveRequest = resolve; }));
  vi.mocked(backend.save).mockResolvedValue('revision');
  const { container } = await renderApp();
  await act(async () => { fireEvent.click(screen.getByText('Рассчитать')); });
  await act(async () => { fireEvent.click(screen.getByText('Сохранить ревизию')); });
  const svg = container.querySelector('svg')!;
  Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
  pointer(screen.getByRole('button', { name: 'S1 Начало' }), 'pointerdown', 80, 200);
  pointer(svg, 'pointermove', 124, 156);
  fireEvent.click(screen.getByText('Рассчитать'));
  const request = vi.mocked(backend.calculate).mock.calls[1][0];
  fireEvent.keyDown(svg, { key: 'Escape' });
  await act(async () => { resolveRequest({ ...result(), input_snapshot: request, engine_version: 'stale-response' }); });
  expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-50');
  expect(screen.queryByText(/Engine stale-response/)).toBeNull();
  expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
  await act(async () => { fireEvent.click(screen.getByText('Сохранить ревизию')); });
  expect(vi.mocked(backend.save).mock.calls[1][0].last_calculation).toEqual(result());
});

async function renderApp() {
  let rendered!: ReturnType<typeof render>;
  await act(async () => { rendered = render(<App />); });
  return rendered;
}

test('settings persist across app instances, do not dirty projects, and control whole-weld keyboard movement', async () => {
  const app = await renderApp();
  fireEvent.click(screen.getByText('Настройки приложения'));
  fireEvent.change(screen.getByLabelText('Шаг перемещения, mm'), { target: { value: '5' } });
  fireEvent.click(screen.getByLabelText('Показывать координатную сетку'));
  await act(async () => { fireEvent.click(screen.getByText('Сохранить настройки')); });
  const settings = vi.mocked(backend.saveEditorSettings).mock.calls[0][0];
  expect(settings.movement_step_mm).toBe(5);
  expect(settings.show_grid).toBe(true); expect(settings.snap_grid).toBe(false);
  expect(screen.getByRole('img', { name: 'Координатная сетка' })).toBeTruthy();
  expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
  expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-50');
  app.unmount(); vi.mocked(backend.getEditorSettings).mockResolvedValue(settings);
  await renderApp();
  expect(screen.getByRole('img', { name: 'Координатная сетка' })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Переместить шов S1' }), { key: 'ArrowRight' });
  expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-45');
  expect((screen.getByLabelText('S1 X2') as HTMLInputElement).value).toBe('55');
  expect((screen.getByLabelText('S1 a') as HTMLInputElement).value).toBe('2');
});

test('invalid settings and storage errors keep the dialog open; cancel preserves the active step', async () => {
  await renderApp(); fireEvent.click(screen.getByText('Настройки приложения'));
  fireEvent.change(screen.getByLabelText('Шаг перемещения, mm'), { target: { value: '' } });
  fireEvent.click(screen.getByText('Сохранить настройки'));
  expect(backend.saveEditorSettings).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Шаг перемещения, mm'), { target: { value: '5' } });
  fireEvent.click(screen.getByLabelText('Показывать координатную сетку'));
  vi.mocked(backend.saveEditorSettings).mockRejectedValue({ code: 'database_error' });
  await act(async () => { fireEvent.click(screen.getByText('Сохранить настройки')); });
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByText('Отмена'));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Переместить шов S1' }), { key: 'ArrowRight' });
  expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-49');
});

test('whole-weld pointer movement translates both ends and keeps its viewport after release', async () => {
  const { container } = await renderApp();
  const svg = container.querySelector('svg')!;
  Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
  pointer(screen.getByRole('button', { name: 'Переместить шов S1' }), 'pointerdown', 300, 200);
  pointer(svg, 'pointermove', 344, 156); pointer(svg, 'pointerup', 344, 156);
  expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-40');
  expect((screen.getByLabelText('S1 X2') as HTMLInputElement).value).toBe('60');
  expect((screen.getByLabelText('S1 Y1') as HTMLInputElement).value).toBe('10');
  expect((screen.getByLabelText('S1 Y2') as HTMLInputElement).value).toBe('10');
  expect(screen.getByRole('button', { name: 'S1 Начало' }).getAttribute('cx')).toBe('124');
});

test('a whole multi-frame drag is one undo command restoring the saved calculation and clean state', async () => {
  vi.mocked(backend.calculate).mockResolvedValue(result()); vi.mocked(backend.save).mockResolvedValue('revision');
  const { container } = await renderApp();
  await act(async () => { fireEvent.click(screen.getByText('Рассчитать')); });
  await act(async () => { fireEvent.click(screen.getByText('Сохранить ревизию')); });
  const svg = container.querySelector('svg')!;
  Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
  pointer(screen.getByRole('button', { name: 'Переместить шов S1' }), 'pointerdown', 300, 200);
  pointer(svg, 'pointermove', 344, 156); pointer(svg, 'pointermove', 388, 112); pointer(svg, 'pointerup', 388, 112);
  fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
  expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-50');
  expect(screen.getByText('Номинальные компоненты F/A')).toBeTruthy();
  expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
  expect((screen.getByRole('button', { name: 'Отменить' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-30');
  expect(screen.queryByText('Номинальные компоненты F/A')).toBeNull();
});

test('focused numeric typing is grouped, invalid values remain undoable, and new projects clear history', async () => {
  await renderApp(); const field = screen.getByLabelText('S1 X1');
  act(() => field.focus()); fireEvent.change(field, { target: { value: '' } });
  fireEvent.change(field, { target: { value: '-4' } }); fireEvent.change(field, { target: { value: '-40' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
  expect((field as HTMLInputElement).value).toBe('-50');
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' })); expect((field as HTMLInputElement).value).toBe('-40');
  fireEvent.change(field, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отменить' })); expect((field as HTMLInputElement).value).toBe('-40');
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' })); expect((field as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByText('Создать')); await act(async () => { fireEvent.click(screen.getByText('Не сохранять')); });
  expect((screen.getByRole('button', { name: 'Отменить' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Повторить' }) as HTMLButtonElement).disabled).toBe(true);
});

test('cancelled drag preserves the redo branch; shortcuts leave native text undo alone', async () => {
  const { container } = await renderApp(); const svg = container.querySelector('svg')!;
  Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Переместить шов S1' }), { key: 'ArrowRight' });
  fireEvent.keyDown(svg, { key: 'z', ctrlKey: true });
  const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
  fireEvent(screen.getByLabelText('S1 X1'), event); expect(event.defaultPrevented).toBe(false);
  pointer(screen.getByRole('button', { name: 'S1 Начало' }), 'pointerdown', 80, 200);
  pointer(svg, 'pointermove', 124, 156); fireEvent.keyDown(svg, { key: 'Escape' });
  fireEvent.keyDown(svg, { key: 'y', ctrlKey: true });
  expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-49');
  expect((screen.getByLabelText('S1 X2') as HTMLInputElement).value).toBe('51');
});

test('wheel zoom anchors at the cursor, pan cancels with Escape, and navigation never dirties input', async () => {
  const { container } = await renderApp(); const svg = container.querySelector('svg')!;
  Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
  const endpoint = screen.getByRole('button', { name: 'S1 Начало' });
  fireEvent.wheel(svg, { clientX: 80, clientY: 200, deltaY: -120 });
  expect(Number(endpoint.getAttribute('cx'))).toBeCloseTo(80);
  expect(Number(screen.getByRole('button', { name: 'S1 Конец' }).getAttribute('cx'))).toBeGreaterThan(520);
  fireEvent.click(screen.getByText('Панорамирование'));
  pointer(svg, 'pointerdown', 300, 200); pointer(svg, 'pointermove', 350, 220);
  expect(Number(endpoint.getAttribute('cx'))).toBeCloseTo(130);
  fireEvent.keyDown(svg, { key: 'Escape' }); expect(Number(endpoint.getAttribute('cx'))).toBeCloseTo(80);
  pointer(svg, 'pointerdown', 300, 200); pointer(svg, 'pointermove', 350, 220); pointer(svg, 'pointerup', 350, 220);
  expect(Number(endpoint.getAttribute('cx'))).toBeCloseTo(130);
  fireEvent.click(screen.getByText('Вписать схему')); expect(Number(endpoint.getAttribute('cx'))).toBeCloseTo(80);
  expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-50');
  expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
  expect((screen.getByRole('button', { name: 'Отменить' }) as HTMLButtonElement).disabled).toBe(true);
});

function bendingResult(): CalculationResult {
  const value = result();
  value.method_id = 'elastic-line-traction-v1'; value.traction_mpa = null;
  value.input_snapshot.segments = [20, -20].map(y => ({ start_mm: [-50, y], end_mm: [50, y], effective_width_mm: 2 }));
  value.input_snapshot.couple_n_mm = [160000, 0, 0];
  value.geometry = { length_mm: 200, area_mm2: 400, centroid_mm: [0, 0], ix_mm4: 160000, iy_mm4: 400 * 10000 / 12, ixy_mm4: 0, polar_mm4: 160000 + 400 * 10000 / 12 };
  value.moment_at_centroid_n_mm = [160000, 0, 0];
  value.distribution = { segments: [{ start_mpa: [0, 0, 21.5], end_mpa: [0, 0, 21.5] }, { start_mpa: [0, 0, -18.5], end_mpa: [0, 0, -18.5] }],
    normal_range_mpa: [-18.5, 21.5], max_shear_mpa: 0, bending_rcond: .48, equilibrium_error: 0 };
  return value;
}

test('bending distribution selects matching weld profiles and is invalidated and restored through undo', async () => {
  const value = bendingResult(); vi.mocked(backend.calculate).mockResolvedValue(value);
  await renderApp(); fireEvent.click(screen.getByText('Добавить участок'));
  for (const [label, v] of Object.entries({ 'S1 Y1': 20, 'S1 Y2': 20, 'S2 X1': -50, 'S2 X2': 50, 'S2 Y1': -20, 'S2 Y2': -20, 'couple_n_mm x': 160000 })) {
    const weld = /^S(\d+) /.exec(label); if (weld) fireEvent.click(screen.getByRole('treeitem', { name: `Шов S${weld[1]}` }));
    fireEvent.change(screen.getByLabelText(label), { target: { value: String(v) } });
  }
  await act(async () => { fireEvent.click(screen.getByText('Рассчитать')); });
  expect(backend.calculate).toHaveBeenCalledWith(value.input_snapshot);
  expect(screen.getByText('Номинальное распределение напряжений')).toBeTruthy();
  expect(screen.queryByText('Номинальные компоненты F/A')).toBeNull();
  expect(screen.getByRole('img', { name: 'График напряжений вдоль участка' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Участок распределения'), { target: { value: '1' } });
  expect(screen.getByRole('table', { name: 'Напряжения в концах участка' }).textContent).toContain('-18,5');
  fireEvent.change(screen.getByLabelText('S2 a'), { target: { value: '3' } });
  expect(screen.queryByText('Номинальное распределение напряжений')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
  expect(screen.getByText('Номинальное распределение напряжений')).toBeTruthy();
  expect(screen.getByText('Проверка прочности недоступна')).toBeTruthy();
  expect(backend.calculate).toHaveBeenCalledTimes(1);
});

test('ill-conditioned bending shows its reason and no stress profile or nominal components', async () => {
  const value = result(); value.traction_mpa = null; value.moment_at_centroid_n_mm = [1000, 0, 0]; value.analysis_status = 'unsupported_loading';
  value.warnings = ['ill_conditioned_section']; vi.mocked(backend.calculate).mockResolvedValue(value);
  await renderApp(); await act(async () => { fireEvent.click(screen.getByText('Рассчитать')); });
  expect(screen.getByText(/Изгиб не рассчитан: сечение вырождено/)).toBeTruthy();
  expect(screen.queryByRole('img', { name: 'График напряжений вдоль участка' })).toBeNull();
  expect(screen.queryByText('Номинальные компоненты F/A')).toBeNull();
});

test('measured wide canvas fills the available width and resize cancels a gesture without losing its saved result', async () => {
  let width = 1200, height = 320, resize!: () => void;
  vi.stubGlobal('ResizeObserver', class {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      Object.defineProperty(target, 'clientWidth', { configurable: true, get: () => width });
      Object.defineProperty(target, 'clientHeight', { configurable: true, get: () => height });
      resize = () => this.callback([], this as unknown as ResizeObserver); resize();
    }
    disconnect() {}
  });
  try {
    vi.mocked(backend.calculate).mockResolvedValue(result()); vi.mocked(backend.save).mockResolvedValue('revision');
    const { container } = await renderApp(); const svg = container.querySelector('svg')!;
    Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
    expect(svg.getAttribute('viewBox')).toBe('0 0 1200 320');
    expect(Number(screen.getByRole('button', { name: 'S1 Конец' }).getAttribute('cx'))).toBe(1120);
    await act(async () => { fireEvent.click(screen.getByText('Рассчитать')); });
    await act(async () => { fireEvent.click(screen.getByText('Сохранить ревизию')); });
    pointer(screen.getByRole('button', { name: 'Переместить шов S1' }), 'pointerdown', 600, 160);
    pointer(svg, 'pointermove', 704, 56);
    expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-40');
    width = 1800; height = 360; act(() => resize());
    expect(svg.getAttribute('viewBox')).toBe('0 0 1800 360');
    expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-50');
    expect(screen.getByText('Номинальные компоненты F/A')).toBeTruthy();
    expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
    expect(Number(screen.getByRole('button', { name: 'S1 Конец' }).getAttribute('cx'))).toBeCloseTo(1720);
  } finally { cleanup(); vi.unstubAllGlobals(); }
});


test('CAD tree selects weld properties and loads while the drawing remains available', async () => {
  await renderApp();
  expect(screen.getByRole('tree', { name: 'Модель и расчёт' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'К нагрузкам и результатам' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Добавить участок' }));
  expect(screen.getByRole('treeitem', { name: 'Шов S2' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('textbox', { name: 'S2 X1' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'S1 Начало' }));
  expect(screen.getByRole('treeitem', { name: 'Шов S1' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('textbox', { name: 'S1 X1' })).toBeTruthy();
  fireEvent.click(screen.getByRole('treeitem', { name: 'Нагрузки' }));
  expect(screen.getByRole('textbox', { name: 'force_n z' })).toBeTruthy();
  expect(screen.getByRole('group', { name: 'XY weld layout' })).toBeTruthy();
});

test('result dock opens after calculation and resizing or hiding it preserves the saved model', async () => {
  vi.mocked(backend.calculate).mockResolvedValue(result()); vi.mocked(backend.save).mockResolvedValue('revision');
  await renderApp();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить ревизию' })); });
  expect(screen.getByRole('button', { name: 'Панель результатов' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Ширина панели модели' }), { key: 'ArrowRight' });
  expect(screen.getByRole('separator', { name: 'Ширина панели модели' }).getAttribute('aria-valuenow')).toBe('236');
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Высота панели результатов' }), { key: 'ArrowUp' });
  expect(screen.getByRole('separator', { name: 'Высота панели результатов' }).getAttribute('aria-valuenow')).toBe('276');
  expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-50');
  expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Скрыть результаты' }));
  expect(screen.queryByRole('heading', { name: 'Номинальные компоненты F/A' })).toBeNull();
  fireEvent.click(screen.getByRole('treeitem', { name: 'Результаты' }));
  expect(screen.getByRole('heading', { name: 'Номинальные компоненты F/A' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Схема швов' }));
  expect(screen.getByText('Эффективная площадь')).toBeTruthy();
  expect(backend.calculate).toHaveBeenCalledTimes(1);
});

test('tree arrow keys navigate visible nodes and collapsed branches do not receive focus', async () => {
  await renderApp(); const branch = screen.getByRole('treeitem', { name: 'Сварные швы' });
  act(() => branch.focus()); fireEvent.keyDown(branch, { key: 'ArrowLeft' });
  fireEvent.keyDown(branch, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'Нагрузки' }));
  fireEvent.click(document.activeElement!);
  expect(screen.getByRole('textbox', { name: 'force_n x' })).toBeTruthy();
  act(() => branch.focus()); fireEvent.keyDown(branch, { key: 'ArrowRight' }); fireEvent.keyDown(branch, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'Шов S1' }));
});

test('independent cases keep their own loads and results; geometry edits invalidate the entire set', async () => {
  vi.mocked(backend.calculate).mockImplementation(async input => ({ ...result(), input_snapshot: input }));
  await renderApp();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' })); });
  fireEvent.click(screen.getByRole('treeitem', { name: 'Нагрузки' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Копировать случай' })); });
  fireEvent.change(screen.getByLabelText('force_n z'), { target: { value: '-800' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' })); });
  const select = screen.getByLabelText('Нагрузочный случай');
  const first = (select as HTMLSelectElement).options[0].value;
  await act(async () => { fireEvent.change(select, { target: { value: first } }); });
  expect((screen.getByLabelText('force_n z') as HTMLInputElement).value).toBe('600');
  expect(screen.getByText('Номинальные компоненты F/A')).toBeTruthy();
  fireEvent.click(screen.getByRole('treeitem', { name: 'Шов S1' }));
  fireEvent.change(screen.getByLabelText('S1 a'), { target: { value: '4' } });
  vi.mocked(backend.save).mockResolvedValue('revision');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить ревизию' })); });
  const saved = vi.mocked(backend.save).mock.calls[0][0];
  expect(saved.casebook?.cases).toHaveLength(2);
  expect(saved.casebook?.cases.every(c => c.last_calculation === null)).toBe(true);
});

test('intermittent generation delegates to Rust and is one undoable geometry edit', async () => {
  const input = newProject().input;
  vi.mocked(backend.intermittent).mockResolvedValue({ ...input, segments: [[-50, -30], [-10, 10], [30, 50]].map(([x1, x2]) => ({ start_mm: [x1, 0], end_mm: [x2, 0], effective_width_mm: 2 })) });
  await renderApp();
  fireEvent.click(screen.getByText('Прерывистый шов'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Заменить выбранный шов' })); });
  expect(backend.intermittent).toHaveBeenCalledWith({ input, segment_index: 0, weld_length_mm: 20, pitch_mm: 40, count: 3 });
  expect(screen.getByRole('treeitem', { name: 'Шов S3' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
  expect(screen.queryByRole('treeitem', { name: 'Шов S2' })).toBeNull();
  expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
});

test('an incomplete load value is retained with a clear error when attempting to leave the case', async () => {
  await renderApp();
  fireEvent.click(screen.getByRole('treeitem', { name: 'Нагрузки' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Копировать случай' })); });
  await act(async () => { fireEvent.change(screen.getByLabelText('force_n z'), { target: { value: '' } }); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Копировать случай' })); });
  expect(screen.getByRole('alert').textContent).toContain('Обнаружено неконечное число');
  expect((screen.getByLabelText('Нагрузочный случай') as HTMLSelectElement).options).toHaveLength(2);
  expect((screen.getByLabelText('force_n z') as HTMLInputElement).value).toBe('');
});

test('viewport contours use the current Rust result and view changes do not dirty a saved project', async () => {
  vi.mocked(backend.calculate).mockResolvedValue(result()); vi.mocked(backend.save).mockResolvedValue('revision');
  const { container } = await renderApp();
  const mode = screen.getByRole('combobox', { name: 'Вид' });
  expect((screen.getByRole('option', { name: 'σz · MPa' }) as HTMLOptionElement).disabled).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить ревизию' })); });
  fireEvent.change(mode, { target: { value: '2' } });
  expect(screen.getByRole('group', { name: 'Шкала номинальных напряжений' }).textContent).toContain('S1: 3 / 3 MPa');
  expect(container.querySelector('.segment line[style]')?.getAttribute('style')).toContain('url(#');
  fireEvent.click(screen.getByRole('button', { name: 'F / M' }));
  expect(screen.queryByRole('group', { name: 'Заданные нагрузки на схеме' })).toBeNull();
  expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
  expect(backend.calculate).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('S1 a'), { target: { value: '4' } });
  expect(screen.queryByRole('group', { name: 'Шкала номинальных напряжений' })).toBeNull();
  expect((mode as HTMLSelectElement).value).toBe('geometry');
});
test('central load glyphs wait for the Rust centroid and disappear when the input becomes stale', async () => {
  vi.mocked(backend.calculate).mockResolvedValue(result());
  const { container } = await renderApp();
  expect(screen.getByText('Положение C — после расчёта')).toBeTruthy();
  expect(container.querySelector('[data-load-glyph="Fz+"]')).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' })); });
  expect(container.querySelector('[data-load-glyph="Fz+"]')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('force_n z'), { target: { value: '-600' } });
  expect(container.querySelector('[data-load-glyph]')).toBeNull();
});

const rectangle = { schema_version: 1 as const, segments: [
  { start_mm: [-50, -20] as [number, number], end_mm: [50, -20] as [number, number], effective_width_mm: 2 },
  { start_mm: [50, -20] as [number, number], end_mm: [50, 20] as [number, number], effective_width_mm: 2 },
  { start_mm: [50, 20] as [number, number], end_mm: [-50, 20] as [number, number], effective_width_mm: 2 },
  { start_mm: [-50, 20] as [number, number], end_mm: [-50, -20] as [number, number], effective_width_mm: 2 },
] };
test('a reviewed group replaces geometry once, preserves all cases and one Undo restores every snapshot', async () => {
  vi.mocked(backend.groupTemplate).mockResolvedValue(rectangle); vi.mocked(backend.calculate).mockResolvedValue(result()); vi.mocked(backend.save).mockResolvedValue('revision');
  await renderApp();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' })); });
  fireEvent.click(screen.getByRole('treeitem', { name: 'Нагрузки' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Копировать случай' })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить ревизию' })); });
  const before = vi.mocked(backend.save).mock.calls[0][0];
  fireEvent.click(screen.getByRole('button', { name: 'Шаблон группы' }));
  await screen.findByRole('img', { name: 'Предварительный просмотр группы швов' }, { timeout: 5000 });
  fireEvent.click(screen.getByRole('button', { name: 'Заменить геометрию' }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByRole('treeitem', { name: 'Шов S4' })).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить ревизию' })); });
  const after = vi.mocked(backend.save).mock.calls[1][0];
  expect(after.input.segments).toEqual(rectangle.segments); expect(after.input.force_n).toEqual(before.input.force_n);
  expect(after.casebook?.active_id).toBe(before.casebook?.active_id); expect(after.casebook?.cases.map(c => c.id)).toEqual(before.casebook?.cases.map(c => c.id));
  expect(after.casebook?.cases.every(c => c.last_calculation === null)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
  expect(screen.queryByRole('treeitem', { name: 'Шов S4' })).toBeNull();
  fireEvent.click(screen.getByRole('treeitem', { name: 'Результаты' }));
  expect(screen.getByRole('heading', { name: 'Номинальные компоненты F/A' })).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить ревизию' })); });
  expect(vi.mocked(backend.save).mock.calls[2][0]).toEqual(before);
});
test('a geometry template never turns an incomplete load draft into zero', async () => {
  vi.mocked(backend.groupTemplate).mockResolvedValue(rectangle);
  await renderApp(); fireEvent.change(screen.getByLabelText('force_n z'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Шаблон группы' }));
  await screen.findByRole('img', { name: 'Предварительный просмотр группы швов' }, { timeout: 5000 });
  fireEvent.click(screen.getByRole('button', { name: 'Заменить геометрию' }));
  expect((screen.getByLabelText('force_n z') as HTMLInputElement).value).toBe('');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' })); });
  expect(backend.calculate).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toContain('Обнаружено неконечное число');
});

test('transforming geometry preserves global loads and point P, clears results and supports one Undo', async () => {
  const base = newProject(); base.input.application = { kind: 'point', point_mm: [10, 20, 30] };
  vi.mocked(backend.list).mockResolvedValue([{ id: 'source', title: base.title, saved_at_unix_ms: '1' }]);
  vi.mocked(backend.open).mockResolvedValue(base); vi.mocked(backend.save).mockResolvedValue('revision');
  vi.mocked(backend.transformGroup).mockResolvedValue({ schema_version: 1, segments: [{ start_mm: [0, -50], end_mm: [0, 50], effective_width_mm: 2 }] });
  await renderApp(); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Открыть ревизию' })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: new RegExp('^'+base.title+' ·') })); });
  fireEvent.click(screen.getByRole('button', { name: 'Преобразовать' }));
  fireEvent.change(screen.getByLabelText('Операция'), { target: { value: 'rotate' } });
  await screen.findByRole('img', { name: 'Предпросмотр преобразования' }, { timeout: 5000 });
  fireEvent.click(screen.getByRole('button', { name: 'Применить преобразование' }));
  expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('0');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить ревизию' })); });
  const after=vi.mocked(backend.save).mock.calls[0][0];expect(after.input.application).toEqual(base.input.application);expect(after.input.force_n).toEqual(base.input.force_n);expect(after.input.couple_n_mm).toEqual(base.input.couple_n_mm);expect(after.last_calculation).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Отменить'}));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить ревизию' })); });
  expect(vi.mocked(backend.save).mock.calls[1][0]).toEqual(base);
});

test('tree context commands add individual simultaneous forces and welds, with independent properties and Undo', async () => {
  vi.mocked(backend.calculate).mockResolvedValue(result());
  await renderApp();
  fireEvent.contextMenu(screen.getByRole('treeitem',{name:'Сварные швы'}),{clientX:20,clientY:100});
  fireEvent.click(screen.getByRole('menuitem',{name:'Добавить участок'}));
  expect(screen.getByRole('treeitem',{name:'Шов S2'}).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button',{name:'Отменить'}));
  expect(screen.queryByRole('treeitem',{name:'Шов S2'})).toBeNull();
  fireEvent.contextMenu(screen.getByRole('treeitem',{name:'Нагрузки'}),{clientX:20,clientY:160});
  fireEvent.click(screen.getByRole('menuitem',{name:'Добавить силу'}));
  expect(screen.getByRole('treeitem',{name:'Сила F2'}).getAttribute('aria-selected')).toBe('true');
  expect((screen.getByLabelText('force_n z') as HTMLInputElement).value).toBe('0');
  fireEvent.change(screen.getByLabelText('force_n z'),{target:{value:'300'}});
  fireEvent.click(screen.getByLabelText('Приложить силу в центре сечения'));
  fireEvent.change(screen.getByLabelText('P x'),{target:{value:'25'}});
  fireEvent.click(screen.getByRole('treeitem',{name:'Сила F1'}));
  expect((screen.getByLabelText('force_n z') as HTMLInputElement).value).toBe('600');
  fireEvent.click(screen.getByRole('treeitem',{name:'Сила F2'}));
  expect((screen.getByLabelText('P x') as HTMLInputElement).value).toBe('25');
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Рассчитать'}));});
  const input=vi.mocked(backend.calculate).mock.calls[0][0];
  expect(input.force_n).toEqual([0,0,0]);expect(input.forces?.map(f=>f.force_n[2])).toEqual([600,300]);
  expect(input.forces?.[1].application).toEqual({kind:'point',point_mm:[25,0,0]});
  fireEvent.click(screen.getByRole('button',{name:'Удалить выбранную силу'}));
  expect(screen.queryByRole('treeitem',{name:'Сила F2'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Отменить'}));expect(screen.getByRole('treeitem',{name:'Сила F2'})).toBeTruthy();
});

test('both column widths change independently without dirtying the project; tree context menu supports keyboard cancellation', async()=>{
  await renderApp();
  const tree=screen.getByRole('separator',{name:'Ширина панели модели'}), properties=screen.getByRole('separator',{name:'Ширина столбца свойств'});
  fireEvent.keyDown(tree,{key:'ArrowRight'});fireEvent.keyDown(properties,{key:'ArrowRight'});
  expect(tree.getAttribute('aria-valuenow')).toBe('236');expect(properties.getAttribute('aria-valuenow')).toBe('296');
  fireEvent.keyDown(properties,{key:'ArrowLeft'});expect(tree.getAttribute('aria-valuenow')).toBe('236');
  const node=screen.getByRole('treeitem',{name:'Сила F1'});act(()=>node.focus());fireEvent.keyDown(node,{key:'F10',shiftKey:true});
  expect(screen.getByRole('menu',{name:'Команды дерева'})).toBeTruthy();fireEvent.keyDown(screen.getByRole('menuitem',{name:'Добавить участок'}),{key:'Escape'});
  expect(screen.queryByRole('menu')).toBeNull();expect(document.activeElement).toBe(node);expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
});
