import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {UserLimitsDialog} from './UserLimitsDialog';
import {backend} from './backend';
import type {UserLimits} from './contracts';
import ru from './locales/ru.json';
vi.mock('./backend',()=>({backend:{validateUserLimits:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const limits:UserLimits={method_id:'independent-nominal-components-v1',tension:{value_mpa:1,source:'User T'},compression:{value_mpa:10,source:'User C'},shear:{value_mpa:5,source:'User S'}};
test('limits have no material-derived defaults and require positive values and explicit sources',()=>{
 render(<UserLimitsDialog t={ru} describeError={()=>'Ошибка'} onApply={()=>{}} onCancel={()=>{}}/>);expect((screen.getByLabelText('Растяжение, MPa') as HTMLInputElement).value).toBe('');expect((screen.getByRole('button',{name:'Применить пределы'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.change(screen.getByLabelText('Растяжение, MPa'),{target:{value:'0'}});expect((screen.getByRole('button',{name:'Применить пределы'}) as HTMLButtonElement).disabled).toBe(true);expect(backend.validateUserLimits).not.toHaveBeenCalled();
});
test('a late validation cannot overwrite externally changed limits or a closed dialog',async()=>{
 let finish!:(v:UserLimits)=>void;vi.mocked(backend.validateUserLimits).mockReturnValue(new Promise(done=>{finish=done;}));const apply=vi.fn(),props={t:ru,describeError:()=> 'Ошибка',onApply:apply,onCancel:()=>{}};const {rerender,unmount}=render(<UserLimitsDialog {...props} limits={limits}/>);fireEvent.click(screen.getByRole('button',{name:'Применить пределы'}));rerender(<UserLimitsDialog {...props} limits={{...limits,tension:{value_mpa:2,source:'Changed'}}}/>);await act(async()=>finish(limits));expect(apply).not.toHaveBeenCalled();unmount();
});
