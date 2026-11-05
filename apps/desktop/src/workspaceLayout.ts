export type WorkspaceLayout = { schema_version: 1; tree_width_px: number; properties_width_px: number; results_height_px: number };
export const workspaceLayoutKey = 'weld-engineering.workspace.v1';
export const defaultWorkspaceLayout: WorkspaceLayout = { schema_version: 1, tree_width_px: 220, properties_width_px: 280, results_height_px: 260 };
export function readWorkspaceLayout(): { layout: WorkspaceLayout; failed: boolean } {
  try {
    const raw = window.localStorage.getItem(workspaceLayoutKey);
    if (raw === null) return { layout: { ...defaultWorkspaceLayout }, failed: false };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid layout');
    const v = value as Record<string, unknown>;
    if (v.schema_version !== 1 || Object.keys(v).length !== 4) throw new Error('invalid layout');
    for (const [key, min, max] of [['tree_width_px',160,420],['properties_width_px',240,420],['results_height_px',160,4096]] as const) {
      if (typeof v[key] !== 'number' || !Number.isFinite(v[key]) || v[key] < min || v[key] > max) throw new Error('invalid layout');
    }
    return { layout: v as WorkspaceLayout, failed: false };
  } catch { return { layout: { ...defaultWorkspaceLayout }, failed: true }; }
}
export function saveWorkspaceLayout(layout: WorkspaceLayout): boolean {
  try { window.localStorage.setItem(workspaceLayoutKey, JSON.stringify(layout)); return true; } catch { return false; }
}
