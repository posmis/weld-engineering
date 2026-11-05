import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { LayoutEditor } from './LayoutEditor';
import { LoadGlyphs } from './LoadGlyphs';
import { newProject } from './contracts';
import { defaultSettings } from './editorMovement';
import ru from './locales/ru.json';
afterEach(cleanup);
test('a distant application point can be fitted without changing model coordinates or loads', () => {
  const input = newProject().input; input.application = { kind: 'point', point_mm: [1000, 0, 30] };
  const onChange = vi.fn();
  const { container } = render(<LayoutEditor input={input} selected={0} disabled={false} onChange={onChange} onSelect={() => {}} settings={defaultSettings} t={ru}/>);
  expect(screen.getByText('Точка приложения вне вида')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Швы + точка P' }));
  expect(screen.queryByText('Точка приложения вне вида')).toBeNull();
  expect(Number(container.querySelector('.application-point circle')?.getAttribute('cx'))).toBeLessThan(600);
  expect(onChange).not.toHaveBeenCalled(); expect(input.application.point_mm).toEqual([1000, 0, 30]);
});
test('out-of-plane force and axial couple signs use distinct right-handed XY glyphs', () => {
  const input = newProject().input; input.force_n = [20, -10, -600]; input.couple_n_mm = [0, 0, 200];
  const { container, rerender } = render(<svg><LoadGlyphs input={input} anchor={[100, 100]}/></svg>);
  expect(container.querySelector('[data-load-glyph="Fz-"]')).toBeTruthy();
  expect(container.querySelector('[data-load-glyph="Fz+"]')).toBeNull();
  expect(container.querySelector('[data-load-glyph="Mz+"] path')?.getAttribute('d')).toContain('0 1 0');
  input.couple_n_mm[2] = -200; rerender(<svg><LoadGlyphs input={input} anchor={[100, 100]}/></svg>);
  expect(container.querySelector('[data-load-glyph="Mz-"] path')?.getAttribute('d')).toContain('0 1 1');
});
