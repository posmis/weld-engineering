import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { backend } from './backend';
import { newProject, type CalculationResult } from './contracts';

vi.mock('./backend', () => ({ backend: { calculate: vi.fn(), save: vi.fn(), list: vi.fn(), open: vi.fn(), import: vi.fn(), export: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function result(): CalculationResult {
  return { schema_version: 1, engine_version: 'test', method_id: 'uniform-direct-traction-v1', input_snapshot: newProject().input,
    geometry: { length_mm: 100, area_mm2: 200, centroid_mm: [0, 0], ix_mm4: 0, iy_mm4: 1, ixy_mm4: 0, polar_mm4: 1 },
    moment_at_centroid_n_mm: [0, 0, 0], traction_mpa: [0, 0, 3], analysis_status: 'computed', strength_status: 'unsupported_calculation',
    validation_status: 'not_independently_validated', warnings: [] };
}

test('submits geometry to Rust boundary and invalidates the displayed result after an edit', async () => {
  vi.mocked(backend.calculate).mockResolvedValue(result());
  render(<App />);
  fireEvent.click(screen.getByText('Рассчитать'));
  await waitFor(() => expect(screen.getByText('Номинальные компоненты F/A')).toBeTruthy());
  expect(backend.calculate).toHaveBeenCalledWith(newProject().input);
  expect(screen.getByText('Проверка прочности недоступна')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('S1 a'), { target: { value: '4' } });
  expect(screen.queryByText('Номинальные компоненты F/A')).toBeNull();
});

test('renders unsupported eccentric loading without presenting nominal stresses', async () => {
  const value = result(); value.traction_mpa = null; value.analysis_status = 'unsupported_loading'; value.moment_at_centroid_n_mm = [0, 0, 1000];
  vi.mocked(backend.calculate).mockResolvedValue(value);
  render(<App />); fireEvent.click(screen.getByText('Рассчитать'));
  await waitFor(() => expect(screen.getByText(/Результирующий момент ненулевой/)).toBeTruthy());
  expect(screen.queryByText('Номинальные компоненты F/A')).toBeNull();
});

test('empty numeric input does not silently become zero or reach the calculation boundary', async () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText('force_n z'), { target: { value: '' } });
  fireEvent.click(screen.getByText('Рассчитать'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Обнаружено неконечное число'));
  expect(backend.calculate).not.toHaveBeenCalled();
});
