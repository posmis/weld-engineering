import { expect, test } from 'vitest';
import { newProject } from './contracts';
import { ProjectHistory, sameValue, type EditorSnapshot } from './projectHistory';
const state = (title: string): EditorSnapshot => ({ project: { ...newProject(), title }, historical: false, selected: 0 });
test('new edits discard redo; a focused edit group is a single bounded undo command', () => {
  const history = new ProjectHistory(), group = {};
  history.record(state('a'), state('ab'), group); history.record(state('ab'), state('abc'), group);
  expect(history.undo(state('abc'))?.project.title).toBe('a');
  expect(history.redo(state('a'))?.project.title).toBe('abc');
  history.undo(state('abc')); history.record(state('a'), state('other'));
  expect(history.canRedo).toBe(false);
  for (let i = 0; i < 110; i++) history.record(state(String(i)), state(String(i + 1)));
  let count = 0; while (history.undo(state('current'))) count++;
  expect(count).toBe(100);
});
test('cancelled gesture restores the redo branch and preserves invalid numeric drafts', () => {
  const history = new ProjectHistory(); const a = state('a'), b = state('b');
  a.project.input.force_n[0] = NaN;
  history.record(a, b); expect(history.undo(b)).toBe(a);
  const checkpoint = history.checkpoint(); history.record(a, state('dragging'), {});
  history.restore(checkpoint);
  expect(history.canUndo).toBe(false); expect(history.redo(a)).toBe(b);
  expect(Number.isNaN(history.undo(b)!.project.input.force_n[0])).toBe(true);
  expect(sameValue(NaN, null)).toBe(false); expect(sameValue(NaN, NaN)).toBe(true);
});
test('no-op edits do not destroy redo and project replacement clears both stacks', () => {
  const history = new ProjectHistory(); const a = state('a'), b = state('b');
  history.record(a, b); history.undo(b); history.record(a, state('a'));
  expect(history.canRedo).toBe(true); history.clear();
  expect(history.canUndo).toBe(false); expect(history.canRedo).toBe(false);
});
