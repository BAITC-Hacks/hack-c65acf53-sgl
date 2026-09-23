/** Phase-2 browser acceptance checks, on the real MapLibre canvas. */
import assert from 'node:assert/strict';
import {connect} from './browser-client.mjs';
const base=process.argv[2]||'http://127.0.0.1:8002';
const b=await connect(base,Number(process.argv[3]||9222));
const {call,evaluate,wait,click,screenshot}=b;
const text=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
const menu=async id=>{await click('#menu-toggle');await click(id);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  await call('Log.clear');b.errors.length=0;
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Emulation.setEmulatedMedia',{features:[]});
  await evaluate("localStorage.removeItem('akim-map-plan-v1');localStorage.setItem('akim-theme-v1','light')");
  await call('Page.navigate',{url:base});
  await wait("document.body.dataset.ready==='true'&&document.body.dataset.mapState==='ready'",30000);
  await click('#navigation [data-view=pulse]');
  assert.equal(await evaluate("document.querySelectorAll('[data-event-quarter="+'"0"'+"]').length"),10);
  assert.equal(await evaluate("document.querySelector('#pulse-unread').hidden"),true);
  const initial=await text('#drawer-content');assert.match(initial,/Школы и детсады/);
  await screenshot('pulse-baseline-light.png');
  await click('#drawer-close');await click('[data-map-district=nura]');await sleep(800);
  // Geographic point -> 2D WebMercator screen coordinates. Dispatch a physical
  // canvas click (not a priority button or a mocked map callback).
  const point=await evaluate(`(async()=>{
    const {representativePosition}=await import('/game-geography.js');
    const p=representativePosition('Нура',1),el=document.querySelector('#city-map'),r=el.getBoundingClientRect(),c=JSON.parse(el.dataset.camera);
    const merc=([lon,lat])=>[(lon+180)/360,(1-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/Math.PI)/2];
    const a=merc(p),o=merc(c.center),scale=512*2**c.zoom;
    return {x:r.left+r.width/2+(a[0]-o[0])*scale,y:r.top+r.height/2+(a[1]-o[1])*scale};
  })()`);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  await wait("document.querySelector('[data-current-issue=\"nura:S1\"]')!==null");
  assert.match(await text('.appeal-detail'),/38 \/ 100/);assert.match(await text('.appeal-detail'),/Критическая проблема/);
  await screenshot('pulse-nura-issue.png');
  await click('[data-resolve=S1]');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-add]')].map(e=>e.dataset.add)"),['M7','M9']);
  console.log('PASS initial Pulse, real map issue click, numeric issue card and relevant projects');

  await menu('#example');await wait("!document.querySelector('#simulate').disabled");
  await click('#advisor');await wait("document.querySelector('#advisor-content').textContent.includes('Соцсфера — 2')");
  await click('#advisor-panel details summary');assert.match(await text('#advisor-content'),/35 \/ 100/);
  await click('#advisor-panel [data-focus-district]');assert.equal(await text('#district-title'),'Нура');
  await click('#advisor');await click('[data-advisor-decisions]');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-add]')].map(e=>e.dataset.add)"),['M8','M9']);
  console.log('PASS partial-plan advisor, supporting values, focus and filtered Decisions');

  await click('#simulate');await wait("document.body.dataset.quarter==='1'");
  await click('#navigation [data-view=pulse]');
  await wait("document.body.dataset.quarter==='2'");
  assert.equal(await text('#score'),'52,56');
  assert.equal(await evaluate("document.querySelectorAll('[data-event-type=activation]').length"),2);
  assert.equal(await evaluate("document.querySelectorAll('[data-event-quarter="+'"8"'+"]').length"),0);
  assert.equal(await evaluate("[...document.querySelectorAll('[data-event-type=activation]')].every(e=>!e.querySelector('.metric-line'))"),true);
  await click('#drawer-close');await wait("Number(document.body.dataset.quarter)>=4");
  assert.ok(Number(await text('#pulse-unread'))>=3);
  await click('#navigation [data-view=pulse]');
  assert.equal(await evaluate("document.querySelector('#pulse-unread').hidden"),true);
  await wait("document.body.dataset.phase==='result'");
  assert.equal(await text('#score'),'56,54');
  assert.equal(await evaluate("document.querySelector('.appeal-card').dataset.eventQuarter"),'8');
  assert.equal(await evaluate("document.querySelectorAll('[data-event-quarter="+'"0"'+"]').length"),10);
  const ids=await evaluate("[...document.querySelectorAll('[data-event-id]')].map(e=>e.dataset.eventId)");
  assert.equal(new Set(ids).size,ids.length);
  assert.match(await text('[data-event-id$="q8:nura:S2"]'),/35 → 43,75/);
  assert.match(await text('[data-event-id$="q8:nura:S2"]'),/Проблема сохраняется/);
  await screenshot('pulse-final-light.png');
  await click('#theme');await wait("document.body.dataset.mapState==='ready'",30000);await screenshot('pulse-final-dark.png');
  await click('[data-map-district=nura]');await click('[data-problem=S2]');
  assert.match(await text('.appeal-detail'),/43,75 \/ 100/);assert.match(await text('.appeal-detail'),/Высокий приоритет/);
  await click('#advisor');assert.match(await text('#advisor-content'),/Наибольший итоговый прирост: Нура/);
  console.log('PASS live milestones/unread, unchanged Q1–Q7 score, Q8 remaining issues and final advisor');

  await click('#navigation [data-view=results]');await click('#comparison-details summary');await click('#alternative');
  await wait("document.body.dataset.branch==='alternative'");
  await click('#navigation [data-view=pulse]');
  assert.equal(await evaluate("[...document.querySelectorAll('[data-event-id]')].every(e=>e.dataset.eventId.includes(':alternative:'))"),true);
  await click('#navigation [data-view=results]');await click('#comparison-details summary');await click('button[data-branch=mine]');
  await click('#navigation [data-view=pulse]');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-event-id]')].map(e=>e.dataset.eventId)"),ids);
  console.log('PASS isolated branch history and return to original run');

  // A deferred, valid wording response for an old draft must not touch the new
  // one. No real AI traffic: intercept wording and construct approved patches.
  await evaluate(`window.__nativeFetch=window.fetch;window.__delayed=false;
    window.fetch=async(url,options)=>{
      if(String(url).includes('/api/events/wording')){
        const request=JSON.parse(options.body);
        const context=await (await window.__nativeFetch('/api/events/context',{...options,body:JSON.stringify(request)})).json();
        const e=context.events[0];
        const response={run_id:request.run_id,branch:request.branch,items:[{event_id:e.event_id,message:e.allowed_messages[1],source:'ai'}]};
        if(!window.__delayed){window.__delayed=true;await new Promise(resolve=>window.__release=resolve);window.__released=true;}
        else response.items=[];
        return new Response(JSON.stringify(response),{headers:{'Content-Type':'application/json'}});
      }
      const response=await window.__nativeFetch(url,options);
      if(String(url).includes('/api/catalog')){const data=await response.json();data.ai_available=true;return new Response(JSON.stringify(data));}
      return response;
    };
    // Change only the exposed capability via a fresh app import in the same page
    // is unsafe; instead enable it before page startup using CDP below.
  `);
  // Preserve the interceptor as an init script for a clean page instance.
  const interceptor=await evaluate("'window.__nativeFetch=window.fetch;window.__delayed=false;window.fetch='+window.fetch.toString()");
  const {identifier}=await call('Page.addScriptToEvaluateOnNewDocument',{source:interceptor});
  await call('Page.reload');await wait("typeof window.__release==='function'");
  await menu('#reset');await click('#navigation [data-view=pulse]');
  await evaluate('window.__release()');await wait('window.__released===true');await sleep(250);
  assert.doesNotMatch(await text('#drawer-content'),/AI-текст/);
  await call('Page.removeScriptToEvaluateOnNewDocument',{identifier});
  await evaluate('window.fetch=window.__nativeFetch');
  console.log('PASS stale AI response from old draft rejected without blocking UI');
  assert.deepEqual(b.errors,[]);
  console.log('PASS no runtime exceptions');
}finally{b.close();}
