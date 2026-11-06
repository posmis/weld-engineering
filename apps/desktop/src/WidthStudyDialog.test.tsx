import {afterEach,expect,test,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {WidthStudyDialog} from './WidthStudyDialog';
import {backend} from './backend';
import {newProject,type WidthStudyRequest,type WidthStudyResult} from './contracts';
import ru from './locales/ru.json';
vi.mock('./backend',()=>({backend:{widthStudy:vi.fn(),applyWidthScale:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
function response(r:WidthStudyRequest):WidthStudyResult{return {schema_version:1,method_id:'global-effective-width-study-v1',source_project:r.project,rows:r.factors.map((factor,i)=>({factor,status:i===2?'failed':'complete',area_mm2:i===2?null:200*factor,summary:null,comparison:null,failures:[],error:i===2?{code:'numerical_range',field:'width_scale'}:null}))};}
function mount(){const onApply=vi.fn(),onCancel=vi.fn();const rendered=render(<WidthStudyDialog project={newProject()} t={ru} describeError={e=>(e as {code:string}).code} onApply={onApply} onCancel={onCancel} onReport={vi.fn()}/>);return {...rendered,onApply,onCancel};}
test('empty candidates cannot reach Rust, failed rows remain visible and applying requires explicit selection',async()=>{
 vi.mocked(backend.widthStudy).mockImplementation(async r=>response(r));vi.mocked(backend.applyWidthScale).mockResolvedValue(newProject());const {onApply}=mount();
 fireEvent.click(screen.getByText(ru.addStudyCandidate));expect((screen.getByText(ru.runWidthStudy) as HTMLButtonElement).disabled).toBe(true);expect(backend.widthStudy).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText(`${ru.studyFactor} 2`),{target:{value:'2'}});fireEvent.click(screen.getByText(ru.addStudyCandidate));fireEvent.change(screen.getByLabelText(`${ru.studyFactor} 3`),{target:{value:'1e308'}});
 await act(async()=>fireEvent.click(screen.getByText(ru.runWidthStudy)));expect(screen.getByText('numerical_range')).toBeTruthy();expect((screen.getByLabelText(`${ru.studySelect} 3`) as HTMLInputElement).disabled).toBe(true);expect((screen.getByText(ru.applyWidthCandidate) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByLabelText(`${ru.studySelect} 2`));await act(async()=>fireEvent.click(screen.getByText(ru.applyWidthCandidate)));expect(backend.applyWidthScale).toHaveBeenCalledWith({schema_version:1,project:newProject(),factor:2});expect(onApply).toHaveBeenCalledTimes(1);
});
test('late study response after project replacement cannot enable applying an obsolete result',async()=>{
 let resolve!:(r:WidthStudyResult)=>void;vi.mocked(backend.widthStudy).mockImplementation(()=>new Promise(r=>{resolve=r;}));const props={t:ru,describeError:String,onApply:vi.fn(),onCancel:vi.fn(),onReport:vi.fn()};const source=newProject();const {rerender}=render(<WidthStudyDialog {...props} project={source}/>);fireEvent.click(screen.getByText(ru.runWidthStudy));rerender(<WidthStudyDialog {...props} project={{...source,title:'Changed'}}/>);await act(async()=>resolve(response({schema_version:1,project:source,factors:[1]})));expect(screen.queryByRole('table')).toBeNull();expect((screen.getByText(ru.applyWidthCandidate) as HTMLButtonElement).disabled).toBe(true);
});
test('editing a factor invalidates a selected result and its PDF export',async()=>{
 vi.mocked(backend.widthStudy).mockImplementation(async r=>response(r));mount();await act(async()=>fireEvent.click(screen.getByText(ru.runWidthStudy)));fireEvent.click(screen.getByLabelText(`${ru.studySelect} 1`));fireEvent.change(screen.getByLabelText(`${ru.studyFactor} 1`),{target:{value:'2'}});expect(screen.queryByRole('table')).toBeNull();expect((screen.getByText(ru.studyPdf) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByText(ru.applyWidthCandidate) as HTMLButtonElement).disabled).toBe(true);
});
