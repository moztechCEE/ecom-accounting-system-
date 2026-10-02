/** Local synthetic preview only; not included by the production entrypoint. */
import { createServer } from 'vite';
if(process.env.MAILROOM_LOCAL_TEST!=='true')throw Error('Local fixture opt-in required');
process.env.VITE_MAILROOM_ENABLED='true';
const people={'fixture-mail':'行政收發','fixture-repair':'維修同仁','fixture-review':'客服覆核','fixture-person':'一般同仁'};
const server=await createServer({root:process.cwd(),plugins:[{name:'local-mailroom-fixture-login',transformIndexHtml:()=>[{tag:'script',children:"window.__APP_CONFIG__={apiUrl:'/api/v1',wsUrl:'http://127.0.0.1:57644',mailroomEnabled:true,defaultEntityId:'fixture-company'}",injectTo:'head-prepend'}],configureServer(server){server.middlewares.use((req,res,next)=>{
 if(!req.url?.startsWith('/_fixture'))return next();
 const user=new URL(req.url,'http://127.0.0.1').searchParams.get('user');
 res.setHeader('Content-Type','text/html; charset=utf-8');
 if(user&&Object.hasOwn(people,user)){res.end(`<script>localStorage.setItem('access_token',${JSON.stringify(user)});localStorage.setItem('entityId','fixture-company');location.href=${JSON.stringify(user==='fixture-mail'||user==='fixture-review'?'/operations/mailroom':user==='fixture-repair'?'/operations/repair':'/my/inbox')};</script>`);return;}
 res.end(`<html lang="zh-TW"><title>收發室本機示範</title><body style="font:18px system-ui;padding:60px;background:#f3f7f8"><h1>收發室與維修工作台</h1><p>本機測試資料，選擇角色查看。所有通知僅存在測試資料庫。</p><p>平板本人簽收示範：員編 <code>fixture-repair</code>，密碼 <code>FixturePass2026!</code>。僅供本機假資料測試。</p>${Object.entries(people).map(([id,name])=>`<p><a href="/_fixture?user=${id}">${name}</a></p>`).join('')}</body></html>`);
 });}}],server:{host:'127.0.0.1',port:57646,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:57644',changeOrigin:true,ws:false}}}});
await server.listen();console.log('Local workbench preview: http://127.0.0.1:57646/_fixture');
