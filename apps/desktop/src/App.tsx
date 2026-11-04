import { useEffect, useRef, useState } from 'react';
import { backend } from './backend';
import { newProject, type CalculationInput, type Project, type Revision, type Vec3 } from './contracts';
import ru from './locales/ru.json';
import en from './locales/en.json';
import errorsRu from './locales/errors-ru.json';
import errorsEn from './locales/errors-en.json';

function NumberField({ value, label, onChange }: { value: number; label: string; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number.isFinite(value)) setText(String(value)); }, [value]);
  return <input aria-label={label} inputMode="decimal" type="text" value={text}
    aria-invalid={!Number.isFinite(value)} onChange={e => {
      const raw = e.target.value; setText(raw);
      const normalised = raw.trim().replace(',', '.');
      onChange(normalised === '' ? NaN : Number(normalised));
    }} />;
}
const display = (n: number) => new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 9 }).format(n);

function Layout({ input, centre, selected, onSelect, invalidText }: {
  input: CalculationInput; centre?: [number, number]; selected: number; onSelect: (n: number) => void; invalidText: string;
}) {
  const points = input.segments.flatMap(s => [s.start_mm, s.end_mm]);
  if (!points.length || points.some(p => p.some(v => !Number.isFinite(v)))) return <div className="drawing empty">{invalidText}</div>;
  // Coordinates below are viewport transformations only; all engineering results come from Rust.
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const x = (v: number) => 70 + (v - minX) / span * 440;
  const y = (v: number) => 350 - (v - minY) / span * 280;
  const valid = [span, minX, minY, maxX, maxY].every(Number.isFinite);
  if (!valid) return <div className="drawing empty">{invalidText}</div>;
  return <svg className="drawing" viewBox="0 0 600 410" aria-label="XY weld layout" role="img">
    <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth=".3"/></pattern></defs>
    <rect width="600" height="410" fill="url(#grid)" className="grid"/>
    <path d="M25 375h45m-45 0v-45" className="axis"/><text x="74" y="380">X</text><text x="20" y="322">Y</text>
    {input.segments.map((s, i) => <g key={i} className={i === selected ? 'segment selected' : 'segment'} onClick={() => onSelect(i)}>
      <line x1={x(s.start_mm[0])} y1={y(s.start_mm[1])} x2={x(s.end_mm[0])} y2={y(s.end_mm[1])} className="hit"/>
      <line x1={x(s.start_mm[0])} y1={y(s.start_mm[1])} x2={x(s.end_mm[0])} y2={y(s.end_mm[1])}/>
      <circle cx={x(s.start_mm[0])} cy={y(s.start_mm[1])} r="4"/><circle cx={x(s.end_mm[0])} cy={y(s.end_mm[1])} r="4"/>
      <text x={x((s.start_mm[0] + s.end_mm[0]) / 2)} y={y((s.start_mm[1] + s.end_mm[1]) / 2) - 12}>S{i + 1} · a={display(s.effective_width_mm)} mm</text>
    </g>)}
    {centre && <g className="centroid"><circle cx={x(centre[0])} cy={y(centre[1])} r="7"/><text x={x(centre[0]) + 12} y={y(centre[1]) + 22}>C</text></g>}
    {input.application.kind === 'point' && input.application.point_mm.every(Number.isFinite) && <g className="application-point"><circle cx={x(input.application.point_mm[0])} cy={y(input.application.point_mm[1])} r="6"/><text x={x(input.application.point_mm[0]) + 12} y={y(input.application.point_mm[1]) - 10}>P</text></g>}
  </svg>;
}

