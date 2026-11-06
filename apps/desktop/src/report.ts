import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fontLicense from './assets/OFL.txt?raw';
import {sameValue} from './projectHistory';
import type { CalculationResult, CaseSummary, Project, MaterialEvaluation, MaterialPropertyKind, LimitEvaluation, WidthStudyResult, QuantityResult } from './contracts';

/** Presentation only. All mechanical values and envelopes come from Rust snapshots. */
export async function createReport(project: Project, fontBytes: Uint8Array, summary: CaseSummary | null, date = new Date(), materials:MaterialEvaluation|null=null, limits:LimitEvaluation|null=null, study:WidthStudyResult|null=null, quantities:QuantityResult|null=null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  pdf.setTitle(project.title); pdf.setAuthor('Weld Engineering'); pdf.setSubject('Номинальные напряжения. Нормативная прочность не проверена.'); pdf.setCreationDate(date);
  const supported = new Set(font.getCharacterSet());
  const safe = (text: string) => Array.from(text.replaceAll('−', '-').replaceAll('→', '->')).map(c => supported.has(c.codePointAt(0)!) ? c : '?').join('');
  const number = (value: number) => new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 10 }).format(value);
  const vector = (values: number[]) => values.map(number).join(' / ');
  let page: PDFPage; let y = 0;
  function nextPage() { page = pdf.addPage([595.28, 841.89]); y = 793; }
  function room(height: number) { if (y - height < 48) nextPage(); }
  function line(text: string, size = 10, color = rgb(0.12, 0.18, 0.24)) {
    const words = safe(text).replace(/[\r\n\t]/g, ' ').split(' '); let pending = '';
    const write = (s: string) => { room(size + 7); page.drawText(s, { x: 42, y, font, size, color }); y -= size + 7; };
    for (const word of words) {
      if (font.widthOfTextAtSize(`${pending} ${word}`, size) > 510) { if (pending) write(pending); pending = ''; }
      for (const char of word) {
        if (font.widthOfTextAtSize(pending + char, size) > 510) { write(pending); pending = ''; }
        pending += char;
      }
      pending += ' ';
    }
    if (pending) write(pending.trimEnd());
  }
  function heading(text: string) { room(48); y -= 10; line(text, 13); }
  nextPage();
  line('WELD ENGINEERING', 18); line(project.title, 15); line(`Отчёт сформирован: ${date.toISOString()}`);
  line('Проверка прочности недоступна. Допускаемые напряжения и коэффициенты не назначены.', 10, rgb(0.65, 0.16, 0.12));
  line('Номинальная статическая линейная модель эффективного сечения. Катет, провар и нормативная геометрия автоматически не определяются.');
  line('Расчётное ядро не прошло независимую инженерную валидацию. computed означает только успешное выполнение математического расчёта.');
  line('Снимки результатов могут быть историческими. Импортированные данные требуют проверки; PDF не подтверждает их подлинность.');
  if(project.materials){
    if(materials&&(materials.schema_version!==1||!sameValue(JSON.parse(JSON.stringify(materials.selection)),JSON.parse(JSON.stringify(project.materials)))))throw new Error('Material evaluation does not match project');
    heading('Пользовательские материалы');line('Карточки custom: данные пользователя, не проверенная база ГОСТ. Нормативная прочность не оценена.');
    line(`Контекст: толщина ${number(project.materials.context.thickness_mm)} mm; температура ${number(project.materials.context.temperature_c)} °C.`);
    const names:Record<MaterialPropertyKind,string>={yield_strength:'Rp0.2',tensile_strength:'Rm',elastic_modulus:'E',density:'Плотность'};
    for(const role of ['base','weld'] as const){const card=project.materials[role];heading(role==='base'?'Основной металл':'Наплавленный металл');if(!card){line('Карточка не задана. Свойства неизвестны.');}else{
      line(`Обозначение: ${card.designation}; kind=custom.`);line(`Форма продукции: ${card.product_form??'неизвестно'}; состояние: ${card.condition??'неизвестно'}.`);
      for(const p of card.properties){line(`${names[p.kind]}=${number(p.value)} ${p.kind==='density'?'kg/m3':'MPa'}; толщина (${number(p.thickness_mm[0])}; ${number(p.thickness_mm[1])}] mm; температура [${number(p.temperature_c[0])}; ${number(p.temperature_c[1])}] °C.`);line(`Источник свойства: ${p.source}`);}
    }
    if(materials){for(const p of materials[role].properties)line(`Для контекста ${names[p.kind]}: ${p.value===null?'неизвестно':`${number(p.value)} ${p.unit}; пользовательские данные, не проверены`}.`);}else{line('Применимость свойств для контекста не вычислена.');}
    }
  }
  if(project.user_limits){
    if(limits&&(limits.schema_version!==1||limits.strength_status!=='unsupported_calculation'||!sameValue(limits.limits,project.user_limits)))throw new Error('User limit comparison does not match project');
    heading('Контроль пользовательских пределов');line('Независимые номинальные пороги. Не нормативная прочность; взаимодействие компонент, локальное горло и концентрации не проверены.');line(project.user_limits.method_id);
    const keys=['tension','compression','shear'] as const,names=['Растяжение','Сжатие','Срез'];for(let i=0;i<keys.length;i++){const p=project.user_limits[keys[i]];line(`${names[i]}: ${number(p.value_mpa)} MPa; источник: ${p.source}`);}
    if(limits){const status=(s:string)=>s==='within_user_limits'?'В пределах пользовательских значений':s==='exceeds_user_limits'?'Пользовательские пределы превышены':'Контроль неполон';line(`${status(limits.status)}; доступно ${limits.available}/${limits.total}, известных превышений ${limits.exceeded}.`);line(`Максимальное отношение спрос/порог: ${limits.maximum_ratio===null?'неизвестно':number(limits.maximum_ratio)}`);
      for(const c of limits.cases){line(`${c.title}: ${c.status==='unavailable'?`Недоступно (${c.reason})`:status(c.status)}`);for(let i=0;i<keys.length;i++){const q=c[keys[i]];if(q)line(`${names[i]}: ${number(q.demand_mpa)} / ${number(q.limit_mpa)} MPa = ${number(q.ratio)}; ${q.point?`S${q.point.segment_index+1}/${q.point.endpoint}`:'нулевой спрос'}`);}}
    }else{line('Сравнение пользовательских пределов не вычислено.');}
  }
  if(study){
    if(study.schema_version!==1||study.method_id!=='global-effective-width-study-v1'||!sameValue(JSON.parse(JSON.stringify(study.source_project)),JSON.parse(JSON.stringify(project))))throw new Error('Width study does not match source project');
    heading('Варианты размеров швов');line('Ручное сравнение номинальных моделей. Масштаб эффективной ширины и катетов, фиксированные координаты/нагрузки/условия материалов. Все случаи пересчитаны; нормативная прочность и пригодность не установлены. Площадь эффективного сечения не является объёмом или массой сварки.');line(study.method_id);
    for(const row of study.rows){const factor=row.factor>=1e8||row.factor<1e-5?row.factor.toExponential(5):number(row.factor);line(`Масштаб ${factor}: ${row.status}; A=${row.area_mm2===null?'неизвестно':number(row.area_mm2)} mm²; случаи ${row.summary?`${row.summary.computed}/${row.summary.total}`:'не рассчитаны'}`);if(row.summary){line(`σz min / max: ${row.summary.normal_min?number(row.summary.normal_min.value_mpa):'неизвестно'} / ${row.summary.normal_max?number(row.summary.normal_max.value_mpa):'неизвестно'} MPa; |τ| max: ${row.summary.shear_max?number(row.summary.shear_max.value_mpa):'неизвестно'} MPa`);}if(row.comparison)line(`Пользовательские пороги: ${row.comparison.status}; u max=${row.comparison.maximum_ratio===null?'неизвестно':number(row.comparison.maximum_ratio)}. Не нормативный pass.`);if(row.error)line(`Ошибка: ${row.error.code}`);for(const failure of row.failures)line(`Случай ${failure.case_id}: ${failure.error.code}`);}
  }
  if(quantities){
    if(quantities.schema_version!==1||quantities.method_id!=='prismatic-right-triangle-quantities-v1'||!sameValue(JSON.parse(JSON.stringify(quantities.source)),JSON.parse(JSON.stringify({schema_version:1,segments:project.input.segments,materials:project.materials??null}))))throw new Error('Quantities do not match source geometry/materials');
    heading('Объём и масса швов');line(quantities.method_id);line('V = 0.5*k1*k2*L; m [kg] = V [mm3]*1e-9*rho [kg/m3]. Идеализированные прямоугольные треугольные призмы, без усиления, провара, перекрытий и потерь. Не нормативная или закупочная масса. Эффективная площадь номинального расчёта не равна площади треугольника.');
    const qnumber=(n:number|null)=>n===null?'неизвестно':n!==0&&(Math.abs(n)<1e-5||Math.abs(n)>=1e8)?n.toExponential(6):number(n);
    line(`Сечения: ${quantities.known_segments}/${quantities.total_segments}; полный объём [mm3]: ${qnumber(quantities.volume_mm3)}; объём известных участков [mm3]: ${qnumber(quantities.known_volume_mm3)}`);line(`Полная геометрическая масса [kg]: ${qnumber(quantities.mass_kg)}; плотность наплавленного металла [kg/m3]: ${qnumber(quantities.density_kg_m3)}`);line(`Источник плотности: ${quantities.density_source??'неизвестно'}. Без применимой плотности масса неизвестна; основной металл не подставляется.`);
    for(const row of quantities.segments)line(`S${row.segment_index+1}: L=${qnumber(row.length_mm)} mm; площадь треугольника=${qnumber(row.section_area_mm2)} mm2; V=${qnumber(row.volume_mm3)} mm3; m=${qnumber(row.mass_kg)} kg`);
  }
  heading('Схема и общая геометрия');
  const points = project.input.segments.flatMap(s => [s.start_mm, s.end_mm]);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const extent = Math.max(maxX - minX, maxY - minY);
  if (Number.isFinite(extent) && extent > 0) {
    room(200); const scale = Math.min(470 / (maxX - minX || extent), 155 / (maxY - minY || extent));
    const map = (p: [number, number]) => ({ x: 60 + (p[0] - minX) * scale, y: y - 175 + (p[1] - minY) * scale });
    project.input.segments.forEach((segment, i) => {
      const start = map(segment.start_mm), end = map(segment.end_mm);
      page.drawLine({ start, end, thickness: 1.5, color: rgb(0.1, 0.36, 0.5) });
      page.drawText(`S${i + 1}`, { x: start.x + 3, y: start.y + 4, size: 8, font });
    }); y -= 195; line('XY · mm. Схема условная; ширина линии не изображает эффективную ширину a.');
  } else line('Геометрия вне диапазона графического представления; используйте координаты ниже.');
  line('Участок | X1 / Y1 → X2 / Y2 [mm] | эффективная ширина a [mm]');
  project.input.segments.forEach((s, i) => line(`S${i + 1} | ${vector(s.start_mm)} → ${vector(s.end_mm)} | ${number(s.effective_width_mm)}`));
  project.input.segments.forEach((s,i)=>{if(s.section){line(`S${i+1}: идеализированный угловой шов 90°; k1 / k2 [mm]: ${vector([s.section.leg_1_mm,s.section.leg_2_mm])}`);line(`Геометрическое горло a=${number(s.effective_width_mm)} mm; right-angle-fillet-altitude-v1. Без учёта провара/вогнутости; соответствие ГОСТ не проверено.`);}});
  const cases = project.casebook?.cases ?? [{ combination:undefined, id: 'single', title: 'LC1', ...project.input, last_calculation: project.last_calculation }];
  for (const c of cases) {
    heading(`Нагрузочный случай: ${c.title}`);
    if(c.combination){line(`Пользовательское сочетание: ${c.combination.method_id}`);line("Снимок исходных нагрузок; коэффициенты не назначены по нормам.");for(const source of c.combination.sources){line(`${source.title} [${source.case_id}]: коэффициент ${String(source.factor)}`);line(`Исходный свободный M [N·mm]: ${vector(source.load.couple_n_mm)}`);for(const f of source.load.forces??[{title:"F1",force_n:source.load.force_n,application:source.load.application,inertia:undefined}]){line(`Источник ${f.title} [N]: ${vector(f.force_n)}`);line(f.application.kind==='centroid'?'P: центр сечения.':`P [mm]: ${vector(f.application.point_mm)}`);if(f.inertia)line(`Источник массы m=${String(f.inertia.mass_kg)} kg; g [m/s²]: ${vector(f.inertia.gravity_m_s2)}; a [m/s²]: ${vector(f.inertia.acceleration_m_s2)}`);}}}
    if (c.forces) {
      line(`Одновременно действующие силы: ${c.forces.length}`);
      for (const f of c.forces) { line(`${f.title} [N]: ${vector(f.force_n)}`); if(f.inertia){line(`Нагрузка от массы m=${String(f.inertia.mass_kg)} kg; F = m*(g - a).`);line(`g [m/s²]: ${vector(f.inertia.gravity_m_s2)}; a [m/s²]: ${vector(f.inertia.acceleration_m_s2)}`);line("translating-mass-equivalent-load-v1; без вращательной инерции и динамических коэффициентов.");} line(f.application.kind === 'centroid' ? 'Точка: центр эффективного сечения.' : `P [mm]: ${vector(f.application.point_mm)}`); }
      line(`Свободный M [N·mm]: ${vector(c.couple_n_mm)}`);
    } else {
    line(`F [N]: ${vector(c.force_n)}; свободный M [N·mm]: ${vector(c.couple_n_mm)}`);
    line(c.application.kind === 'centroid' ? 'Сила приложена в центре эффективного сечения.' : `Точка приложения P [mm]: ${vector(c.application.point_mm)}`);
    }
    const r: CalculationResult | null = c.last_calculation;
    if (!r) { line('НЕ РАССЧИТАН. Напряжения отсутствуют.'); continue; }
    line(`Engine ${r.engine_version}; schema ${r.schema_version}; метод ${r.method_id}`);
    line(`analysis_status=${r.analysis_status}; strength_status=${r.strength_status}; validation_status=${r.validation_status}`);
    const g = r.geometry;
    line(`L=${number(g.length_mm)} mm; A=${number(g.area_mm2)} mm²; центр X/Y=${vector(g.centroid_mm)} mm`);
    line(`Ix / Iy / Ixy / J [mm⁴]: ${vector([g.ix_mm4, g.iy_mm4, g.ixy_mm4, g.polar_mm4])}`);
    if (r.resultant_force_n) line(`Суммарная сила ΣF [N]: ${vector(r.resultant_force_n)}`);
    line(`Результирующий момент в центре [N·mm]: ${vector(r.moment_at_centroid_n_mm)}`);
    if (r.analysis_status !== 'computed') line('НАГРУЖЕНИЕ НЕ ПОДДЕРЖИВАЕТСЯ. Напряжения не выдаются.');
    if (r.traction_mpa) {
      line(`Равномерные τx / τy / σz [MPa]: ${vector(r.traction_mpa)}`);
      line('Метод: t = F/A. Подстановка компонентов:');
      r.traction_mpa.forEach((value, i) => line(`${['τx', 'τy', 'σz'][i]} = (${number((r.resultant_force_n ?? r.input_snapshot.force_n)[i])} N) / (${number(g.area_mm2)} mm²) = ${number(value)} MPa`));
    }
    if (r.distribution) {
      line('Метод в координатах относительно центра: τx=Fx/A−Mz·y/J; τy=Fy/A+Mz·x/J; σz=Fz/A+bx·x+by·y.');
      line('Коэффициенты изгиба: Iy·bx+Ixy·by=−My; Ixy·bx+Ix·by=Mx.');
      line(`Подстановка: (${number(g.iy_mm4)})·bx+(${number(g.ixy_mm4)})·by=−(${number(r.moment_at_centroid_n_mm[1])}); (${number(g.ixy_mm4)})·bx+(${number(g.ix_mm4)})·by=(${number(r.moment_at_centroid_n_mm[0])}). Единицы: mm⁴ и N·mm.`);
      line(`σz min / max [MPa]: ${vector(r.distribution.normal_range_mpa)}; |τ| max=${number(r.distribution.max_shear_mpa)} MPa`);
      line(`Контроль равновесия=${number(r.distribution.equilibrium_error)}; rcond изгиба=${r.distribution.bending_rcond === null ? 'не применимо' : number(r.distribution.bending_rcond)}`);
      room(55); line('Участок / конец | τx / τy / σz [MPa]');
      r.distribution.segments.forEach((s, i) => { line(`S${i + 1} / 1 | ${vector(s.start_mpa)}`); line(`S${i + 1} / 2 | ${vector(s.end_mpa)}`); });
    }
    if (r.warnings.length) line(`Предупреждения ядра: ${r.warnings.join(', ')}`);
  }
  if (summary) {
    heading(`Сводка независимых случаев: ${summary.computed}/${summary.total}`);
    line(summary.complete ? 'Все случаи рассчитаны.' : 'НЕПОЛНАЯ СВОДКА. Есть нерассчитанные или неподдерживаемые случаи.');
    for (const [key, name] of [['normal_min', 'σz min'], ['normal_max', 'σz max'], ['shear_max', '|τ| max']] as const) {
      const g = summary[key]; if (g) line(`${name}=${number(g.value_mpa)} MPa; случай ${cases.find(c => c.id === g.case_id)?.title ?? g.case_id}; S${g.segment_index + 1}; конец ${g.endpoint === 'start' ? '1' : '2'}`);
    }
    line('Список случаев не задаёт автоматические нормативные сочетания или усталостный спектр. Проверка прочности не выполнялась.');
  }
  heading('Исходный документ и ограничения');
  line('К PDF прикреплён weld-project.json: исходные данные и сохранённые снимки. Откройте вложение в PDF-просмотрщике с поддержкой вложений и импортируйте JSON в Weld Engineering.');
  line('Номинальные компоненты относятся к общей плоскости XY, нормаль Z. Они не являются локальными напряжениями горла шва или нормативным эквивалентным напряжением.');
  line('Вывод и границы математической модели: https://github.com/posmis/weld-engineering/blob/main/docs/nominal-bending-torsion.md');
  line('Подпись и проверка инженера: __________________________________');
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`Weld Engineering | ${i + 1} / ${pages.length} | Прочность не проверена`, { x: 42, y: 24, font, size: 8, color: rgb(0.4, 0.4, 0.4) }));
  if(quantities){await pdf.attach(new TextEncoder().encode(JSON.stringify(quantities,null,2)),'weld-quantities.json',{mimeType:'application/json',description:'Idealized triangular volume and user-density mass; missing values remain unknown'});}
  if(study){await pdf.attach(new TextEncoder().encode(JSON.stringify(study,null,2)),'width-study.json',{mimeType:'application/json',description:'Source project and explicit width variants; no normative sizing'});}
  if(project.user_limits&&limits){await pdf.attach(new TextEncoder().encode(JSON.stringify(limits,null,2)),'user-limit-comparison.json',{mimeType:'application/json',description:'Independent user thresholds, not normative strength acceptance'});}
  await pdf.attach(new TextEncoder().encode(JSON.stringify(project, null, 2)), 'weld-project.json', { mimeType: 'application/json', description: 'Project inputs and original result snapshots', creationDate: date });
  await pdf.attach(new TextEncoder().encode(fontLicense), 'NotoSans-OFL.txt', { mimeType: 'text/plain', description: 'SIL Open Font License for the embedded Noto Sans font' });
  return pdf.save();
}
