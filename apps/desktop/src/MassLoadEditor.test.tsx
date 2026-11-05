import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {MassLoadEditor} from './MassLoadEditor';
import {backend} from './backend';
import type {AppliedForce,MassLoadResult} from './contracts';
import ru from './locales/ru.json';
vi.mock('./backend',()=>({backend:{deriveMassLoad:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const force:AppliedForce={id:'mass',title:'F1',force_n:[0,0,0],application:{kind:'centroid'}};
test('empty or nonpositive mass prevents force derivation',()=>{
 render(<MassLoadEditor force={force} disabled={false} t={ru} onApply={()=>{}} onManual={()=>{}}/>);fireEvent.click(screen.getByText('Нагрузка от массы'));
 for(const value of ['', '0','-10']){fireEvent.change(screen.getByLabelText('Масса, kg'),{target:{value}});expect((screen.getByRole('button',{name:'Рассчитать и применить силу'}) as HTMLButtonElement).disabled).toBe(true);}expect(backend.deriveMassLoad).not.toHaveBeenCalled();
});
test('late mass calculation cannot overwrite a force with an edited application point',async()=>{
 let finish!:(v:MassLoadResult)=>void;vi.mocked(backend.deriveMassLoad).mockReturnValue(new Promise(done=>{finish=done;}));const apply=vi.fn();const {rerender}=render(<MassLoadEditor force={force} disabled={false} t={ru} onApply={apply} onManual={()=>{}}/>);fireEvent.click(screen.getByText('Нагрузка от массы'));fireEvent.click(screen.getByRole('button',{name:'Рассчитать и применить силу'}));
 rerender(<MassLoadEditor force={{...force,application:{kind:'point',point_mm:[10,0,0]}}} disabled={false} t={ru} onApply={apply} onManual={()=>{}}/>);
 await act(async()=>finish({schema_version:1,model:{mass_kg:1,gravity_m_s2:[0,0,-9.80665],acceleration_m_s2:[0,0,0]},force_n:[0,0,-9.80665],method_id:'translating-mass-equivalent-load-v1'}));expect(apply).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toContain('Сила изменилась');
});
