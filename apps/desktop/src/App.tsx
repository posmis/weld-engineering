import { useEffect, useRef, useState } from 'react';
import { ProjectHistory, sameValue, type EditorSnapshot } from './projectHistory';
import { GeometryTransformDialog } from './GeometryTransformDialog';
import { GeometryTemplateDialog } from './GeometryTemplateDialog';
import { IntermittentEditor } from './IntermittentEditor';
import type { StressComponent } from './stressContour';
import { CaseResults } from './CaseResults';
import { activateCase, addCase, editInput, maxCases, removeCase, withCalculation } from './loadCases';
import { backend } from './backend';
import { newProject, type CalculationInput, type Project, type Revision, type Vec3 } from './contracts';
import { defaultSettings, type EditorSettings } from './editorMovement';
import { SettingsDialog } from './SettingsDialog';
import { CadWorkspace } from './CadWorkspace';
import { ModelTree } from './ModelTree';
import { NumberField } from './NumberField';
import { ProjectResults } from './ProjectResults';
import { WeldProperties } from './WeldProperties';
import { LayoutEditor } from './LayoutEditor';
import { UnsavedDialog } from './UnsavedDialog';
import { desktopWindow } from './desktopWindow';
import ru from './locales/ru.json';
import en from './locales/en.json';
import errorsRu from './locales/errors-ru.json';
import errorsEn from './locales/errors-en.json';

