import assert from 'node:assert/strict';
import test from 'node:test';
import { navigationLeaves, visibleNavigation, workspaceNavigation } from '../src/config/navigation.ts';
import { createRepairNavigationGate } from '../src/pages/repair/repair-navigation.ts';
import type { User } from '../src/types/index.ts';
Object.defineProperty(globalThis,'window',{value:{__APP_CONFIG__:{mailroomEnabled:true,afterSalesModuleEnabled:true}},configurable:true});
const user=(permissions:string[])=>({roles:['EMPLOYEE'],permissions}) as User;
const nativeLeaves=(permissions:string[])=>navigationLeaves(visibleNavigation(user(permissions))).filter(i=>i.key.startsWith('/operations/after-sales/')).map(i=>i.key);
test('source financial and master data modules require dedicated grants, not other ERP read scopes',()=>{
  assert.deepEqual(nativeLeaves(['accounts:read','inventory:read','sales_orders:read','access_control:read']),[]);
  for(const [permission,path] of [
    ['after_sales_shipping:read','shipping'],['after_sales_accounting:read','accounting'],['after_sales_invoices:read','invoices'],
    ['after_sales_products:read','products'],['after_sales_faqs:read','faqs'],['after_sales_imports:read','imports'],
    ['after_sales_users:read','users'],['after_sales_audit:read','audit-logs'],['after_sales_settings:read','settings'],
  ])assert.deepEqual(nativeLeaves([permission]),[`/operations/after-sales/${path}`]);
  assert(!navigationLeaves(visibleNavigation(user(['after_sales_audit:read']))).some(i=>i.key==='/admin/access-control'));
});
test('repair-only staff retain their native task and personal entries without source customer or accounting modules',()=>{
  const tech=user(['repair_workbench:read','repair_workbench:update','profile_self:read']);
  assert.deepEqual(navigationLeaves(workspaceNavigation(tech,'all')).map(i=>i.key),['/operations/repair','/my/inbox','/profile']);
});
test('cancelling draft navigation keeps draft and prevents destination; concurrent attempts ask once',async()=>{
  const dirty={current:true};let resolve!:(value:boolean)=>void;let asks=0;let leaves=0;
  const gate=createRepairNavigationGate(dirty,()=>{asks++;return new Promise<boolean>(answer=>{resolve=answer;});});
  gate(()=>{leaves++;});gate(()=>{leaves++;});assert.equal(asks,1);resolve(false);
  await new Promise<void>(answer=>setImmediate(answer));assert.equal(leaves,0);assert.equal(dirty.current,true);
  gate(()=>{leaves++;});resolve(true);await new Promise<void>(answer=>setImmediate(answer));
  assert.equal(leaves,1);assert.equal(dirty.current,false);gate(()=>{leaves++;});assert.equal(leaves,2);
});


test('dedicated replacement-stock read opens only that stock leaf without customer modules', () => {
  const user={roles:['EMPLOYEE'],permissions:['after_sales_stock:read']} as User;
  const leaves=navigationLeaves(visibleNavigation(user));
  assert(leaves.some(item=>item.key==='/inventory/after-sales-stock'));
  assert(!leaves.some(item=>item.key==='/inventory/products'));
  assert(!leaves.some(item=>item.key.startsWith('/operations/after-sales/')));
});
