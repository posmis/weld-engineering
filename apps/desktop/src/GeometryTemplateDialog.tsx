import { useEffect, useRef, useState } from 'react';
import { backend } from './backend';
import type { GeometryTemplateRequest, GeometryTemplateResult, SegmentInput, TemplateKind } from './contracts';
import { NumberField } from './NumberField';
import { fitLayout } from './viewport';
import type ru from './locales/ru.json';
export function GeometryTemplateDialog({ t, describeError, onApply, onCancel }: {
  t: typeof ru; describeError: (error: unknown) => string; onApply: (segments: SegmentInput[]) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<GeometryTemplateRequest>({ schema_version: 1, kind: 'rectangle', width_mm: 100, height_mm: 40, effective_width_mm: 2, origin_mm: [0, 0] });
  const [preview, setPreview] = useState<{ request: GeometryTemplateRequest; value: GeometryTemplateResult } | null>(null);
  const [issue, setIssue] = useState<{ request: GeometryTemplateRequest; message: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const valid = [draft.width_mm, draft.height_mm, draft.effective_width_mm].every(v => Number.isFinite(v) && v > 0) && draft.origin_mm.every(Number.isFinite);
  useEffect(() => {
    const previous = document.activeElement; root.current?.querySelector('select')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (!valid) return;
    let active = true;
    const timer = setTimeout(() => {
      void backend.groupTemplate(draft).then(value => {
        if (value.schema_version !== 1) throw { code: 'unsupported_schema' };
        if (active) { setPreview({ request: draft, value }); setIssue(null); }
      }).catch(error => { if (active) { setPreview(null); setIssue({ request: draft, message: describeError(error) }); } });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [draft, valid, describeError]);
  const value = preview?.request === draft ? preview.value : null;
  const view = value && fitLayout(value.segments.flatMap(s => [s.start_mm, s.end_mm]), { width: 600, height: 320 });
  const error = issue?.request === draft ? issue.message : !valid ? t.templateInvalid : '';
  const kinds: TemplateKind[] = ['rectangle', 'parallel', 'u_shape', 'l_shape'];
  return <div className="modal-backdrop"><div ref={root} className="unsaved-dialog geometry-template-dialog" role="dialog" aria-modal="true" aria-labelledby="group-template-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
    if (event.key === 'Tab') {
      const fields = [...(root.current?.querySelectorAll<HTMLElement>('input:not(:disabled),select:not(:disabled),button:not(:disabled)') ?? [])];
      const first = fields[0], last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}><h2 id="group-template-title">{t.groupTemplate}</h2><form onSubmit={event => { event.preventDefault(); if (value && view && valid) onApply(value.segments); }}>
    <div className="template-body"><fieldset className="template-fields">
      <label className="template-wide">{t.templateKind}<select aria-label={t.templateKind} value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as TemplateKind }))}>
        {kinds.map((kind, i) => <option key={kind} value={kind}>{[t.templateRectangle, t.templateParallel, t.templateU, t.templateL][i]}</option>)}
      </select></label>
      {(['width_mm', 'height_mm', 'effective_width_mm'] as const).map((key, i) => <label key={key} className={key === 'effective_width_mm' ? 'template-wide' : ''}>{[t.templateWidth, t.templateHeight, t.templateEffectiveWidth][i]}<NumberField label={[t.templateWidth, t.templateHeight, t.templateEffectiveWidth][i]} value={draft[key]} onChange={n => setDraft(d => ({ ...d, [key]: n }))}/></label>)}
      {draft.origin_mm.map((value, i) => <label key={i}>{[t.templateOriginX, t.templateOriginY][i]}<NumberField label={[t.templateOriginX, t.templateOriginY][i]} value={value} onChange={n => setDraft(d => { const origin_mm: [number, number] = [...d.origin_mm]; origin_mm[i] = n; return { ...d, origin_mm }; })}/></label>)}
      <p className="hint template-wide">{t.templateOriginHelp}</p>
    </fieldset><section className="template-preview-pane" aria-label={t.templatePreview}>
      {value && view ? <><svg className="template-preview" viewBox="0 0 600 320" role="img" aria-label={t.templatePreview}>
        {value.segments.map((s, i) => {
          const x = (n: number) => 300 + (n - view.cx) * view.scale, y = (n: number) => 160 - (n - view.cy) * view.scale;
          return <g key={i}><line x1={x(s.start_mm[0])} y1={y(s.start_mm[1])} x2={x(s.end_mm[0])} y2={y(s.end_mm[1])}/><text textAnchor="end" x={x(s.start_mm[0] / 2 + s.end_mm[0] / 2) - 4} y={y(s.start_mm[1] / 2 + s.end_mm[1] / 2) - 8}>S{i + 1}</text></g>;
        })}
      </svg><p>{t.templateSegments}: {value.segments.length} · XY, mm</p></> : <div className="template-placeholder">{value ? t.bounds : error || t.templatePreparing}</div>}
      <p className="hint">{t.templateHelp}</p>
    </section></div>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="submit" className="primary" disabled={!value || !view || !valid}>{t.applyTemplate}</button><button type="button" onClick={onCancel}>{t.cancel}</button></div>
  </form></div></div>;
}
