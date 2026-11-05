import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {MaterialDialog,materialKinds} from './MaterialDialog';
import {backend} from './backend';
import type {MaterialEvaluation,MaterialSelection} from './contracts';
import ru from './locales/ru.json';
vi.mock('./backend',()=>({backend:{evaluateMaterials:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
function resolved(selection:MaterialSelection):MaterialEvaluation{const unknown=()=>({designation:null,properties:materialKinds.map(kind=>({kind,unit:kind==='density'?'kg/m3':'MPa',value:null,source:null,status:'unknown' as const}))});return {schema_version:1,selection,base:unknown(),weld:unknown()};}
function selection():MaterialSelection{return {context:{thickness_mm:10,temperature_c:20},base:{kind:'custom',designation:'Synthetic base',product_form:null,condition:null,properties:[{kind:'yield_strength',value:300,thickness_mm:[0,20],temperature_c:[20,20],source:'User M-001'}]},weld:null};}
test('unknown materials require explicit context and are never sent as default numeric zero',async()=>{
 vi.mocked(backend.evaluateMaterials).mockImplementation(async r=>resolved(r.selection));const apply=vi.fn();render(<MaterialDialog t={ru} describeError={()=>'Ошибка'} onApply={apply} onCancel={()=>{}}/>);
 expect((screen.getByRole('button',{name:'Проверить применимость'}) as HTMLButtonElement).disabled).toBe(true);expect(backend.evaluateMaterials).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('Расчётная толщина, mm'),{target:{value:'10'}});fireEvent.change(screen.getByLabelText('Температура, °C'),{target:{value:'20'}});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Проверить применимость'}));});expect(screen.getAllByText('Неизвестно').length).toBeGreaterThan(0);fireEvent.click(screen.getByRole('button',{name:'Применить материалы'}));expect(apply.mock.calls[0][0]).toEqual({context:{thickness_mm:10,temperature_c:20},base:null,weld:null});
});
test('editing context invalidates the checked properties until Rust evaluates the new context',async()=>{
 vi.mocked(backend.evaluateMaterials).mockImplementation(async r=>resolved(r.selection));render(<MaterialDialog selection={selection()} t={ru} describeError={()=>'Ошибка'} onApply={()=>{}} onCancel={()=>{}}/>);await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Проверить применимость'}));});expect((screen.getByRole('button',{name:'Применить материалы'}) as HTMLButtonElement).disabled).toBe(false);
 fireEvent.change(screen.getByLabelText('Расчётная толщина, mm'),{target:{value:'21'}});expect((screen.getByRole('button',{name:'Применить материалы'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.queryByRole('region',{name:'Применимые свойства'})).toBeNull();await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Проверить применимость'}));});expect(vi.mocked(backend.evaluateMaterials).mock.calls[1][0].selection.context.thickness_mm).toBe(21);
});
test('a late response for an externally changed assignment cannot enable Apply',async()=>{
 let finish!:(v:MaterialEvaluation)=>void;vi.mocked(backend.evaluateMaterials).mockReturnValue(new Promise(done=>{finish=done;}));const first=selection(),apply=vi.fn(),props={t:ru,describeError:()=> 'Ошибка',onApply:apply,onCancel:()=>{}};const {rerender}=render(<MaterialDialog {...props} selection={first}/>);fireEvent.click(screen.getByRole('button',{name:'Проверить применимость'}));rerender(<MaterialDialog {...props} selection={{...first,context:{thickness_mm:21,temperature_c:20}}}/>);await act(async()=>finish(resolved(first)));expect((screen.getByRole('button',{name:'Применить материалы'}) as HTMLButtonElement).disabled).toBe(true);expect(apply).not.toHaveBeenCalled();
});
