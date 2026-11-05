import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { CaseResults } from './CaseResults';
import { backend } from './backend';
import { newProject, type CalculationResult, type CaseSummary, type Project } from './contracts';
import ru from './locales/ru.json';
vi.mock('./backend', () => ({ backend: { summarizeCases: vi.fn() } }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
function project(hasResult: boolean): Project {
  const p = newProject();
  p.casebook = { schema_version: 1, active_id: 'a', cases: [{ id: 'a', title: 'LC1', force_n: p.input.force_n, couple_n_mm: p.input.couple_n_mm, application: p.input.application, last_calculation: hasResult ? {} as CalculationResult : null }] };
  return p;
}
const summary: CaseSummary = { total: 1, computed: 1, complete: true, normal_min: null, normal_max: null, shear_max: null };
test('geometry drafts without stored results do not send summary calculations during dragging', () => {
  const { rerender } = render(<CaseResults project={project(false)} t={ru} onActivate={() => {}}/>);
  for (let i = 0; i < 10; i++) rerender(<CaseResults project={project(false)} t={ru} onActivate={() => {}}/>);
  expect(backend.summarizeCases).not.toHaveBeenCalled(); expect(screen.getByText(/0\/1/)).toBeTruthy();
});
test('summary requests are coalesced and the latest immutable project is sent', async () => {
  vi.useFakeTimers(); vi.mocked(backend.summarizeCases).mockResolvedValue(summary);
  const { rerender } = render(<CaseResults project={project(true)} t={ru} onActivate={() => {}}/>);
  await act(async () => { vi.advanceTimersByTime(100); });
  const latest = project(true); latest.title = 'Latest';
  rerender(<CaseResults project={latest} t={ru} onActivate={() => {}}/>);
  await act(async () => { vi.advanceTimersByTime(200); }); expect(backend.summarizeCases).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(50); }); expect(backend.summarizeCases).toHaveBeenCalledTimes(1); expect(backend.summarizeCases).toHaveBeenCalledWith(latest);
});
test('a late response from a replaced project cannot restore its obsolete summary', async () => {
  vi.useFakeTimers(); let resolve!: (value: CaseSummary) => void;
  vi.mocked(backend.summarizeCases).mockReturnValue(new Promise(done => { resolve = done; }));
  const { rerender } = render(<CaseResults project={project(true)} t={ru} onActivate={() => {}}/>);
  await act(async () => { vi.advanceTimersByTime(250); });
  rerender(<CaseResults project={project(false)} t={ru} onActivate={() => {}}/>);
  await act(async () => { resolve(summary); }); expect(screen.getByText(/0\/1/)).toBeTruthy(); expect(screen.queryByText(/1\/1/)).toBeNull();
});
