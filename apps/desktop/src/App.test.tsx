import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultSettings } from './editorMovement';
import { App } from './App';
import { backend } from './backend';
import { desktopWindow } from './desktopWindow';
import { newProject, type CalculationResult } from './contracts';

vi.mock('./backend', () => ({ backend: { getEditorSettings: vi.fn(), saveEditorSettings: vi.fn(), calculate: vi.fn(), save: vi.fn(), list: vi.fn(), open: vi.fn(), import: vi.fn(), export: vi.fn() } }));
vi.mock('./desktopWindow', () => ({ desktopWindow: { listenClose: vi.fn(), close: vi.fn() } }));
beforeEach(() => { vi.mocked(backend.getEditorSettings).mockResolvedValue({ ...defaultSettings }); vi.mocked(backend.saveEditorSettings).mockResolvedValue(undefined); vi.mocked(desktopWindow.listenClose).mockResolvedValue(() => {}); vi.mocked(desktopWindow.close).mockResolvedValue(undefined); });
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
  await act(async () => { fireEvent.click(screen.getByText('Сохранить настройки')); });
  const settings = vi.mocked(backend.saveEditorSettings).mock.calls[0][0];
  expect(settings.movement_step_mm).toBe(5);
  expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
  expect((screen.getByLabelText('S1 X1') as HTMLInputElement).value).toBe('-50');
  app.unmount(); vi.mocked(backend.getEditorSettings).mockResolvedValue(settings);
  await renderApp();
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
