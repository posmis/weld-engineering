import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {CombinationDialog} from './CombinationDialog';
import {backend} from './backend';
import {newProject,type Project} from './contracts';
import {addCase} from './loadCases';
import ru from './locales/ru.json';
vi.mock('./backend',()=>({backend:{combineCases:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
function project(){return addCase(newProject(),'LC2');}
test('empty and all-zero coefficients cannot reach Rust',()=>{
 render(<CombinationDialog project={project()} t={ru} describeError={()=>'Ошибка'} onApply={()=>{}} onCancel={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Коэффициент LC1'),{target:{value:''}});expect((screen.getByRole('button',{name:'Создать сочетание'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Коэффициент LC1'),{target:{value:'0'}});fireEvent.change(screen.getByLabelText('Коэффициент LC2'),{target:{value:'0'}});expect((screen.getByRole('button',{name:'Создать сочетание'}) as HTMLButtonElement).disabled).toBe(true);expect(backend.combineCases).not.toHaveBeenCalled();
});
test('changed project cancels a late combination response without replacing current input',async()=>{
 let finish!:(p:Project)=>void;vi.mocked(backend.combineCases).mockReturnValue(new Promise(done=>{finish=done;}));const p=project(),apply=vi.fn();const props={project:p,t:ru,describeError:()=> 'Проект изменился',onApply:apply,onCancel:()=>{}};const {rerender}=render(<CombinationDialog {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Создать сочетание'}));
 expect(vi.mocked(backend.combineCases).mock.calls[0][0].terms.map(t=>t.factor)).toEqual([1,1]);rerender(<CombinationDialog {...props} project={{...p,title:'Changed'}}/>);await act(async()=>finish(newProject()));expect(apply).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toContain('Проект изменился');
});
test('closing the dialog prevents a pending response from applying',async()=>{
 let finish!:(p:Project)=>void;vi.mocked(backend.combineCases).mockReturnValue(new Promise(done=>{finish=done;}));const apply=vi.fn(),cancel=vi.fn();const {unmount}=render(<CombinationDialog project={project()} t={ru} describeError={()=>'Ошибка'} onApply={apply} onCancel={cancel}/>);fireEvent.click(screen.getByRole('button',{name:'Создать сочетание'}));fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(cancel).toHaveBeenCalledOnce();unmount();await act(async()=>finish(newProject()));expect(apply).not.toHaveBeenCalled();
});

function frozenProject(){const p=project(),sources=p.casebook!.cases.map((c,i)=>({case_id:c.id,title:c.title,factor:[1.25,-0.5][i],load:{force_n:c.force_n,couple_n_mm:c.couple_n_mm,application:c.application}}));const forces=sources.map((s,i)=>({id:`c${i+1}-f1`,title:`[${s.title}] F1`,force_n:[0,0,[750,-300][i]] as [number,number,number],application:s.load.application}));const c={id:'combo',title:'Saved combination',forces,force_n:[0,0,0] as [number,number,number],couple_n_mm:[0,0,0] as [number,number,number],application:{kind:'centroid' as const},last_calculation:null,combination:{method_id:'user-linear-load-combination-v1' as const,sources}};p.casebook={schema_version:1,active_id:c.id,cases:[c]};p.input={...p.input,forces,force_n:c.force_n,application:c.application};return p;}
test('editing lists frozen sources even after live cases were deleted and submits the existing target ID',async()=>{
 const p=frozenProject(),apply=vi.fn();vi.mocked(backend.combineCases).mockResolvedValue(p);render(<CombinationDialog project={p} editCaseId="combo" t={ru} describeError={()=>'Ошибка'} onApply={apply} onCancel={()=>{}}/>);
 expect((screen.getByLabelText('Название сочетания') as HTMLInputElement).value).toBe('Saved combination');expect((screen.getByLabelText('Коэффициент LC1') as HTMLInputElement).value).toBe('1.25');expect((screen.getByLabelText('Коэффициент LC2') as HTMLInputElement).value).toBe('-0.5');
 fireEvent.change(screen.getByLabelText('Коэффициент LC1'),{target:{value:'2'}});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Применить коэффициенты'}));});const request=vi.mocked(backend.combineCases).mock.calls[0][0];expect(request.replace_case_id).toBe('combo');expect(request.terms.map(t=>t.factor)).toEqual([2,-0.5]);expect(apply).toHaveBeenCalledWith(p);
});
test('an edit response cannot silently append a case or change its ID',async()=>{
 const p=frozenProject(),wrong=structuredClone(p);wrong.casebook!.active_id='other';wrong.casebook!.cases[0].id='other';vi.mocked(backend.combineCases).mockResolvedValue(wrong);const apply=vi.fn();render(<CombinationDialog project={p} editCaseId="combo" t={ru} describeError={()=>'Неверный ответ'} onApply={apply} onCancel={()=>{}}/>);await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Применить коэффициенты'}));});expect(apply).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toContain('Неверный ответ');
});
