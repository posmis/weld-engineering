import { useEffect, useRef, useState } from 'react';
import { backend } from './backend';
import { newProject, type CalculationInput, type Project, type Revision, type Vec3 } from './contracts';
import { LayoutEditor } from './LayoutEditor';
import { UnsavedDialog } from './UnsavedDialog';
import { desktopWindow } from './desktopWindow';
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
const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 9 });
const display = (n: number) => numberFormatter.format(n);

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
  const baseline = useRef(JSON.stringify(newProject()));
  const dirty = JSON.stringify(project) !== baseline.current;
  const dirtyRef = useRef(dirty), busyRef = useRef(busy), allowClose = useRef(false);
  dirtyRef.current = dirty; busyRef.current = busy;
  const dragSnapshot = useRef<{ project: Project; historical: boolean } | null>(null);
  const [pending, setPending] = useState<{ run: () => void | Promise<void> } | null>(null);
  useEffect(() => {
    const suppressMenu = (event: Event) => event.preventDefault();
    const suppressBrowserKeys = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (event.key === 'F12' || event.key === 'F5' || (ctrl && event.key.toLowerCase() === 'r') ||
          (ctrl && event.key.toLowerCase() === 'u') || (ctrl && event.shiftKey && ['i', 'j', 'c'].includes(event.key.toLowerCase()))) event.preventDefault();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current && !allowClose.current) { event.preventDefault(); event.returnValue = ''; } };
    document.addEventListener('contextmenu', suppressMenu);
    document.addEventListener('keydown', suppressBrowserKeys);
    window.addEventListener('beforeunload', beforeUnload);
    let disposed = false; let unlisten: (() => void) | undefined;
    void desktopWindow.listenClose(event => {
      if (allowClose.current || (!dirtyRef.current && !busyRef.current)) return;
      event.preventDefault();
      setPending({ run: async () => {
        allowClose.current = true;
        try { await desktopWindow.close(); } catch (error) { allowClose.current = false; throw error; }
      } });
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => setError(document.documentElement.lang === 'en' ? en.windowError : ru.windowError));
    return () => {
      disposed = true; unlisten?.(); document.removeEventListener('contextmenu', suppressMenu);
      document.removeEventListener('keydown', suppressBrowserKeys); window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);
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
  function replace(p: Project, snapshot: boolean, imported = false) {
    baseline.current = imported ? '' : JSON.stringify(p);
    setProject(p); setHistorical(snapshot && p.last_calculation !== null); setSelected(0); setFormKey(k => k + 1); setRevisions(null);
  }
  function request(action: { run: () => void | Promise<void> }) {
    setError(''); setMessage('');
    if (dirtyRef.current) setPending(action);
    else void run(async () => { await action.run(); });
  }
  async function saveCurrent() {
    ensureFinite(); await backend.save(project); baseline.current = JSON.stringify(project); setMessage(t.saved);
  }
  function continuePending(save: boolean) {
    const action = pending; if (!action) return;
    void run(async () => {
      if (save) await saveCurrent();
      setPending(null); await action.run();
    });
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
  return <div className={dark ? 'app dark' : 'app'}><div inert={pending !== null}>
    <header><div className="brand"><span className="brand-mark">W</span><div><strong>WELD ENGINEERING</strong><small>{t.units}</small></div></div>
      <div className="header-controls"><button onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}>{lang === 'ru' ? 'EN' : 'RU'}</button><button onClick={() => setDark(!dark)}>{dark ? t.light : t.dark}</button></div></header>
    <fieldset disabled={busy || pending !== null} className="toolbar"><button onClick={() => request({ run: () => replace({ ...newProject(), title: t.newProject }, false) })}>{t.new}</button>
      <button onClick={() => run(saveCurrent)}>{t.save}</button>
      <button onClick={() => run(async () => setRevisions(await backend.list()))}>{t.open}</button>
      <button onClick={() => inputFile.current?.click()}>{t.import}</button><button onClick={() => run(exportProject)}>{t.export}</button>
      <label className="project-title">{t.title}<input maxLength={200} value={project.title} onChange={e => setProject({ ...project, title: e.target.value })}/></label>
      <button className="primary" onClick={() => run(async () => { ensureFinite(); const value = await backend.calculate(project.input); setProject(p => ({ ...p, last_calculation: value })); setHistorical(false); })}>{busy ? t.busy : t.calculate}</button>
    </fieldset>
    <input ref={inputFile} type="file" accept=".json,application/json" hidden onChange={e => {
      const file = e.target.files?.[0]; e.target.value = '';
      if (file) request({ run: async () => { if (file.size > 1048576) throw { code: 'document_too_large' }; replace(await backend.import(await file.text()), true, true); } });
    }}/>
    {error && !pending && <div className="notification error" role="alert">{t.error}: {error}</div>}
    {message && <div className="notification" role="status">{message}</div>}
    {historical && <div className="notification">{t.snapshot}</div>}
    {revisions && <section className="revisions"><div className="section-title"><h2>{t.revision}</h2><button onClick={() => setRevisions(null)}>{t.close}</button></div>
      {revisions.length === 0 ? <p>{t.noProjects}</p> : revisions.map(r => <button key={r.id} disabled={busy || pending !== null} onClick={() => request({ run: async () => replace(await backend.open(r.id), true) })}>{r.title} · {new Date(Number(r.saved_at_unix_ms)).toLocaleString(lang)} · {r.id.slice(0, 8)}</button>)}
    </section>}
    <main key={formKey}>
      <section className="geometry panel"><div className="section-title"><h2>01 / {t.geometry}</h2><span>XY · mm</span></div>
        <LayoutEditor input={project.input} centre={result?.geometry.centroid_mm} selected={selected} onSelect={setSelected} onChange={segments => edit({ ...project.input, segments })} disabled={busy || pending !== null} t={t}
          onDragStart={() => { dragSnapshot.current = { project, historical }; }}
          onDragCancel={() => { const original = dragSnapshot.current; if (original) { setProject(original.project); setHistorical(original.historical); } }}
          onDragFinish={() => { dragSnapshot.current = null; }}/>

        <p className="hint">{t.choose}</p>
        <fieldset disabled={busy || pending !== null}><div className="table-scroll"><table><thead><tr><th>#</th><th>X₁</th><th>Y₁</th><th>X₂</th><th>Y₂</th><th title={t.width}>a, mm</th><th/></tr></thead>
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
      <section className="panel loads"><div className="section-title"><h2>02 / {t.loads}</h2></div><fieldset disabled={busy || pending !== null}>
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
    <footer>Weld Engineering 0.1.0 <span className={dirty ? 'dirty-state' : ''}>{dirty ? t.dirty : 'Windows · Rust calculation engine'}</span></footer>
    </div>
    {pending && <UnsavedDialog title={t.unsaved} description={t.unsavedDescription} save={t.saveContinue} discard={t.discard} cancel={t.cancel} busy={busy} error={error}
      onSave={() => continuePending(true)} onDiscard={() => continuePending(false)} onCancel={() => { setPending(null); setError(''); }}/>}
  </div>;
}
