/** Real MapLibre acceptance demo, including simulated native-layer failure. */
import assert from 'node:assert/strict';
import {connect} from './browser-client.mjs';
const base=process.argv[2]||'http://127.0.0.1:8002';
const b=await connect(base,Number(process.argv[3]||9222));
const {call,evaluate,wait,click,screenshot}=b;
const text=s=>evaluate(`document.querySelector(${JSON.stringify(s)}).textContent`);
const menu=async id=>{await click('#menu-toggle');await click(id);};
const states=()=>evaluate("JSON.parse(document.querySelector('#city-map').dataset.projectVisuals)");
const ready=()=>wait("document.body.dataset.ready==='true'&&document.body.dataset.mapState==='ready'",30000);
const settle=ms=>new Promise(r=>setTimeout(r,ms));
const loadPlan=async plan=>{
  await evaluate(`localStorage.setItem('akim-map-plan-v1',JSON.stringify(${JSON.stringify(plan)}))`);
  await call('Page.reload');await ready();await wait("!document.querySelector('#simulate').disabled");
};
try{
  await call('Log.clear');b.errors.length=0;b.network.length=0;
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Emulation.setEmulatedMedia',{features:[]});
  await evaluate("localStorage.removeItem('akim-map-plan-v1');localStorage.setItem('akim-theme-v1','light')");
  await call('Page.reload');await ready();
  await click('[data-map-district=nura]');await click('[data-problem=S1]');await click('[data-resolve=S1]');await click('[data-add=M7]');
  await wait("document.querySelector('[data-project=M7]')!==null");
  const school=(await states())[0];assert.equal(school.state,'planned');assert.equal(school.activationQuarter,4);
  await click('[data-project=M7]');assert.match(await text('#district-content'),/Запланировано · Эффект с Q4/);
  assert.match(await text('#district-content'),/Условное размещение/);assert.doesNotMatch(await text('#district-content'),/Проверенные изменения Q8/);
  await screenshot('project-school-planned.png');
  await call('Page.reload');await ready();assert.deepEqual((await states())[0].coordinates,school.coordinates);
  await menu('#example');await wait("!document.querySelector('#simulate').disabled");
  const planned=await states();assert.equal(planned.length,5);assert.ok(planned.every(p=>p.state==='planned'));
  await click('#drawer-close');await click('#zoom-reset');await settle(800);await screenshot('projects-planned-1440-light.png');
  // Capture the actual map via its public prototype for assertions; app exposes no globals.
  await evaluate(`window.__originalGetSource=maplibregl.Map.prototype.getSource;maplibregl.Map.prototype.getSource=function(...args){window.__testMap=this;return window.__originalGetSource.apply(this,args)};window.__canvas=document.querySelector('.maplibregl-canvas');`);
  await click('#navigation [data-view=decisions]');await click('#simulate');
  await wait("document.body.dataset.quarter==='2'");
  assert.equal((await states()).find(p=>p.projectId==='M10').state,'active');
  assert.equal((await states()).find(p=>p.projectId==='M7').state,'planned');assert.equal(await text('#score'),'52,56');
  await wait("document.body.dataset.quarter==='4'");assert.equal((await states()).find(p=>p.projectId==='M7').state,'active');
  await wait("document.body.dataset.phase==='result'");
  assert.equal(await evaluate("document.querySelector('#drawer').hidden"),true,'No automatic results drawer');
  assert.ok((await states()).every(p=>p.state==='completed'));assert.equal(await text('#score'),'56,54');
  const after=await evaluate("JSON.stringify(window.__testMap.getSource('sim-projects').serialize().data)");
  assert.ok(await evaluate(`JSON.parse(document.querySelector('#city-map').dataset.projectVisuals).every(p=>{
    const el=document.querySelector('[data-project="'+p.projectId+'"]'),r=el.getBoundingClientRect(),m=document.querySelector('#city-map').getBoundingClientRect(),xy=window.__testMap.project(p.coordinates);
    return Math.abs(r.x+r.width/2-m.x-xy.x)<2&&Math.abs(r.bottom+8-m.y-xy.y)<2;
  })`),'Controls coincide with their native geometry anchors');
  const basemap=await evaluate("JSON.stringify(Object.entries(window.__testMap.getStyle().sources).filter(([id])=>!id.startsWith('sim-')&&!id.startsWith('game-')))");
  await screenshot('projects-final-1440-light.png');
  await click('#map-comparison [data-snapshot=before]');
  assert.deepEqual(await states(),[]);assert.equal(await text('#score'),'52,56');
  assert.equal(await evaluate("window.__testMap.getSource('sim-projects').serialize().data.features.length"),0);
  await click('#map-comparison [data-snapshot=after]');
  assert.deepEqual(JSON.parse(await evaluate("JSON.stringify(window.__testMap.getSource('sim-projects').serialize().data)")),JSON.parse(after));
  assert.equal(await evaluate("JSON.stringify(Object.entries(window.__testMap.getStyle().sources).filter(([id])=>!id.startsWith('sim-')&&!id.startsWith('game-')))"),basemap);
  await click('#show-changes');assert.equal(await evaluate("window.__testMap.getPaintProperty('sim-veil','fill-opacity')"),.36);
  await settle(550);await screenshot('projects-summary-1440-light.png');
  await click('#show-changes');assert.equal(await evaluate("window.__testMap.getPaintProperty('sim-veil','fill-opacity')"),0);
  console.log('PASS stable planning, activation timing, Q8, unchanged basemap, before/after and visual summary');

  await click('[data-project=M7]');assert.match(await text('#district-content'),/Проверенные изменения Q8/);assert.match(await text('#district-content'),/\+10/);
  assert.match(await text('#district-content'),/не отдельный вклад/);
  assert.equal(await evaluate("document.querySelector('#drawer').hidden"),true);
  assert.match(await evaluate("JSON.stringify(window.__testMap.getPaintProperty('game-issues','circle-stroke-width'))"),/S1/);
  await click('#district-close');
  for(const theme of ['light','dark']){
    if(await evaluate("document.documentElement.dataset.theme")!==theme){await click('#theme');await ready();}
    for(const mode of ['3d','2d']){
      if(await evaluate("document.querySelector('#city-map').dataset.presentation")!==mode){await click('#presentation');await settle(800);}
      assert.equal(await evaluate("window.__testMap.getLayoutProperty('sim-project-extrusions','visibility')"),mode==='3d'?'visible':'none');
      assert.equal(await evaluate("document.querySelector('#city-map').dataset.projectRendering"),'layers');
      assert.equal(await evaluate("document.querySelector('.maplibregl-canvas')===window.__canvas"),true);
    }
  }
  await click('#show-changes');await screenshot('projects-summary-1440-dark.png');
  await call('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await settle(500);await screenshot('projects-summary-1920-dark.png');
  console.log('PASS project card, authoritative net delta, issue highlighting, light/dark and 2D/3D on one map');

  // Native geometry failure must keep five clean interactive fallback controls.
  await evaluate(`window.__originalAddSource=maplibregl.Map.prototype.addSource;maplibregl.Map.prototype.addSource=function(id,...args){if(id==='sim-projects')throw new Error('test geometry failure');return window.__originalAddSource.call(this,id,...args)};`);
  await click('#theme');await ready();
  assert.equal(await evaluate("document.querySelector('#city-map').dataset.projectRendering"),'markers');
  assert.equal(await evaluate("document.querySelectorAll('.simulated-project').length"),5);
  await click('[data-project=M8]');assert.match(await text('#district-title'),/здоровья/);await click('#district-close');
  await evaluate('maplibregl.Map.prototype.addSource=window.__originalAddSource');await click('#theme');await ready();
  assert.equal(await evaluate("document.querySelector('#city-map').dataset.projectRendering"),'layers');
  console.log('PASS visualization failure retains markers and restores native layers');

  const plans=[
    [{measure_id:'M1',district:'Алматы'},{measure_id:'M2'},{measure_id:'M4',district:'Сарыарка'},{measure_id:'M9',district:'Есиль'},{measure_id:'M14'}],
    [{measure_id:'M3',district:'Нура'},{measure_id:'M6'},{measure_id:'M11',district:'Нура'},{measure_id:'M13',district:'Байконур'},{measure_id:'M9',district:'Есиль'}]
  ];
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  for(let i=0;i<plans.length;i++){
    await loadPlan(plans[i]);await click('#navigation [data-view=decisions]');await click('#simulate');await wait("document.body.dataset.phase==='result'");
    assert.equal(await evaluate("document.querySelector('#city-map').dataset.projectRendering"),'layers');
    assert.equal(await evaluate("document.querySelectorAll('.simulated-project').length"),5);
    assert.equal(await evaluate("document.querySelectorAll('.simulated-project.activating').length"),0);
    await click('#show-changes');await screenshot(`projects-types-${i}-1920.png`);
    await click('#presentation');await settle(100);await screenshot(`projects-types-${i}-3d.png`);
  }
  // A district view makes modest symbolic extrusions legible, without extreme zoom.
  await click('[data-map-district=saryarka]');await screenshot('projects-district-3d.png');
  assert.deepEqual(b.errors,[]);
  assert.equal(b.network.filter(e=>e.level==='error'&&/sim-project|expression/i.test(e.text||'')).length,0);
  console.log('PASS all 14 project types rendered, citywide controls stay sparse, reduced motion and no browser exceptions');
}finally{await call('Emulation.setEmulatedMedia',{features:[]});b.close();}
