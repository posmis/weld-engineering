import { useEffect, useMemo, useRef, useState } from 'react';
import { backend } from './backend';
import type { GeometryTransform, GeometryTransformRequest, GeometryTemplateResult, SegmentInput } from './contracts';
import { NumberField } from './NumberField';
import { fitLayout } from './viewport';
import type ru from './locales/ru.json';
export function GeometryTransformDialog({ segments, t, describeError, onApply, onCancel }: {
  segments: SegmentInput[]; t: typeof ru; describeError: (error: unknown) => string;
  onApply: (segments: SegmentInput[]) => void; onCancel: () => void;
}) {
  const [kind, setKind] = useState<GeometryTransform['kind']>('translate');
  const [delta, setDelta] = useState<[number, number]>([0, 0]);
  const [origin, setOrigin] = useState<[number, number]>([0, 0]);
  const [angle, setAngle] = useState(90), [axis, setAxis] = useState<'x' | 'y'>('x');
  const request = useMemo<GeometryTransformRequest>(() => ({ schema_version: 1, segments, transform:
    kind === 'translate' ? { kind, delta_mm: delta } : kind === 'rotate' ? { kind, origin_mm: origin, angle_deg: angle } : { kind, origin_mm: origin, axis }
  }), [segments, kind, delta, origin, angle, axis]);
  const [preview, setPreview] = useState<{ request: GeometryTransformRequest; value: GeometryTemplateResult } | null>(null);
  const [issue, setIssue] = useState<{ request: GeometryTransformRequest; message: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const valid = kind === 'translate' ? delta.every(Number.isFinite) : origin.every(Number.isFinite) && (kind !== 'rotate' || Number.isFinite(angle));
  useEffect(() => {
    const previous = document.activeElement; root.current?.querySelector('select')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (!valid) return;
    let active = true;
    const timer = setTimeout(() => {
      void backend.transformGroup(request).then(value => {
        if (value.schema_version !== 1) throw { code: 'unsupported_schema' };
        if (active) { setPreview({ request, value }); setIssue(null); }
      }).catch(error => { if (active) { setPreview(null); setIssue({ request, message: describeError(error) }); } });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [request, valid, describeError]);
  const value = preview?.request === request ? preview.value : null;
  const view = value && fitLayout([...segments, ...value.segments].flatMap(s => [s.start_mm, s.end_mm]), { width: 600, height: 320 });
  const error = !valid ? t.transformInvalid : issue?.request === request ? issue.message : '';
  return <div className="modal-backdrop"><div ref={root} className="unsaved-dialog geometry-template-dialog" role="dialog" aria-modal="true" aria-labelledby="group-transform-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
    if (event.key === 'Tab') {
      const fields = [...(root.current?.querySelectorAll<HTMLElement>('input:not(:disabled),select:not(:disabled),button:not(:disabled)') ?? [])];
      if (event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0]?.focus(); }
    }
  }}><h2 id="group-transform-title">{t.transformGroup}</h2><form onSubmit={event => { event.preventDefault(); if (value && view && valid) onApply(value.segments); }}>
    <div className="template-body"><fieldset className="template-fields">
      <label className="template-wide">{t.transformKind}<select aria-label={t.transformKind} value={kind} onChange={e => setKind(e.target.value as GeometryTransform['kind'])}>
        {(['translate', 'rotate', 'mirror'] as const).map((v, i) => <option key={v} value={v}>{[t.transformTranslate, t.transformRotate, t.transformMirror][i]}</option>)}
      </select></label>
      {(kind === 'translate' ? delta : origin).map((v, i) => {
        const label = (kind === 'translate' ? [t.transformDeltaX, t.transformDeltaY] : [t.transformOriginX, t.transformOriginY])[i];
        return <label key={`${kind}-${i}`}>{label}<NumberField label={label} value={v} onChange={n => {
          const update = (old: [number, number]): [number, number] => i === 0 ? [n, old[1]] : [old[0], n];
          if (kind === 'translate') setDelta(update); else setOrigin(update);
        }}/></label>;
      })}
      {kind === 'rotate' && <label className="template-wide">{t.transformAngle}<NumberField label={t.transformAngle} value={angle} onChange={setAngle}/></label>}
      {kind === 'mirror' && <label className="template-wide">{t.transformAxis}<select aria-label={t.transformAxis} value={axis} onChange={e => setAxis(e.target.value as 'x' | 'y')}><option value="x">{t.transformAxisX}</option><option value="y">{t.transformAxisY}</option></select></label>}
      <p className="hint template-wide">{t.transformDirectionHelp}</p>
    </fieldset><section className="template-preview-pane" aria-label={t.transformPreview}>
      {value && view ? <svg className="template-preview" viewBox="0 0 600 320" role="img" aria-label={t.transformPreview}>
        {[segments, value.segments].map((group, layer) => <g key={layer} className={layer === 0 ? 'transform-original' : 'transform-proposed'}>{group.map((s, i) => {
          const x = (n: number) => 300 + (n - view.cx) * view.scale, y = (n: number) => 160 - (n - view.cy) * view.scale;
          return <line key={i} x1={x(s.start_mm[0])} y1={y(s.start_mm[1])} x2={x(s.end_mm[0])} y2={y(s.end_mm[1])}/>;
        })}</g>)}
      </svg> : <div className="template-placeholder">{value ? t.bounds : error || t.templatePreparing}</div>}
      <p className="hint">{t.transformPreviewHelp}</p><p className="hint">{t.transformHelp}</p>
    </section></div>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="submit" className="primary" disabled={!value || !view || !valid}>{t.applyTransform}</button><button type="button" onClick={onCancel}>{t.cancel}</button></div>
  </form></div></div>;
}
