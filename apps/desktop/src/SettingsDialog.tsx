import { useEffect, useRef, useState } from 'react';
import { defaultSettings, type EditorSettings } from './editorMovement';
import type ru from './locales/ru.json';
export function SettingsDialog({ settings, t, onSave, onCancel }: { settings: EditorSettings; t: typeof ru;
  onSave: (settings: EditorSettings) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState(settings), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [texts, setTexts] = useState(() => [String(settings.movement_step_mm), String(settings.grid_step_mm), String(settings.snap_tolerance_px)]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.activeElement; root.current?.querySelector('input')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return <div className="modal-backdrop"><div ref={root} className="unsaved-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); if (!busy) onCancel(); }
    if (event.key === 'Tab') {
      const fields = [...(root.current?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)') ?? [])];
      const first = fields[0], last = fields[fields.length - 1];
      if (!first) event.preventDefault();
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}><h2 id="settings-title">{t.settings}</h2><fieldset disabled={busy}>
    {(['movement_step_mm', 'grid_step_mm', 'snap_tolerance_px'] as const).map((key, i) => <label className="settings-field" key={key}>{[t.movementStep, t.gridStep, t.snapRadius][i]}
      <input aria-label={[t.movementStep, t.gridStep, t.snapRadius][i]} type="text" inputMode="decimal" value={texts[i]} onChange={e => {
        const raw = e.target.value; setTexts(values => values.map((v, j) => j === i ? raw : v)); const text = raw.trim().replace(',', '.'); setDraft(d => ({ ...d, [key]: text === '' ? NaN : Number(text) }));
      }}/></label>)}
    {(['snap_grid', 'snap_endpoints', 'snap_midpoints', 'snap_axes'] as const).map((key, i) => <label className="checkbox" key={key}><input type="checkbox" checked={draft[key]} onChange={e => setDraft(d => ({ ...d, [key]: e.target.checked }))}/>{[t.snapGrid, t.snapEndpoints, t.snapMidpoints, t.snapAxes][i]}</label>)}
    <p className="hint">{t.settingsHelp}</p>{error && <p role="alert" className="dialog-error">{error}</p>}
    <div className="dialog-actions"><button onClick={() => { setDraft({ ...defaultSettings }); setTexts([String(defaultSettings.movement_step_mm), String(defaultSettings.grid_step_mm), String(defaultSettings.snap_tolerance_px)]); setError(''); }}>{t.resetSettings}</button><button onClick={() => {
      if (![draft.movement_step_mm, draft.grid_step_mm].every(v => Number.isFinite(v) && v > 0) || !Number.isFinite(draft.snap_tolerance_px) || draft.snap_tolerance_px < 1 || draft.snap_tolerance_px > 64) { setError(t.settingsInvalid); return; }
      setBusy(true); setError(''); void onSave(draft).catch(() => setError(t.settingsSaveError)).finally(() => setBusy(false));
    }}>{t.applySettings}</button><button onClick={onCancel}>{t.cancel}</button></div>
  </fieldset></div></div>;
}
