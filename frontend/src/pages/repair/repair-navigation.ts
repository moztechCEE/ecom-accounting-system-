import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useBlocker } from 'react-router-dom';
/** Serializes navigation while a draft confirmation is open. A cancelled exit keeps the draft. */
export function createRepairNavigationGate(dirty:{current:boolean},confirm:()=>Promise<boolean>) {
  let asking=false;
  return (leave:()=>void) => {
    if(!dirty.current){leave();return;}
    if(asking)return;
    asking=true;
    void (async()=>{
      try {if(await confirm()){dirty.current=false;leave();}}
      finally {asking=false;}
    })();
  };
}
/** Data-router blocker covers in-app navigation and browser Back; native unload is separate. */
export function useRepairNavigationGuard(dirty:MutableRefObject<boolean>,confirm:()=>Promise<boolean>) {
  const blocker=useBlocker(()=>dirty.current);
  const latest=useRef(blocker);const asking=useRef(false);
  useEffect(()=>{
    latest.current=blocker;
    if(blocker.state!=='blocked'||asking.current)return;
    asking.current=true;
    void(async()=>{
      try {
        const leave=await confirm();
        if(latest.current.state==='blocked'){
          if(leave){dirty.current=false;latest.current.proceed();}else latest.current.reset();
        }
      } finally {asking.current=false;}
    })();
  },[blocker,dirty,confirm]);
  useEffect(()=>{
    const unload=(event:BeforeUnloadEvent)=>{if(dirty.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',unload);
    return ()=>window.removeEventListener('beforeunload',unload);
  },[dirty]);
}
