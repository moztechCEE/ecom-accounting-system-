import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationRefreshInterval, createVisibleRefresh } from '../src/services/notification-refresh.ts';
test('only exact operating workbench route families shorten the DB fallback',()=>{
  for(const path of ['/operations/after-sales/workbench','/operations/repair','/operations/mailroom','/my/inbox','/inventory/after-sales-stock'])assert.equal(notificationRefreshInterval(path),15000);
  for(const path of ['/dashboard','/finance','/operations/after-sales-other','/operations/repair-other'])assert.equal(notificationRefreshInterval(path),60000);
});
test('background refresh is silent; overlapping poll/focus/open cannot duplicate requests, and failure releases the gate',async()=>{
  let visible=false,calls=0,resolve!:()=>void;
  const work=createVisibleRefresh(()=>visible,async()=>{calls++;await new Promise<void>(r=>{resolve=r;});});
  assert.equal(await work(),false);assert.equal(calls,0);visible=true;const first=work();assert.equal(await work(),false);assert.equal(calls,1);resolve();assert.equal(await first,true);
  const next=work();assert.equal(calls,2);resolve();await next;
  let failures=0;const failing=createVisibleRefresh(()=>true,async()=>{failures++;throw new Error('synthetic');});await assert.rejects(failing());await assert.rejects(failing());assert.equal(failures,2);
});
