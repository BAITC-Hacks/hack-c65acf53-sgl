/** Small CDP client for an isolated Chrome test session. Node 22+, no packages. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

export async function connect(base='http://127.0.0.1:8001',port=9222){
  const pages=await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page=pages.find(p=>p.type==='page'&&p.url.startsWith(base));
  if(!page)throw new Error(`Open ${base} in the isolated debug Chrome first.`);
  const socket=new WebSocket(page.webSocketDebuggerUrl),pending=new Map(),errors=[],network=[];let sequence=0;
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=e=>{
    const message=JSON.parse(e.data);
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);
    if(message.method==='Network.loadingFailed')network.push(message.params);
    if(message.method==='Log.entryAdded'&&message.params.entry.level==='error')network.push(message.params.entry);
    if(message.id&&pending.has(message.id)){const {resolve,reject,timer}=pending.get(message.id);clearTimeout(timer);pending.delete(message.id);if(message.error)reject(new Error(JSON.stringify(message.error)));else resolve(message.result);}
  };
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{
    const value=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(value.exceptionDetails)throw new Error(JSON.stringify(value.exceptionDetails));return value.result?.value;
  };
  const wait=async(expression,timeout=15000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(`document.body && (${expression})`))return;await new Promise(r=>setTimeout(r,120));}throw new Error(`Timed out: ${expression}\n${JSON.stringify(errors)}`);};
  const click=async selector=>{
    const rect=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw new Error('Missing/disabled control: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await call('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'left',clickCount:1});
  };
  const screenshot=async name=>{await mkdir(resolve('.browser-check'),{recursive:true});const {data}=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve('.browser-check',name),Buffer.from(data,'base64'));};
  await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Log.enable');
  return {call,evaluate,wait,click,screenshot,errors,network,close:()=>socket.close()};
}