export function App() {
  const [lang, setLang] = useState<'ru' | 'en'>('ru'); const t = lang === 'ru' ? ru : en;
  const [settings, setSettings] = useState<EditorSettings>(defaultSettings);
  const [transformOpen, setTransformOpen] = useState(false);
  const transformOpenRef = useRef(false); transformOpenRef.current = transformOpen;
  const [templateOpen, setTemplateOpen] = useState(false);
  const templateOpenRef = useRef(false); templateOpenRef.current = templateOpen;
  const [settingsOpen, setSettingsOpen] = useState(false), [settingsLoading, setSettingsLoading] = useState(true), [settingsWarning, setSettingsWarning] = useState(false);
  const settingsOpenRef = useRef(false); settingsOpenRef.current = settingsOpen;
  useEffect(() => { let active = true; void backend.getEditorSettings().then(value => { if (active) setSettings(value); }).catch(() => { if (active) setSettingsWarning(true); }).finally(() => { if (active) setSettingsLoading(false); }); return () => { active = false; }; }, []);
  const [inspector, setInspector] = useState<'weld' | 'loads'>('weld');
  const [displayComponent, setDisplayComponent] = useState<StressComponent | null>(null), [showLoads, setShowLoads] = useState(true);
  const [resultsOpen, setResultsOpen] = useState(false);
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
  const history = useRef(new ProjectHistory());
  const current = useRef<EditorSnapshot>({ project, historical, selected }); current.current = { project, historical, selected };
  const [gestureActive, setGestureActive] = useState(false);
  const dragSnapshot = useRef<{ snapshot: EditorSnapshot; checkpoint: ReturnType<ProjectHistory['checkpoint']>; token: object } | null>(null);
  const inputEpoch = useRef(0);
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
      if (transformOpenRef.current) { event.preventDefault(); setTransformOpen(false); return; }
      if (templateOpenRef.current) { event.preventDefault(); setTemplateOpen(false); return; }
      if (settingsOpenRef.current) { event.preventDefault(); if (!busyRef.current) setSettingsOpen(false); return; }
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
  function showSnapshot(snapshot: EditorSnapshot) {
    const safe = { ...snapshot, selected: Math.max(0, Math.min(snapshot.selected, snapshot.project.input.segments.length - 1)) };
    current.current = safe; setProject(safe.project); setHistorical(safe.historical); setSelected(safe.selected);
  }
  function changeProject(next: Project, historicalNext = historical) {
    const before = current.current;
    const after = { ...before, project: next, historical: historicalNext };
    const field = document.activeElement;
    const group = dragSnapshot.current?.token ?? (field instanceof HTMLInputElement ? field : null);
    history.current.record(before, after, group); showSnapshot(after);
  }
  function edit(input: CalculationInput) {
    if (sameValue(input, current.current.project.input)) return;
    inputEpoch.current += 1;
    changeProject(editInput(current.current.project, input), false);
    setMessage(''); setError('');
  }
  function travel(direction: 'undo' | 'redo') {
    if (busy || pending || settingsOpen || transformOpen || templateOpen || gestureActive) return;
    const snapshot = history.current[direction](current.current);
    if (!snapshot) return;
    inputEpoch.current += 1; showSnapshot(snapshot); setMessage(''); setError('');
  }
  function selectWeld(index: number) { setSelected(index); setInspector('weld'); }
  function addSegment() {
    if (project.input.segments.length >= 256) return;
    const index = project.input.segments.length;
    edit({ ...project.input, segments: [...project.input.segments, { start_mm: [0, 0], end_mm: [0, 100], effective_width_mm: 2 }] });
    selectWeld(index);
  }
  async function calculateCurrent() {
    history.current.breakGroup(); ensureFinite(); const epoch = inputEpoch.current;
    const value = await backend.calculate(project.input);
    if (epoch !== inputEpoch.current) return;
    showSnapshot({ ...current.current, project: withCalculation(current.current.project, value), historical: false });
    setResultsOpen(true);
  }
  function changeCase(next: Project) {
    if (sameValue(next, project)) return;
    try { ensureFinite(); } catch (e) { setError(describe(e)); return; }
    inputEpoch.current += 1; history.current.breakGroup(); changeProject(next, false); setError(''); setMessage('');
  }
  async function calculateAll() {
    ensureFinite(); const epoch = inputEpoch.current;
    const batch = await backend.calculateCases(project);
    if (epoch !== inputEpoch.current) return;
    showSnapshot({ ...current.current, project: batch.project, historical: false }); setResultsOpen(true);
    if (batch.failures.length) setError(batch.failures.map(f => `${project.casebook?.cases.find(c => c.id === f.case_id)?.title}: ${describe(f.error)}`).join('; '));
  }
  function setVector(field: 'force_n' | 'couple_n_mm', index: number, value: number) {
    const vector: Vec3 = [...project.input[field]]; vector[index] = value;
    edit({ ...project.input, [field]: vector });
  }
  function replace(p: Project, snapshot: boolean, imported = false) {
    inputEpoch.current += 1; dragSnapshot.current = null; setGestureActive(false); history.current.clear();
    baseline.current = imported ? '' : JSON.stringify(p);
    showSnapshot({ project: p, historical: snapshot && p.last_calculation !== null, selected: 0 }); setFormKey(k => k + 1); setRevisions(null); setInspector('weld'); setResultsOpen(p.last_calculation !== null);
  }
  function request(action: { run: () => void | Promise<void> }) {
    setError(''); setMessage('');
    if (dirtyRef.current) setPending(action);
    else void run(async () => { await action.run(); });
  }
  async function saveCurrent() {
    history.current.breakGroup(); ensureFinite(); await backend.save(project); baseline.current = JSON.stringify(project); setMessage(t.saved);
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
  async function exportPdf() {
    ensureFinite();
    // Validate the entire casebook, including historical snapshots, at the Rust boundary.
    const validated: Project = JSON.parse(await backend.export(project));
    const [{ createReport }, { default: fontUrl }] = await Promise.all([import('./report'), import('./assets/NotoSans-Regular.ttf?url')]);
    const response = await fetch(fontUrl); if (!response.ok) throw { code: 'invalid_report' };
    const summary = validated.casebook ? await backend.summarizeCases(validated) : null;
    const bytes = await createReport(validated, new Uint8Array(await response.arrayBuffer()), summary);
    const path = await backend.savePdf(bytes);
    if (path) setMessage(`${t.reportSaved}: ${path}`);
  }
  const blocked = busy || pending !== null;
  return <div className={dark ? 'app dark' : 'app'} onBlurCapture={() => history.current.breakGroup()} onKeyDownCapture={event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || !['z', 'y'].includes(event.key.toLowerCase())) return;
    const target = event.target as HTMLElement;
    if (target.closest('input,textarea,[contenteditable="true"]')) return;
    event.preventDefault(); travel(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo');
  }} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && !pending && !settingsOpen && !transformOpen && !templateOpen) setRevisions(null); }}>
    <div className="app-shell" inert={pending !== null || settingsOpen || transformOpen || templateOpen}>
      <header className="cad-header"><div className="brand"><span className="brand-mark">W</span><strong>WELD ENGINEERING</strong></div>
        <label className="project-title">{t.title}<input maxLength={200} value={project.title} disabled={blocked || gestureActive} onChange={e => changeProject({ ...project, title: e.target.value })}/></label>
        <div className="header-controls"><button disabled={blocked || settingsLoading || gestureActive} onClick={() => setSettingsOpen(true)}>{t.settings}</button><button onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}>{lang === 'ru' ? 'EN' : 'RU'}</button><button onClick={() => setDark(!dark)}>{dark ? t.light : t.dark}</button></div>
      </header>
      <fieldset disabled={blocked || gestureActive} className="toolbar" aria-label={t.mainToolbar}>
        <div className="tool-group"><button onClick={() => request({ run: () => replace({ ...newProject(), title: t.newProject }, false) })}>{t.new}</button>
          <button onClick={() => run(saveCurrent)}>{t.save}</button><button onClick={() => run(async () => setRevisions(await backend.list()))}>{t.open}</button>
          <button onClick={() => inputFile.current?.click()}>{t.import}</button><button onClick={() => run(exportProject)}>{t.export}</button></div>
        <div className="tool-group"><button disabled={!history.current.canUndo || gestureActive} onClick={() => travel('undo')} title="Ctrl+Z">{t.undo}</button>
          <button disabled={!history.current.canRedo || gestureActive} onClick={() => travel('redo')} title="Ctrl+Y / Ctrl+Shift+Z">{t.redo}</button><button disabled={project.input.segments.length >= 256 || gestureActive} onClick={addSegment}>{t.add}</button><button disabled={gestureActive} onClick={() => setTemplateOpen(true)}>{t.groupTemplate}</button><button disabled={gestureActive} onClick={() => setTransformOpen(true)}>{t.transformGroup}</button></div>
        <div className="tool-group"><button onClick={() => run(exportPdf)}>{t.pdfReport}</button>
          <button className="primary" onClick={() => run(calculateCurrent)}>{busy ? t.busy : t.calculate}</button>
          <button disabled={!project.casebook} onClick={() => run(calculateAll)}>{t.calculateAll}</button>
          <button aria-pressed={resultsOpen} disabled={gestureActive} onClick={() => setResultsOpen(!resultsOpen)}>{t.toggleResults}</button></div>
      </fieldset>
      <input ref={inputFile} type="file" accept=".json,application/json" hidden onChange={e => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (file) request({ run: async () => { if (file.size > 1048576) throw { code: 'document_too_large' }; replace(await backend.import(await file.text()), true, true); } });
      }}/>
      {revisions && <section className="revisions"><div className="section-title"><h2>{t.revision}</h2><button onClick={() => setRevisions(null)}>{t.close}</button></div>
        {revisions.length === 0 ? <p>{t.noProjects}</p> : revisions.map(r => <button key={r.id} disabled={blocked} onClick={() => request({ run: async () => replace(await backend.open(r.id), true) })}>{r.title} · {new Date(Number(r.saved_at_unix_ms)).toLocaleString(lang)} · {r.id.slice(0, 8)}</button>)}
      </section>}
      <CadWorkspace resultsOpen={resultsOpen} t={t} sidebar={<>
        <div className="dock-title">{t.modelTree}</div>
        <ModelTree count={project.input.segments.length} selected={selected} panel={inspector} disabled={blocked || gestureActive}
          onWeld={selectWeld} onLoads={() => setInspector('loads')} onResults={() => setResultsOpen(true)} t={t}/>
        <div className="dock-title">{t.properties}</div>
        <div className="property-scroll" key={formKey}>
          <section hidden={inspector !== 'weld'} aria-label={t.weldProperties}><WeldProperties segments={project.input.segments} selected={selected} disabled={blocked || gestureActive} t={t}
            onChange={segments => edit({ ...project.input, segments })} onRemove={() => { edit({ ...project.input, segments: project.input.segments.filter((_, i) => i !== selected) }); selectWeld(Math.max(0, selected - 1)); }}/>
            {project.input.segments[selected] && <IntermittentEditor key={selected} disabled={blocked || gestureActive} t={t} onApply={params => run(async () => {
              ensureFinite(); const epoch = inputEpoch.current;
              const input = await backend.intermittent({ input: project.input, segment_index: selected, ...params });
              if (epoch === inputEpoch.current) { history.current.breakGroup(); edit(input); }
            })}/>}
          </section>
          <section className="loads" hidden={inspector !== 'loads'} aria-label={t.loads}><div className="property-heading">{t.loads}</div><fieldset disabled={blocked || gestureActive}>
        <div className="case-controls"><label>{t.loadCase}<select value={project.casebook?.active_id ?? ''} onChange={e => changeCase(activateCase(project, e.target.value))}>
          {!project.casebook && <option value="">LC1</option>}{project.casebook?.cases.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
          {project.casebook && <label>{t.caseTitle}<input maxLength={100} value={project.casebook.cases.find(c => c.id === project.casebook?.active_id)?.title ?? ''} onChange={e => changeProject({ ...project, casebook: { ...project.casebook!, cases: project.casebook!.cases.map(c => c.id === project.casebook?.active_id ? { ...c, title: e.target.value } : c) } })}/></label>}
          <div className="case-buttons"><button disabled={(project.casebook?.cases.length ?? 1) >= maxCases} onClick={() => changeCase(addCase(project, `LC${(project.casebook?.cases.length ?? 1) + 1}`))}>{t.cloneCase}</button><button disabled={!project.casebook || project.casebook.cases.length < 2} onClick={() => changeCase(removeCase(project))}>{t.removeCase}</button></div>
        </div>
        {(['force_n', 'couple_n_mm'] as const).map(field => <div className="load-group" key={field}><h3>{field === 'force_n' ? t.force : t.couple} <span>{field === 'force_n' ? 'N' : 'N·mm'}</span></h3>
          {project.input[field].map((value, i) => <label className="component" key={i}>{field === 'force_n' ? 'F' : 'M'}{'xyz'[i]}<NumberField label={`${field} ${'xyz'[i]}`} value={value} onChange={n => setVector(field, i, n)}/></label>)}
        </div>)}
        <label className="checkbox"><input type="checkbox" checked={project.input.application.kind === 'centroid'} onChange={e => edit({ ...project.input, application: e.target.checked ? { kind: 'centroid' } : { kind: 'point', point_mm: [0, 0, 0] } })}/>{t.centroid}</label>
        {project.input.application.kind === 'point' && <div className="load-group"><h3>{t.point} <span>mm</span></h3>{project.input.application.point_mm.map((value, i) => <label className="component" key={i}>{'xyz'[i]}<NumberField label={`P ${'xyz'[i]}`} value={value} onChange={n => {
          if (project.input.application.kind !== 'point') return; const point_mm: Vec3 = [...project.input.application.point_mm]; point_mm[i] = n;
          edit({ ...project.input, application: { kind: 'point', point_mm } });
        }}/></label>)}</div>}
          </fieldset><p className="hint">{t.source}</p></section>
        </div>
      </>} viewport={<section className="cad-viewport" aria-label={t.workspace}>
        <div className="viewport-title"><strong>{t.geometry}</strong><div className="viewport-layers"><label>{t.viewMode}<select aria-label={t.viewMode} disabled={blocked || gestureActive} value={result?.analysis_status === 'computed' ? displayComponent ?? 'geometry' : 'geometry'} onChange={e => setDisplayComponent(e.target.value === 'geometry' ? null : Number(e.target.value) as StressComponent)}>
          <option value="geometry">{t.geometryView}</option>{['τx', 'τy', 'σz'].map((name, i) => <option key={name} value={i} disabled={result?.analysis_status !== 'computed'}>{name} · MPa</option>)}
        </select></label><button aria-pressed={showLoads} disabled={blocked || gestureActive} onClick={() => setShowLoads(!showLoads)}>{t.loadLayer}</button></div><span>{project.casebook?.cases.find(c => c.id === project.casebook?.active_id)?.title} · XY · mm</span></div>
        <LayoutEditor key={formKey} input={project.input} centre={result?.geometry.centroid_mm} result={result} displayComponent={displayComponent} showLoads={showLoads} selected={selected} onSelect={selectWeld}
          onChange={segments => edit({ ...project.input, segments })} disabled={blocked || settingsOpen || transformOpen || templateOpen || settingsLoading} t={t} settings={settings} compact
          onDragStart={() => { history.current.breakGroup(); setGestureActive(true); dragSnapshot.current = { snapshot: current.current, checkpoint: history.current.checkpoint(), token: {} }; }}
          onDragCancel={() => {
            const original = dragSnapshot.current; if (!original) return;
            inputEpoch.current += 1; const input = { ...current.current.project.input, segments: original.snapshot.project.input.segments };
            const same = sameValue(input, original.snapshot.project.input);
            const restored = { ...current.current, historical: same && original.snapshot.historical, project: same ? { ...original.snapshot.project, title: current.current.project.title } : editInput(current.current.project, input) };
            history.current.restore(original.checkpoint); history.current.record(original.snapshot, restored); showSnapshot(restored);
          }} onDragFinish={() => { dragSnapshot.current = null; setGestureActive(false); history.current.breakGroup(); }}/>
      </section>} results={<section className="results" aria-label={t.results}>
        <div className="dock-title"><strong>{t.results}</strong><button aria-label={t.closeResults} onClick={() => setResultsOpen(false)}>×</button></div>
        <div className="result-scroll">{project.casebook && <CaseResults project={project} t={t} disabled={blocked || gestureActive} onActivate={id => changeCase(activateCase(project, id))}/>}<ProjectResults result={result} selected={selected} onSelect={selectWeld} t={t}/></div>
      </section>}/>
      <footer className="status-bar">
        {error && !pending && <span className="status-error" role="alert">{t.error}: {error}</span>}
        {settingsWarning && <span role="alert">{t.settingsLoadError}</span>}
        {message && <span role="status">{message}</span>}
        {historical && <span title={t.snapshot}>{t.snapshot}</span>}
        <span className={dirty ? 'dirty-state' : ''}>{dirty ? t.dirty : t.ready}</span><span>{project.input.segments.length} {t.welds.toLowerCase()} · {t.units}</span>
      </footer>
    </div>
    {transformOpen && <GeometryTransformDialog segments={project.input.segments} t={t} describeError={describe} onCancel={() => setTransformOpen(false)} onApply={segments => {
      history.current.breakGroup(); edit({ ...current.current.project.input, segments }); selectWeld(0); setFormKey(k => k + 1); setResultsOpen(false); setTransformOpen(false);
    }}/>}
    {templateOpen && <GeometryTemplateDialog t={t} describeError={describe} onCancel={() => setTemplateOpen(false)} onApply={segments => {
      history.current.breakGroup(); edit({ ...current.current.project.input, segments }); selectWeld(0); setFormKey(k => k + 1); setResultsOpen(false); setTemplateOpen(false);
    }}/>}
    {settingsOpen && <SettingsDialog settings={settings} t={t} onCancel={() => setSettingsOpen(false)} onSave={async value => {
      setBusy(true); try { await backend.saveEditorSettings(value); setSettings(value); setSettingsWarning(false); setSettingsOpen(false); } finally { setBusy(false); }
    }}/>}
    {pending && <UnsavedDialog title={t.unsaved} description={t.unsavedDescription} save={t.saveContinue} discard={t.discard} cancel={t.cancel} busy={busy} error={error}
      onSave={() => continuePending(true)} onDiscard={() => continuePending(false)} onCancel={() => { setPending(null); setError(''); }}/>}
  </div>;
}
