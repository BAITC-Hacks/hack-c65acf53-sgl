import {provider,loadProviderStyle} from './map-provider.js';
import {districts,districtById,districtByName,districtGeoJSON,representativePosition} from './game-geography.js';
import {CityMap as LegacyCityMap,icon,measureIcons} from './city-map.js';

const collection=features=>({type:'FeatureCollection',features});
const point=(coordinates,properties)=>({type:'Feature',geometry:{type:'Point',coordinates},properties});
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
let libraryPromise;
function loadLibrary(){
  if(window.maplibregl)return Promise.resolve(window.maplibregl);
  if(!libraryPromise)libraryPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=provider.script;
    script.onload=()=>resolve(window.maplibregl);
    script.onerror=()=>{script.remove();libraryPromise=null;reject(new Error('MapLibre unavailable'));};
    document.head.append(script);
  });
  return libraryPromise;
}
function palette(){
  const styles=getComputedStyle(document.documentElement);
  return Object.fromEntries(['bg','surface-elevated','text','text-muted','border','accent','danger','warning','success','district'].map(k=>[k,styles.getPropertyValue(`--${k}`).trim()]));
}

/** Renderer boundary. Application state is always retained independently of tiles.
 * A theme/style change rehydrates sources and layers on the SAME MapLibre instance.
 * This class displays supplied scores; it never calculates or projects them.
 */
