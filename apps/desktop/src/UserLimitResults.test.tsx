import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {UserLimitResults} from './UserLimitResults';
import {backend} from './backend';
import {newProject,type LimitEvaluation,type Project} from './contracts';
import ru from './locales/ru.json';
vi.mock('./backend',()=>({backend:{evaluateUserLimits:vi.fn()}}));
afterEach(()=>{cleanup();vi.useRealTimers();vi.resetAllMocks();});
function project():Project{const p=newProject();p.user_limits={method_id:'independent-nominal-components-v1',tension:{value_mpa:1,source:'T'},compression:{value_mpa:10,source:'C'},shear:{value_mpa:5,source:'S'}};return p;}
function comparison(p:Project):LimitEvaluation{return {schema_version:1,limits:p.user_limits!,total:1,available:0,exceeded:0,status:'incomplete',maximum_ratio:null,governing:null,cases:[],strength_status:'unsupported_calculation',validation_status:'not_independently_validated'};}
test('invalid load drafts with another cached case never serialize requests or show a within-limits result',()=>{
 vi.useFakeTimers();const p=project();p.input.force_n[2]=NaN;p.casebook={schema_version:1,active_id:'a',cases:[{id:'a',title:'A',force_n:p.input.force_n,couple_n_mm:[0,0,0],application:{kind:'centroid'},last_calculation:null},{id:'b',title:'B',force_n:[0,0,600],couple_n_mm:[0,0,0],application:{kind:'centroid'},last_calculation:{} as NonNullable<Project['last_calculation']>}]};render(<UserLimitResults project={p} t={ru}/>);act(()=>vi.advanceTimersByTime(1000));expect(backend.evaluateUserLimits).not.toHaveBeenCalled();expect(screen.getByText(/Контроль неполон/)).toBeTruthy();expect(screen.queryByText(/В пределах пользовательских значений/)).toBeNull();
});
test('a response for older criteria cannot replace the comparison for the current project',async()=>{
 vi.useFakeTimers();let first!:(r:LimitEvaluation)=>void,second!:(r:LimitEvaluation)=>void;vi.mocked(backend.evaluateUserLimits).mockReturnValueOnce(new Promise(done=>{first=done;})).mockReturnValueOnce(new Promise(done=>{second=done;}));const old=project();old.last_calculation={} as NonNullable<Project['last_calculation']>;const {rerender}=render(<UserLimitResults project={old} t={ru}/>);await act(async()=>vi.advanceTimersByTime(250));const next={...old,user_limits:{...old.user_limits!,tension:{value_mpa:2,source:'New'}}};rerender(<UserLimitResults project={next} t={ru}/>);await act(async()=>{vi.advanceTimersByTime(250);first({...comparison(old),status:'within_user_limits'});});expect(screen.queryByText(/В пределах пользовательских значений/)).toBeNull();await act(async()=>second(comparison(next)));expect(screen.getByText(/Контроль неполон/)).toBeTruthy();
});
