import {afterEach,expect,test,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QuantityResults} from './QuantityResults';
import {backend} from './backend';
import {newProject,type QuantityRequest,type QuantityResult} from './contracts';
import ru from './locales/ru.json';
vi.mock('./backend',()=>({backend:{quantities:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
function value(source:QuantityRequest):QuantityResult{return {schema_version:1,method_id:'prismatic-right-triangle-quantities-v1',source,total_segments:1,known_segments:0,complete:false,known_volume_mm3:0,volume_mm3:null,mass_kg:null,density_kg_m3:null,density_source:null,segments:[{segment_index:0,length_mm:100,section_area_mm2:null,volume_mm3:null,mass_kg:null}]};}
function open(container:HTMLElement){const details=container.querySelector('details')!;act(()=>{details.open=true;fireEvent(details,new Event('toggle'));});}
test('unknown full volume and mass remain explicit rather than becoming the known subtotal zero',async()=>{vi.mocked(backend.quantities).mockImplementation(async r=>value(r));const {container}=render(<QuantityResults project={newProject()} t={ru}/>);open(container);await waitFor(()=>expect(screen.getByRole('table')).toBeTruthy());expect(screen.getAllByText(ru.quantityUnknown).length).toBeGreaterThanOrEqual(3);expect(screen.getByText(ru.quantityMissing,{exact:false})).toBeTruthy();expect(backend.quantities).toHaveBeenCalledTimes(1);});
test('a late quantity response cannot replace geometry changed during the request',async()=>{let resolve!:(v:QuantityResult)=>void;vi.mocked(backend.quantities).mockImplementation(()=>new Promise(r=>{resolve=r;}));const project=newProject();const {container,rerender}=render(<QuantityResults project={project} t={ru}/>);open(container);await waitFor(()=>expect(backend.quantities).toHaveBeenCalledTimes(1));const source=vi.mocked(backend.quantities).mock.calls[0][0];const next=structuredClone(project);next.input.segments[0].effective_width_mm=4;rerender(<QuantityResults project={next} t={ru}/>);await act(async()=>resolve(value(source)));expect(screen.queryByRole('table')).toBeNull();});
