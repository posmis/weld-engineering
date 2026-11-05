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