export class MapAdapter{
  constructor(container,callbacks){
    this.container=container;this.callbacks=callbacks;this.theme=window.AkimTheme.get();this.presentation='2d';this.state=null;this.map=null;this.legacy=null;this.labels=[];this.projects=[];this.epoch=0;this.hovered=null;this.selected=null;this.ready=false;this.projectKey='';this.issueKey='';
    if(new URLSearchParams(location.search).get('legacyMap')==='1')this.useLegacy();else this.start();
  }
  status(value){this.callbacks.status?.(value);}
  async start(){
    this.status('loading');const epoch=++this.epoch;
    try{
      const lib=await loadLibrary();if(epoch!==this.epoch)return;
      this.lib=lib;lib.setWorkerUrl(provider.worker);
      this.map=new lib.Map({container:this.container,style:this.emptyStyle(),...provider.camera,attributionControl:false,maxPitch:65,minZoom:9,maxZoom:18,renderWorldCopies:false});
      this.container.dataset.renderer='maplibre';
      this.map.addControl(new lib.AttributionControl({compact:true}),'bottom-right');
      this.map.getCanvas().setAttribute('aria-label','Карта Астаны. Для выбора района с клавиатуры используйте кнопку «Выбрать район».');
      this.popup=new lib.Popup({closeButton:false,closeOnClick:false,offset:16});
      this.map.on('style.load',()=>{
        if(this.legacy)return;
        this.installLayers();this.ready=true;this.update(this.state);this.applyPresentation(false);
      });
      this.map.on('click',e=>this.selectAt(e));
      this.map.on('mousemove',e=>this.hoverAt(e));
      this.map.getCanvas().addEventListener('mouseleave',()=>this.clearHover());
      this.map.on('error',()=>{
        // A tile/glyph error must never invalidate the plan or UI.
        if(this.hostedStyle){this.tileFailed=true;this.status('error');}
      });
      this.map.on('idle',()=>{
        if(this.hostedStyle&&!this.tileFailed){clearTimeout(this.loadTimer);this.status('ready');}
      });
      this.map.on('moveend',()=>this.publishCamera());
      this.resizeObserver=new ResizeObserver(()=>this.map?.resize());this.resizeObserver.observe(this.container);
      this.addDistrictLabels();this.publishCamera();await this.setTheme(this.theme);
    }catch(_){this.status('error');}
  }
  emptyStyle(){return {version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':palette().bg}}]};}
  async setTheme(theme){
    this.theme=theme;
    if(this.legacy){this.status('legacy');return;}
    if(!this.map)return;
    this.controller?.abort();const controller=new AbortController();this.controller=controller;const epoch=++this.epoch;
    this.status('loading');this.hostedStyle=false;this.tileFailed=false;clearTimeout(this.loadTimer);
    const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const style=await loadProviderStyle(theme,controller.signal);
      if(epoch!==this.epoch||!this.map)return;
      this.ready=false;this.hostedStyle=true;
      this.map.setStyle(style,{diff:false});
      this.loadTimer=setTimeout(()=>{if(epoch===this.epoch)this.status('error');},20000);
    }catch(_){
      if(epoch!==this.epoch||!this.map)return;
      this.ready=false;this.hostedStyle=false;this.map.setStyle(this.emptyStyle(),{diff:false});this.status('error');
    }finally{clearTimeout(timeout);}
  }
  installLayers(){
    const m=this.map,p=palette();this.issueKey='';this.projectKey='';
    if(m.getSource('game-districts'))return;
    m.addSource('game-districts',{type:'geojson',data:districtGeoJSON});
    m.addLayer({id:'game-district-fill',type:'fill',source:'game-districts',paint:{'fill-color':p.district,'fill-opacity':['case',['boolean',['feature-state','selected'],false],.13,['boolean',['feature-state','hover'],false],.07,.018]}});
    m.addLayer({id:'game-district-line',type:'line',source:'game-districts',paint:{'line-color':['case',['boolean',['feature-state','selected'],false],p.accent,p.district],'line-width':['case',['boolean',['feature-state','selected'],false],2,1],'line-opacity':.65,'line-dasharray':[5,4]}});
    const b=provider.building;
    // Provider heights only. Missing heights remain flat; no fabricated landmarks.
    if(m.getSource(b.source))m.addLayer({id:'game-buildings',type:'fill-extrusion',source:b.source,'source-layer':b.sourceLayer,minzoom:13,filter:['!=',['get','hide_3d'],true],layout:{visibility:this.presentation==='3d'?'visible':'none'},paint:{'fill-extrusion-color':this.theme==='dark'?'#496258':'#d2d5c9','fill-extrusion-height':['max',0,['to-number',['get',b.height],0]],'fill-extrusion-base':['max',0,['to-number',['get',b.base],0]],'fill-extrusion-opacity':.85}});
    m.addSource('game-issues',{type:'geojson',data:collection([]),cluster:true,clusterRadius:35,clusterMaxZoom:12});
    m.addLayer({id:'game-clusters',type:'circle',source:'game-issues',filter:['has','point_count'],paint:{'circle-color':p.warning,'circle-radius':17,'circle-stroke-color':p['surface-elevated'],'circle-stroke-width':2}});
    m.addLayer({id:'game-issues',type:'circle',source:'game-issues',filter:['!', ['has','point_count']],paint:{'circle-color':['match',['get','severity'],'critical',p.danger,'high',p.warning,'normal',p.success,p.accent],'circle-radius':9,'circle-stroke-color':p['surface-elevated'],'circle-stroke-width':2}});
    if(m.getStyle().glyphs){
      m.addLayer({id:'game-cluster-labels',type:'symbol',source:'game-issues',filter:['has','point_count'],layout:{'text-field':['to-string',['get','point_count_abbreviated']],'text-font':['Noto Sans Regular'],'text-size':11,'text-allow-overlap':true},paint:{'text-color':p['surface-elevated']}});
      m.addLayer({id:'game-issue-labels',type:'symbol',source:'game-issues',filter:['!', ['has','point_count']],layout:{'text-field':'!','text-font':['Noto Sans Regular'],'text-size':11,'text-allow-overlap':true},paint:{'text-color':p['surface-elevated']}});
    }
    m.addSource('game-project-effects',{type:'geojson',data:collection([])});
    m.addLayer({id:'game-project-effects',type:'circle',source:'game-project-effects',paint:{'circle-color':p.success,'circle-radius':['interpolate',['linear'],['zoom'],10,13,15,40],'circle-opacity':.1,'circle-stroke-color':p.success,'circle-stroke-opacity':.22,'circle-stroke-width':1}},'game-issues');
    this.selected=null;this.setSelectedDistrict(districtByName[this.state?.district]?.id||null);
  }
  addDistrictLabels(){
    this.labels= districts.map(d=>{
      const button=document.createElement('button');button.className='map-district-label';button.textContent=d.backendName;button.dataset.mapDistrict=d.id;button.setAttribute('aria-label',`Район ${d.backendName}`);
      button.onclick=e=>{e.stopPropagation();this.callbacks.district(d.id);};
      button.onmouseenter=()=>this.showDistrictTooltip(d.id,d.center);
      button.onmouseleave=()=>this.popup?.remove();
      const marker=new this.lib.Marker({element:button,anchor:'bottom'}).setLngLat([d.center[0],d.center[1]+.009]).addTo(this.map);
      return {id:d.id,marker,button};
    });
  }
  update(state){
    if(state)this.state=state;if(!this.state)return;
    if(this.legacy){this.legacy.update(this.state);return;}
    if(!this.map||!this.ready)return;
    this.setSelectedDistrict(districtByName[this.state.district]?.id||null);
    this.updateIssueMarkers(this.state.appeals);
    this.updateProjectMarkers(this.state.plan,this.state.measures,this.state.quarter);
    this.container.dataset.projectCount=this.state.plan.length;
    this.container.dataset.issueCount=this.state.appeals.length;
  }
  setSelectedDistrict(id){
    if(!this.map?.getSource('game-districts'))return;
    if(this.selected)this.map.setFeatureState({source:'game-districts',id:this.selected},{selected:false});
    this.selected=id;if(id)this.map.setFeatureState({source:'game-districts',id},{selected:true});
    for(const label of this.labels){label.button.classList.toggle('selected',label.id===id);label.button.setAttribute('aria-pressed',String(label.id===id));}
  }
  updateIssueMarkers(appeals){
    const source=this.map?.getSource('game-issues');if(!source)return;
    const key=JSON.stringify(appeals.map(a=>[a.id,a.severity,a.status,a.value]));if(key===this.issueKey)return;this.issueKey=key;
    const count={};source.setData(collection(appeals.map(a=>{
      const i=count[a.district]||0;count[a.district]=i+1;
      return point(representativePosition(a.district,i),{id:a.id,district:districtByName[a.district].id,severity:a.severity,status:a.status});
    })));
  }
  updateProjectMarkers(plan,measures,quarter){
    const key=JSON.stringify([plan,quarter]);if(key===this.projectKey)return;this.projectKey=key;
    this.projects.forEach(marker=>marker.remove());this.projects=[];const counts={},effects=[];let citywide=0;
    for(const s of plan){
      const measure=measures[s.measure_id],name=measure.scope==='Город'?null:s.district;if(name&&!districtByName[name])continue;
      const i=name?(counts[name]||0):citywide++;if(name)counts[name]=i+1;
      const position=representativePosition(name,i,'project'),active=quarter>measure.lag;
      const button=document.createElement('button');button.className=`project-marker ${active?'active':'pending'} ${name?'':'citywide'}`;button.innerHTML=icon(measureIcons[s.measure_id]);
      button.setAttribute('aria-label',`${measure.name} · ${name||'Весь город'} · ${active?'работает':'в плане'}. Условное размещение.`);button.title=button.getAttribute('aria-label');button.dataset.project=s.measure_id;
      button.onclick=e=>{e.stopPropagation();this.callbacks.project(s.measure_id,name);};
      this.projects.push(new this.lib.Marker({element:button}).setLngLat(position).addTo(this.map));
      if(active)effects.push(point(position,{id:s.measure_id}));
    }
    this.map.getSource('game-project-effects')?.setData(collection(effects));
  }
  selectAt(e){
    if(!this.ready)return;
    const layers=['game-clusters','game-issues','game-district-fill'].filter(id=>this.map.getLayer(id));
    const features=this.map.queryRenderedFeatures(e.point,{layers});
    const cluster=features.find(f=>f.layer.id==='game-clusters');
    if(cluster){this.map.getSource('game-issues').getClusterExpansionZoom(cluster.properties.cluster_id).then(zoom=>this.map?.easeTo({center:cluster.geometry.coordinates,zoom,duration:reduced()?0:450})).catch(()=>{});return;}
    const issue=features.find(f=>f.layer.id==='game-issues');if(issue){this.callbacks.issue(issue.properties.id);return;}
    const district=features.find(f=>f.layer.id==='game-district-fill');if(district)this.callbacks.district(district.properties.id);
  }
  hoverAt(e){
    if(!this.ready||!this.map.getLayer('game-district-fill'))return;
    const [f]=this.map.queryRenderedFeatures(e.point,{layers:['game-district-fill']});
    const id=f?.properties.id;
    if(id!==this.hovered){this.clearHover();this.hovered=id;if(id)this.map.setFeatureState({source:'game-districts',id},{hover:true});}
    this.map.getCanvas().style.cursor=id?'pointer':'';
    if(id)this.showDistrictTooltip(id,e.lngLat);else this.popup?.remove();
  }
  showDistrictTooltip(id,position){
    const d=districtById[id],score=this.state?.scores.district_scores[d?.backendName];if(score===undefined)return;
    const content=document.createElement('div'),name=document.createElement('strong'),number=document.createElement('span');name.textContent=d.backendName;number.textContent=score.toLocaleString('ru-RU',{maximumFractionDigits:2});content.append(name,number);this.popup.setLngLat(position).setDOMContent(content).addTo(this.map);
  }
  clearHover(){if(this.hovered&&this.map?.getSource('game-districts'))this.map.setFeatureState({source:'game-districts',id:this.hovered},{hover:false});this.hovered=null;this.popup?.remove();}
  focusDistrict(id){
    const d=districtById[id];if(!d)return;
    if(this.legacy)return;
    if(this.map){const mobile=innerWidth<600;this.map.fitBounds(d.bounds,{padding:mobile?{top:90,bottom:innerHeight*.57,left:35,right:60}:{top:120,bottom:120,left:400,right:110},retainPadding:false,maxZoom:13.4,duration:reduced()?0:650});}
  }
  setPresentation(mode){this.presentation=mode==='3d'?'3d':'2d';this.applyPresentation(true);}
  applyPresentation(animate){
    if(!this.map)return;
    if(this.map.getLayer('game-buildings'))this.map.setLayoutProperty('game-buildings','visibility',this.presentation==='3d'?'visible':'none');
    this.map.easeTo({pitch:this.presentation==='3d'?52:0,duration:animate&&!reduced()?700:0});
    this.container.dataset.presentation=this.presentation;
  }
  zoom(factor){if(this.legacy)this.legacy.zoom(factor);else if(this.map)this.map.easeTo({zoom:this.map.getZoom()+Math.log2(factor),pitch:this.presentation==='3d'?52:0,duration:reduced()?0:220});}
  resetView(){if(this.legacy)this.legacy.reset();else this.map?.easeTo({...provider.camera,pitch:this.presentation==='3d'?52:0,padding:0,duration:reduced()?0:700});}
  publishCamera(){if(this.map)this.container.dataset.camera=JSON.stringify({center:this.map.getCenter().toArray(),zoom:this.map.getZoom(),pitch:this.map.getPitch(),bearing:this.map.getBearing()});}
  retry(){
    if(this.legacy){this.legacy=null;this.container.replaceChildren();this.start();}else if(this.map)this.setTheme(this.theme);else this.start();
  }
  useLegacy(){
    ++this.epoch;this.controller?.abort();clearTimeout(this.loadTimer);this.resizeObserver?.disconnect();this.popup?.remove();this.projects.forEach(m=>m.remove());this.labels.forEach(l=>l.marker.remove());this.projects=[];this.labels=[];this.map?.remove();this.map=null;this.ready=false;
    this.container.replaceChildren();const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('legacy-map');svg.setAttribute('viewBox','0 0 1200 760');svg.setAttribute('role','group');svg.setAttribute('aria-label','Схематичная резервная карта');this.container.append(svg);
    this.legacy=new LegacyCityMap(svg,{...this.callbacks,hover:()=>{}});this.container.dataset.renderer='legacy';this.status('legacy');this.update(this.state);
  }
}