export function App() {
  const [lang, setLang] = useState<'ru' | 'en'>('ru'); const t = lang === 'ru' ? ru : en;
  const [dark, setDark] = useState(false);
  const [project, setProject] = useState<Project>(newProject);
  const [selected, setSelected] = useState(0), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [historical, setHistorical] = useState(false), [formKey, setFormKey] = useState(0);
  const inputFile = useRef<HTMLInputElement>(null);
  const result = project.last_calculation;
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  function describe(e: unknown) {
    if (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string') {
      const dict: Record<string, string> = lang === 'ru' ? errorsRu : errorsEn;
      return dict[e.code] ?? `${t.unknown}: ${e.code}`;
    }
    return t.notDesktop;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (e) { setError(describe(e)); } finally { setBusy(false); }
  }
  function edit(input: CalculationInput) {
    setProject(p => ({ ...p, input, last_calculation: null }));
    setHistorical(false); setMessage(''); setError('');
  }
  function setVector(field: 'force_n' | 'couple_n_mm', index: number, value: number) {
    const vector: Vec3 = [...project.input[field]]; vector[index] = value;
    edit({ ...project.input, [field]: vector });
  }
  function replace(p: Project, snapshot: boolean) {
    setProject(p); setHistorical(snapshot && p.last_calculation !== null); setSelected(0); setFormKey(k => k + 1); setRevisions(null);
  }
  function ensureFinite() {
    const i = project.input;
    const numbers = [...i.segments.flatMap(s => [...s.start_mm, ...s.end_mm, s.effective_width_mm]), ...i.force_n, ...i.couple_n_mm,
      ...(i.application.kind === 'point' ? i.application.point_mm : [])];
    if (numbers.some(n => !Number.isFinite(n))) throw { code: 'non_finite' };
  }
  async function exportProject() {
    ensureFinite(); const text = await backend.export(project);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'weld-project.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className={dark ? 'app dark' : 'app'}>
    <header><div className="brand"><span className="brand-mark">W</span><div><strong>WELD ENGINEERING</strong><small>{t.units}</small></div></div>
      <div className="header-controls"><button onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}>{lang === 'ru' ? 'EN' : 'RU'}</button><button onClick={() => setDark(!dark)}>{dark ? t.light : t.dark}</button></div></header>
    <fieldset disabled={busy} className="toolbar"><button onClick={() => { replace({ ...newProject(), title: t.newProject }, false); setError(''); setMessage(''); }}>{t.new}</button>
      <button onClick={() => run(async () => { ensureFinite(); await backend.save(project); setMessage(t.saved); })}>{t.save}</button>
      <button onClick={() => run(async () => setRevisions(await backend.list()))}>{t.open}</button>
      <button onClick={() => inputFile.current?.click()}>{t.import}</button><button onClick={() => run(exportProject)}>{t.export}</button>
      <label className="project-title">{t.title}<input maxLength={200} value={project.title} onChange={e => setProject({ ...project, title: e.target.value })}/></label>
      <button className="primary" onClick={() => run(async () => { ensureFinite(); const value = await backend.calculate(project.input); setProject(p => ({ ...p, last_calculation: value })); setHistorical(false); })}>{busy ? t.busy : t.calculate}</button>
    </fieldset>
    <input ref={inputFile} type="file" accept=".json,application/json" hidden onChange={e => {
      const file = e.target.files?.[0]; e.target.value = '';
      if (file) void run(async () => { if (file.size > 1048576) throw { code: 'document_too_large' }; replace(await backend.import(await file.text()), true); });
    }}/>
    {error && <div className="notification error" role="alert">{t.error}: {error}</div>}
    {message && <div className="notification" role="status">{message}</div>}
    {historical && <div className="notification">{t.snapshot}</div>}
    {revisions && <section className="revisions"><div className="section-title"><h2>{t.revision}</h2><button onClick={() => setRevisions(null)}>{t.close}</button></div>
      {revisions.length === 0 ? <p>{t.noProjects}</p> : revisions.map(r => <button key={r.id} disabled={busy} onClick={() => run(async () => replace(await backend.open(r.id), true))}>{r.title} · {new Date(Number(r.saved_at_unix_ms)).toLocaleString(lang)} · {r.id.slice(0, 8)}</button>)}
    </section>}
    <main key={formKey}>
      <section className="geometry panel"><div className="section-title"><h2>01 / {t.geometry}</h2><span>XY · mm</span></div>
        <Layout input={project.input} centre={result?.geometry.centroid_mm} selected={selected} onSelect={setSelected} invalidText={t.bounds}/>
        <p className="hint">{t.choose}</p>
        <fieldset disabled={busy}><div className="table-scroll"><table><thead><tr><th>#</th><th>X₁</th><th>Y₁</th><th>X₂</th><th>Y₂</th><th title={t.width}>a, mm</th><th/></tr></thead>
          <tbody>{project.input.segments.map((s, i) => <tr key={i} className={selected === i ? 'active' : ''} onClick={() => setSelected(i)}>
            <th>S{i + 1}</th>{[0, 1, 2, 3, 4].map(k => <td key={k}><NumberField label={`S${i + 1} ${['X1', 'Y1', 'X2', 'Y2', 'a'][k]}`} value={k < 2 ? s.start_mm[k] : k < 4 ? s.end_mm[k - 2] : s.effective_width_mm} onChange={value => {
              const segments = project.input.segments.map((seg, j) => {
                if (j !== i) return seg; const changed = { ...seg, start_mm: [...seg.start_mm] as [number, number], end_mm: [...seg.end_mm] as [number, number] };
                if (k < 2) changed.start_mm[k] = value; else if (k < 4) changed.end_mm[k - 2] = value; else changed.effective_width_mm = value; return changed;
              }); edit({ ...project.input, segments });
            }}/></td>)}<td><button title={t.remove} aria-label={`${t.remove} S${i + 1}`} onClick={() => { edit({ ...project.input, segments: project.input.segments.filter((_, j) => j !== i) }); setSelected(0); }}>×</button></td>
          </tr>)}</tbody></table></div>
          <button disabled={project.input.segments.length >= 256} onClick={() => edit({ ...project.input, segments: [...project.input.segments, { start_mm: [0, 0], end_mm: [0, 100], effective_width_mm: 2 }] })}>{t.add}</button>
        </fieldset><p className="scope">{t.scope}</p>
      </section>
      <section className="panel loads"><div className="section-title"><h2>02 / {t.loads}</h2></div><fieldset disabled={busy}>
        {(['force_n', 'couple_n_mm'] as const).map(field => <div className="load-group" key={field}><h3>{field === 'force_n' ? t.force : t.couple} <span>{field === 'force_n' ? 'N' : 'N·mm'}</span></h3>
          {project.input[field].map((value, i) => <label className="component" key={i}>{field === 'force_n' ? 'F' : 'M'}{'xyz'[i]}<NumberField label={`${field} ${'xyz'[i]}`} value={value} onChange={n => setVector(field, i, n)}/></label>)}
        </div>)}
        <label className="checkbox"><input type="checkbox" checked={project.input.application.kind === 'centroid'} onChange={e => edit({ ...project.input, application: e.target.checked ? { kind: 'centroid' } : { kind: 'point', point_mm: [0, 0, 0] } })}/>{t.centroid}</label>
        {project.input.application.kind === 'point' && <div className="load-group"><h3>{t.point} <span>mm</span></h3>{project.input.application.point_mm.map((value, i) => <label className="component" key={i}>{'xyz'[i]}<NumberField label={`P ${'xyz'[i]}`} value={value} onChange={n => {
          if (project.input.application.kind !== 'point') return; const point_mm: Vec3 = [...project.input.application.point_mm]; point_mm[i] = n;
          edit({ ...project.input, application: { kind: 'point', point_mm } });
        }}/></label>)}</div>}
      </fieldset><p className="hint">{t.source}</p></section>
      <section className="panel results"><div className="section-title"><h2>03 / {t.results}</h2></div>
        <div className="unsupported">{t.unsupported}</div><p className="hint">{t.safety}</p>
        {!result ? <p className="empty">{t.noResult}</p> : <><p className="validation">{t.validation}</p>
          <dl><dt>{t.length}</dt><dd>{display(result.geometry.length_mm)} <small>mm</small></dd><dt>{t.area}</dt><dd>{display(result.geometry.area_mm2)} <small>mm²</small></dd>
            <dt>{t.centre} X / Y</dt><dd>{result.geometry.centroid_mm.map(display).join(' / ')} <small>mm</small></dd>
            {(['ix_mm4', 'iy_mm4', 'ixy_mm4', 'polar_mm4'] as const).map((key, i) => <div className="result-row" key={key}><dt>{['Ix', 'Iy', 'Ixy', 'J'][i]}</dt><dd>{display(result.geometry[key])} <small>mm⁴</small></dd></div>)}</dl>
          <h3>{t.momentCentre}</h3><p className="values">{result.moment_at_centroid_n_mm.map(display).join(' / ')} N·mm</p>
          {result.traction_mpa ? <><h3>{t.traction}</h3><dl>{result.traction_mpa.map((value, i) => <div className="result-row" key={i}><dt>{['τx', 'τy', 'σz'][i]}</dt><dd>{display(value)} <small>MPa</small></dd></div>)}</dl></> : <p className="validation">{t.momentNotice}</p>}
          <p className="engine">{result.method_id}<br/>Engine {result.engine_version} · schema {result.schema_version}</p>
        </>}
      </section>
    </main>
    <footer>Weld Engineering 0.1.0 <span>Windows · Rust calculation engine</span></footer>
  </div>;
}
