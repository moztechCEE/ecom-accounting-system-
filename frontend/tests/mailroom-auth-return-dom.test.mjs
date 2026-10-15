import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const require=createRequire(import.meta.url),{chromium}=require('../../backend/node_modules/playwright');
const executablePath=[chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
const root=fileURLToPath(new URL('../',import.meta.url));
const itemId='11111111-2222-4333-8444-555555555555';
const target='/operations/repair?entityId=company-a&itemId='+itemId+'&queue=all';
const fixture=`
import React from 'react';import {createRoot} from 'react-dom/client';import {createBrowserRouter,RouterProvider,useLocation} from 'react-router-dom';
import {AuthProvider} from '/src/contexts/AuthContext.tsx';import ProtectedRoute from '/src/components/ProtectedRoute.tsx';import LoginPage from '/src/pages/LoginPage.tsx';import ForcePasswordChangePage from '/src/pages/ForcePasswordChangePage.tsx';import api from '/src/services/api.ts';
window.__APP_CONFIG__={mailroomEnabled:true,defaultEntityId:'company-a'};
sessionStorage.setItem('fixtureLoads',String(Number(sessionStorage.getItem('fixtureLoads')||0)+1));
api.defaults.adapter=async config=>{const error=new Error('SYNTHETIC 401');error.response={status:401,data:{},headers:{},config};throw error;};
window.authFixture={trigger401:()=>api.get('/synthetic-expired').catch(()=>null),trace:()=>JSON.parse(sessionStorage.getItem('authTrace')||'[]'),loads:()=>Number(sessionStorage.getItem('fixtureLoads'))};
function ItemScreen(){const location=useLocation();return React.createElement('main',null,React.createElement('h2',null,'同件工作台'),React.createElement('output',{'data-testid':'current-path'},location.pathname+location.search));}
const router=createBrowserRouter([{path:'/login',element:React.createElement(LoginPage)},{element:React.createElement(ProtectedRoute),children:[{path:'/auth/change-password',element:React.createElement(ForcePasswordChangePage)},...['/operations/repair','/operations/mailroom','/dashboard'].map(path=>({path,element:React.createElement(ItemScreen)}))]}]);
createRoot(document.getElementById('root')).render(React.createElement(AuthProvider,null,React.createElement(RouterProvider,{router})));
`;
const authContext=`
import React,{createContext,useContext,useState} from 'react';
const Context=createContext(null);const record=event=>{const all=JSON.parse(sessionStorage.getItem('authTrace')||'[]');all.push(event);sessionStorage.setItem('authTrace',JSON.stringify(all));};
const currentUser=()=>({id:'fixture-user',name:'合成收發人員',roles:['MAILROOM_CLERK'],permissions:['mailroom:read'],mustChangePassword:sessionStorage.getItem('fixtureMode')==='mustchange'&&sessionStorage.getItem('passwordChanged')!=='1'});
export function AuthProvider({children}){const [user,setUser]=useState(()=>localStorage.getItem('access_token')?currentUser():null);const value={user,loading:false,
login:async values=>{record({action:'login',entityId:values.entityId});localStorage.setItem('entityId',values.entityId||'company-a');localStorage.setItem('access_token','SYNTHETIC-ONLY');const next=currentUser();setUser(next);return next;},
refreshCurrentUser:async()=>{record({action:'refresh'});const next=currentUser();setUser(next);return next;},
logout:async()=>{record({action:'logout'});localStorage.removeItem('access_token');setUser(null);return true;}};return React.createElement(Context.Provider,{value},children);}
export const useAuth=()=>useContext(Context);
`;
const authService=`
const record=event=>{const all=JSON.parse(sessionStorage.getItem('authTrace')||'[]');all.push(event);sessionStorage.setItem('authTrace',JSON.stringify(all));};
export const authService={getLoginEntities:async()=>[{id:'company-a',loginCode:'QA-A'},{id:'company-b',loginCode:'QA-B'}],changePassword:async values=>{record({action:'changePassword',fields:Object.keys(values).sort()});sessionStorage.setItem('passwordChanged','1');},requestPasswordReset:async()=>{throw Error('Reset notification is never allowed');}};
`;

test('real protected/login/change-password routes preserve only a safe native-item return target', {timeout:120000,skip:!executablePath&&'No existing browser; never installs one'},async t=>{
  const cacheDir=mkdtempSync(join(tmpdir(),'corely-auth-return-')),virtual='\0mailroom-auth-return';
  const server=await createServer({root,cacheDir,configFile:false,server:{host:'127.0.0.1',port:0,hmr:false},plugins:[react(),{name:'offline-real-auth-return',resolveId(id){if(id==='virtual:mailroom-auth-return')return virtual;},load(id){if(id===virtual)return fixture;if(id.endsWith('/src/contexts/AuthContext.tsx'))return authContext;if(id.endsWith('/src/services/auth.service.ts'))return authService;},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
    if(!['/login','/auth/change-password','/operations/repair','/operations/mailroom','/dashboard'].includes(new URL(req.url,'http://fixture').pathname))return next();
    try{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__auth-return','<html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body style="margin:0"><div id="root"></div><script type="module" src="/@id/virtual:mailroom-auth-return"></script></body></html>'));}catch(error){next(error);}
  });}}]});
  let browser;t.after(async()=>{try{await browser?.close();}finally{await server.close();rmSync(cacheDir,{recursive:true,force:true});}});
  await server.listen();
  const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({executablePath,headless:true});
  async function open(child,path,{mode='',authed=false}={}){
    const page=await browser.newPage({viewport:{width:1100,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(10000);const errors=[],external=[],writes=[];
    page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const request=route.request();if(new URL(request.url()).origin!==origin){external.push(request.url());return route.abort();}if(request.method()!=='GET'){writes.push(request.method()+' '+request.url());return route.abort();}return route.continue();});
    child.after(async()=>{try{assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(writes,[]);}finally{await page.close();}});
    await page.addInitScript(({mode,authed})=>{if(!sessionStorage.getItem('fixtureSeeded')){sessionStorage.setItem('fixtureSeeded','1');sessionStorage.setItem('fixtureMode',mode);localStorage.setItem('entityId','company-a');if(authed)localStorage.setItem('access_token','SYNTHETIC-ONLY');}},{mode,authed});
    await page.goto(origin+path);return page;
  }
  async function login(page){await page.getByPlaceholder('員工代碼 / 最高權限帳號',{exact:true}).fill('SYNTHETIC');await page.getByPlaceholder('密碼',{exact:true}).fill('SYNTHETIC-ONLY');await page.getByRole('button',{name:'登入系統',exact:true}).click();}
  async function current(page,path){await page.getByTestId('current-path').filter({hasText:path}).waitFor();assert.equal(await page.getByTestId('current-path').textContent(),path);}

  await t.test('unauthenticated QR goes through actual LoginPage and returns to the exact item',async child=>{
    const page=await open(child,target);await page.getByRole('button',{name:'登入系統',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('returnTo'),target);await login(page);await current(page,target);
    assert.deepEqual(await page.evaluate(()=>window.authFixture.trace().map(event=>event.action)),['login']);
  });
  await t.test('mandatory password change keeps the target through change, refresh, logout and second login',async child=>{
    const page=await open(child,target,{mode:'mustchange'});await login(page);await page.getByRole('heading',{name:'首次登入請先修改密碼',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/auth/change-password');assert.equal(new URL(page.url()).searchParams.get('returnTo'),target);
    await page.getByLabel('信箱',{exact:true}).fill('synthetic@example.invalid');await page.getByLabel('目前密碼',{exact:true}).fill('SYNTHETIC-ONLY');await page.getByLabel('新密碼',{exact:true}).fill('SYNTHETIC-NEW-ONLY');await page.getByLabel('確認新密碼',{exact:true}).fill('SYNTHETIC-NEW-ONLY');await page.getByRole('button',{name:'更新密碼',exact:true}).click();
    await page.getByRole('button',{name:'登入系統',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('returnTo'),target);assert.equal(await page.evaluate(()=>localStorage.getItem('access_token')),null);await login(page);await current(page,target);
    assert.deepEqual(await page.evaluate(()=>window.authFixture.trace().map(event=>event.action)),['login','changePassword','refresh','logout','login']);
  });
  await t.test('wrong-company or external return targets fall back to the permitted default workbench',async child=>{
    const invalid=[target.replace('company-a','company-b'),'https://foreign.example.test/operations/repair?entityId=company-a&itemId='+itemId,'//foreign.example.test/operations/repair'];
    for(const returnTo of invalid){const page=await open(child,'/login?'+new URLSearchParams({returnTo}));await login(page);await current(page,'/operations/mailroom');assert.equal(new URL(page.url()).origin,origin);}
  });
  await t.test('actual API 401 clears the token and full navigation preserves the safe item target',async child=>{
    const page=await open(child,target,{authed:true});await current(page,target);const loads=await page.evaluate(()=>window.authFixture.loads());await page.evaluate(()=>{void window.authFixture.trigger401();});await page.waitForURL(url=>url.pathname==='/login');await page.getByRole('button',{name:'登入系統',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('access_token')),null);assert.equal(new URL(page.url()).searchParams.get('returnTo'),target);assert.equal(await page.evaluate(()=>window.authFixture.loads()),loads+1);await login(page);await current(page,target);
  });
  await t.test('a 401 already on LoginPage clears the token without a redirect loop',async child=>{
    const page=await open(child,'/login?'+new URLSearchParams({returnTo:target}));await page.getByRole('button',{name:'登入系統',exact:true}).waitFor();await page.evaluate(()=>localStorage.setItem('access_token','SYNTHETIC-EXPIRED'));const before=page.url(),loads=await page.evaluate(()=>window.authFixture.loads());await page.evaluate(()=>window.authFixture.trigger401());assert.equal(page.url(),before);assert.equal(await page.evaluate(()=>localStorage.getItem('access_token')),null);assert.equal(await page.evaluate(()=>window.authFixture.loads()),loads);await page.getByRole('button',{name:'登入系統',exact:true}).waitFor();
  });
});
