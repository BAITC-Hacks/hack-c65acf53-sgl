/** Behavioral smoke test. Run in a dedicated Chrome profile; it resets test drafts. */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import {connect} from './browser-client.mjs';
const base=process.argv[2]||'http://127.0.0.1:8001';
const b=await connect(base,Number(process.argv[3]||9222));
const {call,evaluate,wait,click,screenshot}=b;
const text=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
const select=async(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const menu=async id=>{await click('#menu-toggle');await click(id);};
const mapReady=()=>wait("document.body.dataset.mapState==='ready'",30000);
const noExceptions=()=>assert.deepEqual(b.errors,[],'No browser runtime exceptions');
try{
  await call('Log.clear');b.network.length=0;b.errors.length=0;
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate("localStorage.removeItem('akim-map-plan-v1');localStorage.setItem('akim-theme-v1','light')");
  await call('Page.navigate',{url:base});
  await wait("document.body.dataset.ready==='true'");await mapReady();
  assert.equal(await evaluate("document.querySelector('#city-map').dataset.renderer"),'maplibre');
  assert.equal(await evaluate("document.querySelector('#district-card').hidden&&document.querySelector('#drawer').hidden"),true);
  assert.equal(await text('#budget'),'100');assert.equal(await text('#score'),'52,56');
  await evaluate("window.__smokeCanvas=document.querySelector('.maplibregl-canvas')");
  await screenshot('map-light-2d.png');console.log('PASS real Astana map; clean initial state');

  // Actual map label selection, progressive disclosure, issue -> project flow.
  await click('[data-map-district="nura"]');
  assert.equal(await text('#district-title'),'Нура');
  assert.equal(await evaluate("document.querySelectorAll('.priority-issue').length"),3);
  assert.equal(await evaluate("document.querySelector('#all-metrics').open"),false);
  await click('#all-metrics summary');assert.equal(await evaluate("document.querySelector('#all-metrics').open"),true);
  await click('[data-problem="S1"]');await click('[data-resolve="S1"]');
  assert.equal(await evaluate("document.querySelectorAll('.initiative').length"),2);
  await click('[data-add="M7"]');assert.equal(await text('#budget'),'76');
  await click('[data-filter="Соцсфера"]');
  await click('[data-add="M8"]');
  await click('[data-filter="Безопасность"]');await click('[data-add="M10"]');
  await click('[data-filter="Сервисы"]');await click('[data-add="M12"]');
  await click('[data-filter="Экология"]');await select('[data-measure-district="M5"]','Сарыарка');await click('[data-add="M5"]');
  await wait("!document.querySelector('#simulate').disabled");assert.equal(await text('#budget'),'5');
  assert.equal(await evaluate("document.querySelector('#city-map').dataset.projectCount"),'5');
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('akim-map-plan-v1')).length"),5);
  await screenshot('decisions-light.png');console.log('PASS district priorities, manual plan, budget and validation');

  await click('#simulate');await wait("document.body.dataset.phase==='playback'&&Number(document.body.dataset.quarter)>=2");
  assert.equal(await text('#score'),'52,56','No intermediate numeric scores');
  await wait("document.body.dataset.phase==='result'");assert.equal(await text('#score'),'56,54');
  assert.equal(await evaluate("document.body.dataset.quarter"),'8');
  await click('#navigation [data-view="results"]');
  await click('[data-snapshot="before"]');assert.equal(await text('#score'),'52,56');
  assert.equal(await evaluate("document.querySelector('#city-map').dataset.projectCount"),'0');
  await click('[data-snapshot="after"]');assert.equal(await text('#score'),'56,54');
  assert.equal(await evaluate("document.querySelector('#city-map').dataset.projectCount"),'5');
  await screenshot('results-light.png');console.log('PASS Q1–Q8, reference score 56.54 and before/after overlays');

  await click('#presentation');await wait("JSON.parse(document.querySelector('#city-map').dataset.camera).pitch>50");
  await screenshot('map-light-3d.png');
  const camera=JSON.parse(await evaluate("document.querySelector('#city-map').dataset.camera"));
  await click('#theme');await mapReady();
  assert.equal(await evaluate("document.documentElement.dataset.theme"),'dark');
  assert.equal(await evaluate("localStorage.getItem('akim-theme-v1')"),'dark');
  const themedCamera=JSON.parse(await evaluate("document.querySelector('#city-map').dataset.camera"));
  assert.ok(Math.abs(camera.zoom-themedCamera.zoom)<.001);
  assert.ok(Math.abs(camera.center[0]-themedCamera.center[0])<.001);
  assert.equal(await evaluate("document.querySelector('#drawer-title').textContent"),'Ваша Астана');
  assert.equal(await evaluate("document.querySelector('#city-map').dataset.projectCount"),'5');
  assert.equal(await evaluate("document.querySelector('.maplibregl-canvas')===window.__smokeCanvas"),true,'One MapLibre instance through themes and modes');
  assert.equal(await evaluate("document.querySelector('[data-map-district=nura]').getAttribute('aria-pressed')"),'true');
  await screenshot('map-dark-3d.png');await click('#presentation');await wait("JSON.parse(document.querySelector('#city-map').dataset.camera).pitch<1");await screenshot('map-dark-2d.png');
  console.log('PASS light/dark × 2D/3D, theme persistence, camera and layers retained');

  await click('#comparison-details summary');await click('#alternative');
  await wait("document.querySelector('button[data-branch=mine]')!==null");
  const alternative=await text('#score');await click('button[data-branch="mine"]');assert.equal(await text('#score'),'56,54');
  await click('button[data-branch="alternative"]');assert.equal(await text('#score'),alternative);
  await click('button[data-branch="mine"]');
  await click('#navigation [data-view="pulse"]');assert.ok(await evaluate("document.querySelectorAll('.appeal-card').length")>15);
  assert.equal(await evaluate("document.querySelector('#pulse-unread').hidden"),true);
  await click('#advisor');assert.equal(await evaluate("document.querySelector('#drawer').hidden&&!document.querySelector('#advisor-panel').hidden"),true);
  await click('#advisor-close');console.log('PASS alternatives, pulse history, single contextual advisor');

  await menu('#example');await wait("!document.querySelector('#simulate').disabled");
  await click('[data-remove="M5"]');await click('[data-filter="Экология"]');
  await select('[data-measure-district="M4"]','Нура');await click('[data-add="M4"]');
  assert.equal(await evaluate("document.querySelector('#simulate').disabled"),true);assert.match(await text('#plan-status'),/несовместимы/);
  await select('[data-measure-district="M4"]','Есиль');await wait("!document.querySelector('#simulate').disabled");
  console.log('PASS conflicting project blocked, reassignment accepted');

  // Delayed validation for an old revision must never enable a changed draft.
  await evaluate("window.__originalFetch=window.fetch;window.fetch=async (...args)=>{const r=await window.__originalFetch(...args);if(String(args[0]).includes('/api/validate'))await new Promise(resolve=>setTimeout(resolve,1200));return r;}");
  await select('[data-measure-district="M4"]','Алматы');await click('[data-remove="M4"]');
  await new Promise(r=>setTimeout(r,1400));assert.equal(await evaluate("document.querySelector('#simulate').disabled"),true);
  await evaluate("window.fetch=window.__originalFetch");await menu('#example');await wait("!document.querySelector('#simulate').disabled");
  console.log('PASS stale validation cannot enable an incomplete draft');

  // Export actual JSON, then import it through the native file input.
  const downloadDir=resolve('.browser-check/downloads');await mkdir(downloadDir,{recursive:true});
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});
  await menu('#export');let exported;
  for(let i=0;i<40;i++){try{exported=JSON.parse(await readFile(resolve(downloadDir,'astana-plan.json'),'utf8'));break;}catch(_){await new Promise(r=>setTimeout(r,100));}}
  assert.equal(exported?.length,5);await menu('#reset');assert.equal(await text('#budget'),'100');
  const {root}=await call('DOM.getDocument');const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'#file'});
  await call('DOM.setFileInputFiles',{nodeId,files:[resolve(downloadDir,'astana-plan.json')]});
  await wait("!document.querySelector('#simulate').disabled");assert.equal(await text('#budget'),'5');console.log('PASS JSON export and import');

  // Block only provider requests; API and local assets stay reachable.
  const saved=await evaluate("localStorage.getItem('akim-map-plan-v1')");
  await call('Network.setBlockedURLs',{urls:['*tiles.openfreemap.org*']});await click('#theme');
  await wait("document.body.dataset.mapState==='error'");
  await evaluate("window.__beforeReload=true");await call('Page.reload',{ignoreCache:true});
  await wait("!window.__beforeReload&&document.body.dataset.ready==='true'&&document.body.dataset.mapState==='error'");
  assert.equal(await evaluate("localStorage.getItem('akim-map-plan-v1')"),saved);
  await click('#navigation [data-view="decisions"]');assert.equal(await evaluate("document.querySelector('#simulate').disabled"),false);
  await click('#simulate');await wait("document.body.dataset.phase==='result'");assert.equal(await text('#score'),'56,54');
  await click('#map-fallback');assert.equal(await evaluate("document.querySelector('#city-map').dataset.renderer"),'legacy');
  assert.equal(await text('#score'),'56,54');assert.equal(await evaluate("document.querySelector('#presentation').disabled"),true);
  await call('Network.setBlockedURLs',{urls:[]});await click('#map-retry');await mapReady();
  console.log('PASS tile failure preserves plan and simulation; schematic fallback and real-map retry');
  await click('#navigation [data-view="results"]');

  for(const theme of ['light','dark']){
    if(await evaluate("document.documentElement.dataset.theme")!==theme){await click('#theme');await mapReady();}
    await click('#drawer-close');await click('#zoom-reset');
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await wait("innerWidth===390");assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),true);
    await screenshot(`mobile-${theme}.png`);
    await click('#district-picker-toggle');await click('[data-focus-district="nura"]');
    assert.equal(await text('#district-title'),'Нура');await screenshot(`mobile-${theme}-district.png`);
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    assert.equal(await evaluate("document.querySelector('#district-card').hidden"),true);
    await click('#navigation [data-view="results"]');
  }
  console.log('PASS mobile themes, district picker and keyboard dismissal');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await menu('#example');await wait("!document.querySelector('#simulate').disabled");await click('#simulate');await wait("document.body.dataset.phase==='result'");assert.equal(await text('#score'),'56,54');
  await call('Emulation.setEmulatedMedia',{features:[]});
  noExceptions();console.log('PASS reduced-motion playback; no JavaScript exceptions');
  console.log(`Provider/network log entries (includes intentional outage): ${b.network.length}`);
}finally{await call('Network.setBlockedURLs',{urls:[]});b.close();}

