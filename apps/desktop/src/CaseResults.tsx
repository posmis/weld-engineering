import { useEffect, useState } from 'react';
import { backend } from './backend';
import type { CaseSummary, Project } from './contracts';
import type ru from './locales/ru.json';
export function CaseResults({ project, t, onActivate }: { project: Project; t: typeof ru; onActivate: (id: string) => void }) {
  const [summary, setSummary] = useState<{ project: Project; value: CaseSummary } | null>(null);
  const [failed, setFailed] = useState<Project | null>(null);
  useEffect(() => {
    let active = true;
    void backend.summarizeCases(project).then(value => { if (active) setSummary({ project, value }); }).catch(() => { if (active) setFailed(project); });
    return () => { active = false; };
  }, [project]);
  const value = summary?.project === project ? summary.value : null;
  const format = (n: number) => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 8 }).format(n);
  return <details className="case-results"><summary>{t.caseSummary} · {value ? `${value.computed}/${value.total} — ${value.complete ? t.completeCases : t.partialCases}` : failed === project ? t.error : '…'}</summary>
    <div className="case-result-list">{project.casebook?.cases.map(c => <button key={c.id} onClick={() => onActivate(c.id)}>{c.title} · {!c.last_calculation ? t.caseNotComputed : c.last_calculation.analysis_status === 'computed' ? t.caseComputed : t.caseUnsupported}</button>)}</div>
    {value && <dl className="metric-grid">{(['normal_min', 'normal_max', 'shear_max'] as const).map((key, i) => {
      const g = value[key]; return g && <div className="metric" key={key}><dt>{['σz min', 'σz max', '|τ| max'][i]}</dt><dd>{format(g.value_mpa)} <small>MPa</small></dd><button onClick={() => onActivate(g.case_id)}>{project.casebook?.cases.find(c => c.id === g.case_id)?.title} · S{g.segment_index + 1} · {g.endpoint === 'start' ? '1' : '2'}</button></div>;
    })}</dl>}
  </details>;
}
