import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { signRequest } from '../src/modules/mailroom/mailroom.contract';
import { requireLocalFixture } from './mailroom-local-fixture';
requireLocalFixture();
async function main(){const db=new PrismaClient();const base='http://127.0.0.1:57647';const path='/api/integration/mailroom/cases?search=DEMO';
 const headers=(method:string,path:string,body='')=>{const time=Math.floor(Date.now()/1000).toString();return{'content-type':'application/json','x-mailroom-key':'local-erp','x-mailroom-entity':'fixture-company','x-mailroom-time':time,'x-mailroom-signature':signRequest('mailroom-local-shared-secret-32-characters',method,path,time,body,'fixture-company')}};
 assert.equal((await fetch(base+path,{redirect:'manual'})).status,401);
 const result=await fetch(base+path,{headers:headers('GET',path)});assert.equal(result.status,200);assert.ok((await result.json()).items.some((x:any)=>x.id==='fixture-repair'));
 const event=await db.mailroomDelivery.findFirstOrThrow({where:{target:'AFTER_SALES',status:'DELIVERED'},orderBy:{createdAt:'asc'}});const events='/api/integration/mailroom/events';
 async function send(payload:unknown){const body=JSON.stringify(payload);return fetch(base+events,{method:'POST',headers:headers('POST',events,body),body})}
 const replay=await send(event.payload);assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);
 const outOfOrder=await send({...event.payload as object,eventId:randomUUID()});assert.equal(outOfOrder.status,409);
 const financial=await send({...event.payload as object,eventId:randomUUID(),refundExecuted:true});assert.equal(financial.status,400);
 assert.equal((await fetch(base+'/cases',{redirect:'manual'})).status,307);
 await db.$disconnect();console.log('PASS built Next.js proxy + signed route: anonymous rejected, scoped search, duplicate ACK, stale version rejected, financial payload rejected, employee page still protected');}
main().catch(error=>{console.error(error);process.exitCode=1});
