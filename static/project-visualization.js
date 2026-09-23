/** One retained MapLibre visualization layer; no simulation or score calculations.
 * Cached geometry + state changes update sources. Short activation animations use
 * feature-state only, never setData per frame. Five accessible controls at most.
 */
import {projectStates,projectGeometry,projectStatus} from './project-geometry.js';
import {icon,measureIcons} from './city-map.js';

export const PROJECT_SOURCE='sim-projects';
export const PROJECT_LAYERS=['sim-project-haze','sim-project-area','sim-project-outline','sim-project-planned',
  'sim-project-lines','sim-project-digital','sim-project-glow','sim-project-nodes','sim-project-extrusions'];
const empty=()=>({type:'FeatureCollection',features:[]});
const reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const active=['==',['get','active'],true],color=['get','color'];
const growth=['coalesce',['feature-state','growth'],1];
const progress=['max',0,['min',1,['/', ['-',growth,['coalesce',['get','delay'],0]],.7]]];
const opacity=(planned,working)=>['case',active,['*',working,progress],planned];
const geometry=type=>['==',['geometry-type'],type];
const role=(...roles)=>['in',['get','role'],['literal',roles]];

function palette(){
  const css=getComputedStyle(document.documentElement);
  return Object.fromEntries(['accent','success','warning','surface-elevated','map-land','text'].map(k=>[k,css.getPropertyValue(`--${k}`).trim()]));
}
export class ProjectVisualizationLayer{
  constructor(map,{lib=null,container=null,onSelect=()=>{},onHover=()=>{},colors=palette}={}){
    Object.assign(this,{map,lib,container,onSelect,onHover,colors});
    this.markers=new Map();this.states=[];this.key=null;this.scenario=null;this.before=false;
    this.presentation='2d';this.summary=false;this.selected=null;this.failed=false;this.frame=null;this.generation=0;
  }
  install(){
    if(this.map.getSource(PROJECT_SOURCE))return;
    this.failed=false;this.key=null;this.cancelAnimation();
    const p=this.colors(),m=this.map,before=m.getLayer('game-issues')?'game-issues':undefined;
    // Veil is a separate presentation overlay. Provider data/style never changes.
    m.addSource('sim-veil',{type:'geojson',data:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[70,50],[73,50],[73,53],[70,53],[70,50]]]}}]}});
    m.addLayer({id:'sim-veil',type:'fill',source:'sim-veil',paint:{'fill-color':p['map-land'],'fill-opacity':0,'fill-opacity-transition':{duration:reduced()?0:500}}},before);
    m.addSource(PROJECT_SOURCE,{type:'geojson',data:empty()});
    const add=(id,type,filter,paint,layout={})=>m.addLayer({id,type,source:PROJECT_SOURCE,filter,paint,layout},before);
    add('sim-project-haze','fill',['all',geometry('Polygon'),role('haze')],{'fill-color':p['text'],'fill-opacity':['case',active,.025,.13]});
    add('sim-project-area','fill',['all',geometry('Polygon'),['!',role('haze','canopy')]],{'fill-color':color,'fill-opacity':opacity(.035,.30)});
    add('sim-project-outline','line',geometry('Polygon'),{'line-color':color,'line-width':1.2,'line-opacity':opacity(.45,.75),'line-dasharray':[3,3]});
    add('sim-project-planned','line',['all',geometry('LineString'),['!',active]],{'line-color':color,'line-width':2,'line-opacity':.45,'line-dasharray':[3,3]});
    add('sim-project-lines','line',['all',geometry('LineString'),active,['!',role('digital')]],{'line-color':color,'line-width':['case',role('route','rail'),3,role('crosswalk'),3,1.6],'line-opacity':opacity(0,.85)},{'line-cap':'round','line-join':'round'});
    add('sim-project-digital','line',['all',geometry('LineString'),active,role('digital')],{'line-color':color,'line-width':1.3,'line-opacity':opacity(0,.45),'line-dasharray':[2,5]});
    add('sim-project-glow','circle',['all',geometry('Point'),active,['!',role('haze','tree','court-center')]],{
      'circle-color':color,'circle-radius':['case',role('anchor'),28,role('response'),24,16],
      'circle-opacity':opacity(0,.13),'circle-blur':.6});
    add('sim-project-nodes','circle',geometry('Point'),{'circle-color':color,
      'circle-radius':['case',role('anchor'),12,role('tree'),['*',6,progress],role('haze'),15,4],
      'circle-opacity':['case',role('anchor'),0,role('haze'),['case',active,.025,.1],opacity(.12,.85)],
      'circle-stroke-color':color,'circle-stroke-width':['case',role('anchor'),1.3,1],
      'circle-stroke-opacity':['case',role('haze'),['case',active,.05,.2],opacity(.4,.8)]});
    add('sim-project-extrusions','fill-extrusion',['all',geometry('Polygon'),active,role('building','canopy')],{
      'fill-extrusion-color':color,'fill-extrusion-height':['*',['get','height'],progress],
      'fill-extrusion-base':0,'fill-extrusion-opacity':.72},{visibility:this.presentation==='3d'?'visible':'none'});
    this.setSummary(this.summary);this.highlight(this.selected);
  }
  update(plan,quarter,result,measures,{scenario='main',before=false}={}){
    const sameScenario=this.scenario===scenario,previous=new Map(this.states.map(p=>[p.projectId,p]));
    this.scenario=scenario;this.before=before;this.quarter=quarter;
    this.states=projectStates(plan,measures,quarter,result,{before,scenario});
    // Controls are independent of advanced layers; a failure retains useful markers.
    this.updateMarkers(previous,sameScenario);
    try{
      if(this.failed)return this.publish();
      this.install();
      const key=JSON.stringify([scenario,this.states.map(p=>[p.projectId,p.district,p.state])]);
      if(key!==this.key){
        this.cancelAnimation();this.key=key;const p=this.colors(),animated=[];
        const features=this.states.flatMap(project=>{
          const tint=['park','greening','air'].includes(project.visualType)?p.success:['lighting','crossing','traffic'].includes(project.visualType)?p.warning:p.accent;
          const was=previous.get(project.projectId),activate=sameScenario&&was?.state==='planned'&&project.state==='active';
          return projectGeometry(project).map(f=>{
            if(activate) animated.push(f.id);
            return {...f,properties:{...f.properties,color:tint,active:project.state!=='planned'}};
          });
        });
        this.map.getSource(PROJECT_SOURCE).setData({type:'FeatureCollection',features});
        for(const f of features)this.map.setFeatureState({source:PROJECT_SOURCE,id:f.id},{growth:1});
        this.animate(animated);
      }
      this.setSummary(this.summary);this.highlight(this.selected);
    }catch(_){this.fail();}
    this.publish();
  }
  publish(){
    if(!this.container)return;
    this.container.dataset.projectVisuals=JSON.stringify(this.states);
    this.container.dataset.projectRendering=this.failed?'markers':'layers';
    this.container.dataset.visualSummary=String(this.summary&&!this.before);
  }
  animate(ids){
    if(!ids.length||reduced())return;
    const generation=++this.generation,start=performance.now(),duration=750;
    const frame=now=>{
      if(generation!==this.generation||!this.map.getSource(PROJECT_SOURCE))return;
      const t=reduced()?1:Math.min(1,(now-start)/duration),value=1-(1-t)**3;
      for(const id of ids)this.map.setFeatureState({source:PROJECT_SOURCE,id},{growth:value});
      if(t<1)this.frame=requestAnimationFrame(frame);else this.frame=null;
    };
    frame(start);
  }
  cancelAnimation(){++this.generation;if(this.frame!==null)cancelAnimationFrame(this.frame);this.frame=null;}
  updateMarkers(previous,sameScenario){
    if(!this.lib||!this.container)return;
    const wanted=new Set(this.states.map(p=>p.projectId));
    for(const [id,item] of this.markers)if(!wanted.has(id)){item.marker.remove();this.markers.delete(id);}
    for(const project of this.states){
      let item=this.markers.get(project.projectId);
      if(!item){
        const button=document.createElement('button');button.innerHTML=icon(measureIcons[project.projectId])+'<i class="project-stem" aria-hidden="true"></i>';button.dataset.project=project.projectId;
        // Lift the small control above the footprint so it cannot hide the city effect.
        const marker=new this.lib.Marker({element:button,anchor:'bottom',offset:[0,-8]}).setLngLat(project.coordinates).addTo(this.map);
        item={marker,button};this.markers.set(project.projectId,item);
        button.onclick=e=>{e.stopPropagation();this.onSelect(project.projectId,project.district);};
        button.onmouseenter=()=>{this.highlight(project.projectId);this.onHover(project.projectId);};
        button.onmouseleave=()=>{this.highlight(this.selected);this.onHover(null);};
        button.onfocus=button.onmouseenter;button.onblur=button.onmouseleave;
      }
      const old=previous.get(project.projectId),starting=sameScenario&&old?.state==='planned'&&project.state==='active';
      item.marker.setLngLat(project.coordinates);
      const libraryClasses=[...item.button.classList].filter(name=>name.startsWith('maplibregl-')).join(' ');
      item.button.className=`${libraryClasses} project-marker simulated-project ${project.state} ${project.district?'':'citywide'} ${starting&&!reduced()?'activating':''}`;
      item.button.dataset.projectState=project.state;
      item.button.setAttribute('aria-label',`${project.name} · ${project.district||'Весь город'} · ${projectStatus(project,this.quarter)}. Симуляция, условное размещение.`);
      item.button.title=item.button.getAttribute('aria-label');
      // Handlers read current metadata after reassignment, not creation-time state.
      item.button.onclick=e=>{e.stopPropagation();this.onSelect(project.projectId,project.district);};
    }
  }
  setPresentationMode(mode){
    this.presentation=mode;
    if(this.map.getLayer('sim-project-extrusions'))this.map.setLayoutProperty('sim-project-extrusions','visibility',mode==='3d'?'visible':'none');
  }
  setSummary(enabled){
    this.summary=!!enabled;
    this.applyEmphasis();this.publish();
  }
  applyEmphasis(){
    // Before mode keeps its baseline game overlays unmodified.
    const emphasized = this.summary && !this.before;
    if(this.map.getLayer('sim-veil'))this.map.setPaintProperty('sim-veil','fill-opacity',emphasized ? .36 : 0);
    if(this.map.getLayer('sim-project-glow'))this.map.setPaintProperty('sim-project-glow','circle-opacity',opacity(0,emphasized ? .28 : .13));
    for(const item of this.markers.values())item.button.classList.toggle('emphasized',this.summary&&!this.before);
  }
  highlight(id){
    // Stroke around relevant features; no issue severity is changed here.
    if(this.map.getLayer('sim-project-outline'))this.map.setPaintProperty('sim-project-outline','line-width',id?['case',['==',['get','projectId'],id],2.8,1.2]:1.2);
    for(const [key,item] of this.markers)item.button.classList.toggle('selected',key===id);
  }
  select(id){this.selected=id;this.highlight(id);}
  hit(point){
    if(this.failed)return null;
    const layers=PROJECT_LAYERS.filter(id=>this.map.getLayer(id));
    if(!layers.length)return null;
    return this.map.queryRenderedFeatures(point,{layers}).find(f=>f.properties?.projectId)?.properties.projectId||null;
  }
  fail(){this.failed=true;this.removeNative();this.publish();}
  removeNative(){
    this.cancelAnimation();
    for(const id of [...PROJECT_LAYERS].reverse())if(this.map.getLayer(id))this.map.removeLayer(id);
    if(this.map.getLayer('sim-veil'))this.map.removeLayer('sim-veil');
    for(const id of [PROJECT_SOURCE,'sim-veil'])if(this.map.getSource(id))this.map.removeSource(id);
    this.key=null;
  }
  clear(){this.states=[];this.key=null;this.cancelAnimation();for(const item of this.markers.values())item.marker.remove();this.markers.clear();this.map.getSource(PROJECT_SOURCE)?.setData(empty());this.summary=false;this.setSummary(false);}
  destroy(){this.clear();this.removeNative();}
}
