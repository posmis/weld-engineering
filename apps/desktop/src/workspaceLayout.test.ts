import { beforeEach, expect, test, vi } from 'vitest';
import { defaultWorkspaceLayout, readWorkspaceLayout, saveWorkspaceLayout, workspaceLayoutKey } from './workspaceLayout';
beforeEach(()=>localStorage.clear());
test('valid workspace preferences roundtrip independently of project storage',()=>{
  expect(readWorkspaceLayout()).toEqual({layout:defaultWorkspaceLayout,failed:false});
  const layout={...defaultWorkspaceLayout,tree_width_px:320,properties_width_px:360,results_height_px:480};
  expect(saveWorkspaceLayout(layout)).toBe(true);expect(readWorkspaceLayout()).toEqual({layout,failed:false});
});
test('unknown schemas, nonnumeric sizes and unsafe bounds use defaults without overwriting the saved value',()=>{
  for(const value of [{...defaultWorkspaceLayout,schema_version:2},{...defaultWorkspaceLayout,tree_width_px:0},{...defaultWorkspaceLayout,properties_width_px:'280'},{...defaultWorkspaceLayout,results_height_px:1e30},{...defaultWorkspaceLayout,extra:true}]) {
    const raw=JSON.stringify(value);localStorage.setItem(workspaceLayoutKey,raw);
    expect(readWorkspaceLayout()).toEqual({layout:defaultWorkspaceLayout,failed:true});expect(localStorage.getItem(workspaceLayoutKey)).toBe(raw);
  }
});
test('unavailable storage is reported without preventing the workspace from opening',()=>{
  const read=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('blocked');});
  try {expect(readWorkspaceLayout()).toEqual({layout:defaultWorkspaceLayout,failed:true});} finally {read.mockRestore();}
  const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
  try {expect(saveWorkspaceLayout(defaultWorkspaceLayout)).toBe(false);} finally {write.mockRestore();}
});
