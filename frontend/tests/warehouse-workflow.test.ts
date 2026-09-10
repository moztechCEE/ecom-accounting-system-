import assert from 'node:assert/strict'
import test from 'node:test'
import { createSimulation } from './wms-simulator.ts'
test('synthetic picking to packing completes without claiming carrier handoff',()=>{
  const s=createSimulation(), id='wms-fixture-1'
  let revision=1, n=0
  const cmd=(role:'picker'|'packer',stage:string,kind:string,scanValue?:string)=>{const r=s.command(id,role,stage,kind,{expectedRevision:revision,requestId:String(++n),scanValue});revision=r.revision;return r}
  cmd('picker','pick','claim')
  cmd('picker','pick','scan','TEST-SN-0001')
  cmd('picker','pick','scan','TEST-CABLE')
  assert.equal(cmd('picker','pick','scan','TEST-CABLE').state,'picked')
  cmd('packer','pack','claim')
  cmd('packer','pack','scan','TEST-SN-0001')
  cmd('packer','pack','scan','TEST-CABLE')
  const complete=cmd('packer','pack','scan','TEST-CABLE')
  assert.equal(complete.state,'completed');assert.equal(complete.packed,3)
  assert.equal(complete.logisticsLabel,'尚無物流紀錄');assert.equal(complete.receiptLabel,'尚未確認')
})
test('simulation rejects wrong stage, ownership, blockers, stale revision and duplicate SN',()=>{
  const s=createSimulation(),id='wms-fixture-1'
  assert.throws(()=>s.detail('wms-fixture-7','picker'))
  assert.throws(()=>s.command(id,'dispatcher','pick','claim',{expectedRevision:1,requestId:'x'}))
  assert.throws(()=>s.command('wms-fixture-8','packer','pack','claim',{expectedRevision:1,requestId:'x'}))
  s.command(id,'picker','pick','claim',{expectedRevision:1,requestId:'1'})
  assert.throws(()=>s.command(id,'picker','pick','scan',{expectedRevision:1,requestId:'2',scanValue:'TEST-CABLE'}))
  assert.throws(()=>s.command(id,'picker','pick','scan',{expectedRevision:2,requestId:'3',scanValue:'TEST-DEVICE'}))
  s.command(id,'picker','pick','scan',{expectedRevision:2,requestId:'4',scanValue:'TEST-SN-0001'})
  assert.throws(()=>s.command(id,'picker','pick','scan',{expectedRevision:3,requestId:'5',scanValue:'TEST-SN-0001'}))
  assert.equal(s.detail(id,'picker').picked,1)
})
test('simulation replays one request and rejects reusing its key for another scan',()=>{
  const s=createSimulation(),id='wms-fixture-1',body={expectedRevision:1,requestId:'one'}
  const first=s.command(id,'picker','pick','claim',body)
  assert.deepEqual(s.command(id,'picker','pick','claim',body),first)
  assert.equal(s.detail(id,'picker').revision,2)
  assert.throws(()=>s.command(id,'picker','pick','scan',{...body,scanValue:'TEST-CABLE'}))
})
