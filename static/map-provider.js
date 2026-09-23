/** Provider configuration only. Also update app.py CSP when changing hosts. */
export const provider=Object.freeze({
  name:'OpenFreeMap',libraryVersion:'5.6.2',
  script:'/vendor/maplibre/maplibre-gl-csp.js',worker:'/vendor/maplibre/maplibre-gl-csp-worker.js',
  styles:{light:'https://tiles.openfreemap.org/styles/positron',dark:'https://tiles.openfreemap.org/styles/dark'},
  building:{source:'openmaptiles',sourceLayer:'building',height:'render_height',base:'render_min_height'},
  camera:{center:[71.430,51.153],zoom:11.45,bearing:0,pitch:0},
});
export async function loadProviderStyle(theme,signal){
  const response=await fetch(provider.styles[theme],{signal});
  if(!response.ok)throw new Error(`Map style: HTTP ${response.status}`);
  const style=await response.json();
  if(style.version!==8||!style.sources||!Array.isArray(style.layers))throw new Error('Invalid map style');
  style.layers=style.layers.filter(layer=>layer.type!=='fill-extrusion');
  // A restrained local palette preserves the identity in both provider styles.
  // Geometry, attribution, filters and source data are never replaced here.
  const css=getComputedStyle(document.documentElement),color=name=>css.getPropertyValue(`--map-${name}`).trim();
  for(const layer of style.layers){
    layer.paint||={};const p=layer.paint;
    if(layer.type==='background')p['background-color']=color('land');
    if(layer.id==='water')p['fill-color']=color('water');
    if(layer.id==='waterway')p['line-color']=color('water');
    if(layer.id==='landuse_residential')p['fill-color']=color('urban');
    if(['landuse_park','landcover_wood'].includes(layer.id))p['fill-color']=color('park');
    if(layer.id==='building'){p['fill-color']=color('building');p['fill-outline-color']=color('road-edge');}
    if(layer.type==='line'&&/highway|road/.test(layer.id)){
      p['line-color']=color(/casing|subtle/.test(layer.id)?'road-edge':'road');
    }
    if(layer.type==='symbol'&&layer.layout?.['text-field']){
      p['text-color']=color('label');p['text-halo-color']=color('land');
    }
  }
  return style;
}
