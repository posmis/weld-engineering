import type { Project } from './contracts';
export type EditorSnapshot = { project: Project; historical: boolean; selected: number };
// Keep invalid numeric drafts as numbers: JSON cloning would turn NaN into null.
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(key => Object.hasOwn(b, key) && sameValue(
    (a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
type Checkpoint = { past: EditorSnapshot[]; future: EditorSnapshot[] };
export class ProjectHistory {
  private past: EditorSnapshot[] = [];
  private future: EditorSnapshot[] = [];
  private group: object | null = null;
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  breakGroup() { this.group = null; }
  checkpoint(): Checkpoint { return { past: [...this.past], future: [...this.future] }; }
  restore(value: Checkpoint) { this.past = [...value.past]; this.future = [...value.future]; this.breakGroup(); }
  clear() { this.past = []; this.future = []; this.breakGroup(); }
  record(before: EditorSnapshot, after: EditorSnapshot, group: object | null = null) {
    if (sameValue(before.project, after.project) && before.historical === after.historical) return;
    if (!group || group !== this.group) this.past = [...this.past.slice(-99), before];
    this.group = group; this.future = [];
  }
  undo(current: EditorSnapshot): EditorSnapshot | undefined {
    this.breakGroup(); const previous = this.past.pop();
    if (previous) this.future = [...this.future.slice(-99), current];
    return previous;
  }
  redo(current: EditorSnapshot): EditorSnapshot | undefined {
    this.breakGroup(); const next = this.future.pop();
    if (next) this.past = [...this.past.slice(-99), current];
    return next;
  }
}
