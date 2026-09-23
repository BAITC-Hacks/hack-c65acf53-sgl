/** Deterministic geometry and renderer lifecycle, no tiles/AI/browser required. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {districts} from '../static/game-geography.js';
import {projectStates,projectPosition,projectGeometry,projectStatus,visualTypes} from '../static/project-geometry.js';
import {ProjectVisualizationLayer,PROJECT_SOURCE} from '../static/project-visualization.js';
const {measures,example}=JSON.parse(execFileSync('python',['-c','import json; from app import catalog; print(json.dumps(catalog()))'],{encoding:'utf8'}));
const result={verified:true};
globalThis.matchMedia=()=>({matches:true});
const colors=()=>({'accent':'#997733','success':'#447755','warning':'#998844','surface-elevated':'#ffffff','map-land':'#eeeeee','text':'#334433'});
class FakeMap{
  constructor(){this.sources=new Map();this.layers=new Map();this.features=new Map();this.writes=0;this.failSource=false;}
  addSource(id,value){if(this.failSource&&id===PROJECT_SOURCE)throw new Error('Simulated renderer failure');this.sources.set(id,{data:value.data,setData:data=>{this.writes++;this.sources.get(id).data=data;}});}
  getSource(id){return this.sources.get(id);}
  removeSource(id){this.sources.delete(id);}
  addLayer(layer){this.layers.set(layer.id,structuredClone(layer));}
  getLayer(id){return this.layers.get(id);}
  removeLayer(id){this.layers.delete(id);}
  setPaintProperty(id,k,v){this.layers.get(id).paint[k]=v;}
  setLayoutProperty(id,k,v){this.layers.get(id).layout[k]=v;}
  setFeatureState({id},v){this.features.set(id,v);}
}
for(const d of districts){
  const positions=Object.keys(visualTypes).map(id=>projectPosition(id,d.backendName));
  assert.equal(new Set(positions.map(p=>JSON.stringify(p))).size,14);
  for(const [lon,lat] of positions){assert.ok(lon>=d.bounds[0][0]&&lon<=d.bounds[1][0]);assert.ok(lat>=d.bounds[0][1]&&lat<=d.bounds[1][1]);}
}
const initial=projectStates(example,measures,0,null),reordered=projectStates([...example].reverse(),measures,0,null);
assert.deepEqual(initial,reordered);
assert.equal(initial.find(p=>p.projectId==='M7').state,'planned');
assert.equal(projectStates(example,measures,3,null).find(p=>p.projectId==='M7').state,'planned');
assert.equal(projectStates(example,measures,4,null).find(p=>p.projectId==='M7').state,'active');
assert.equal(projectStates(example,measures,8,null)[0].state,'active','Q8 alone cannot claim final result');
assert.ok(projectStates(example,measures,8,result).every(p=>p.state==='completed'));
assert.deepEqual(projectStates(example,measures,8,result,{before:true}),[]);
assert.match(projectStatus(initial[0],0),/Запланировано/);
for(const id of Object.keys(measures)){
  const plan=[{measure_id:id,...(measures[id].scope==='Район'?{district:'Нура'}:{})}];
  const [p]=projectStates(plan,measures,0,null),geometry=projectGeometry(p);
  assert.ok(geometry.length>1,id);
  assert.equal(projectGeometry(p),geometry,'Geometry cached independently of phase');
  assert.ok(geometry.every(f=>f.properties.simulated&&f.properties.projectId===id));
  assert.equal(new Set(geometry.map(f=>f.id)).size,geometry.length);
  assert.equal(geometry.filter(f=>f.properties.role==='anchor').length,1,'One main control per citywide project');
  if(measures[id].scope==='Город')assert.ok(geometry.length>=6,'Sparse distributed effect across districts');
  if(id==='M12')assert.ok(!geometry.some(f=>f.properties.role==='building'),'Digital service never invents a building');
}
const m=new FakeMap(),container={dataset:{}},layer=new ProjectVisualizationLayer(m,{container,colors});
layer.update(example,0,null,measures,{scenario:'main'});
const writes=m.writes;layer.update(example,1,null,measures,{scenario:'main'});assert.equal(m.writes,writes,'No changed state = no source regeneration');
layer.update(example,4,null,measures,{scenario:'main'});assert.equal(container.dataset.projectRendering,'layers');
layer.setPresentationMode('3d');assert.equal(m.getLayer('sim-project-extrusions').layout.visibility,'visible');
layer.setSummary(true);assert.equal(m.getLayer('sim-veil').paint['fill-opacity'],.36);
layer.update(example,8,result,measures,{scenario:'main',before:true});assert.equal(m.getSource(PROJECT_SOURCE).data.features.length,0);assert.equal(m.getLayer('sim-veil').paint['fill-opacity'],0);
layer.update(example,8,result,measures,{scenario:'alternative'});assert.ok(layer.states.every(p=>p.scenario==='alternative'&&p.state==='completed'));
assert.ok([...m.features.values()].every(v=>v.growth===1),'Reduced motion skips tweening');
layer.clear();assert.equal(m.getSource(PROJECT_SOURCE).data.features.length,0);layer.destroy();assert.equal(m.sources.size,0);
const broken=new FakeMap();broken.failSource=true;
const fallback=new ProjectVisualizationLayer(broken,{container,colors});
assert.doesNotThrow(()=>fallback.update(example,4,null,measures));
assert.equal(container.dataset.projectRendering,'markers');assert.equal(fallback.states.length,5);
assert.equal(broken.sources.size,0,'Partial native installation is removed');
console.log('PASS all 14 visual types, deterministic placement, lifecycle, overview/citywide geometry, before/after, 3D, reduced motion, caching, branch isolation and failure fallback');
