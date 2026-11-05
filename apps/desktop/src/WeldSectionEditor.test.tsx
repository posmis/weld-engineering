import { act,cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,test,vi } from 'vitest';
import { WeldSectionEditor } from './WeldSectionEditor';
import { backend } from './backend';
import { newProject,type SectionResult } from './contracts';
import ru from './locales/ru.json';
vi.mock('./backend',()=>({backend:{deriveSection:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
test('empty legs cannot reach the Rust boundary',()=>{
 render(<WeldSectionEditor segment={newProject().input.segments[0]} disabled={false} t={ru} onApply={()=>{}} onManual={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Катет k₁, mm'),{target:{value:''}});
 expect((screen.getByRole('button',{name:'Рассчитать и применить сечение'}) as HTMLButtonElement).disabled).toBe(true);expect(backend.deriveSection).not.toHaveBeenCalled();
});
test('a late section response cannot overwrite a weld edited while the calculation was pending',async()=>{
 let finish!:(v:SectionResult)=>void;vi.mocked(backend.deriveSection).mockReturnValue(new Promise(done=>{finish=done;}));
 const initial=newProject().input.segments[0],apply=vi.fn();const {rerender}=render(<WeldSectionEditor segment={initial} disabled={false} t={ru} onApply={apply} onManual={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Рассчитать и применить сечение'}));
 rerender(<WeldSectionEditor segment={{...initial,effective_width_mm:5}} disabled={false} t={ru} onApply={apply} onManual={()=>{}}/>);
 await act(async()=>{finish({schema_version:1,model:{kind:'idealized_right_angle_fillet',leg_1_mm:3,leg_2_mm:3},effective_width_mm:3/Math.sqrt(2),method_id:'right-angle-fillet-altitude-v1',status:'idealized_geometry'});});
 expect(apply).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toContain('Шов изменился');
});
