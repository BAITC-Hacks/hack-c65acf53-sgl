/** Hand-authored provisional GAME sectors, not administrative boundaries.
 * Replace this registry with verified GeoJSON later. Never derive game rules
 * from the basemap. Points represent districts, not real sites or addresses.
 * Coordinates: [longitude, latitude]. Backend names must remain exact.
 */
export const geographyVersion = 'provisional-urban-sectors-v1';
export const districts = [
  {id:'saryarka',backendName:'Сарыарка',center:[71.387,51.197],bounds:[[71.325,51.170],[71.430,51.235]],ring:[[71.325,51.170],[71.405,51.170],[71.430,51.191],[71.430,51.235],[71.325,51.235],[71.325,51.170]]},
  {id:'baikonur',backendName:'Байконур',center:[71.470,51.200],bounds:[[71.430,51.175],[71.515,51.235]],ring:[[71.430,51.175],[71.515,51.175],[71.515,51.235],[71.430,51.235],[71.430,51.175]]},
  {id:'almaty',backendName:'Алматы',center:[71.512,51.151],bounds:[[71.470,51.105],[71.590,51.175]],ring:[[71.470,51.145],[71.510,51.105],[71.590,51.105],[71.590,51.175],[71.470,51.175],[71.470,51.145]]},
  {id:'nura',backendName:'Нура',center:[71.374,51.135],bounds:[[71.300,51.085],[71.425,51.170]],ring:[[71.300,51.085],[71.410,51.085],[71.425,51.137],[71.405,51.170],[71.325,51.170],[71.300,51.145],[71.300,51.085]]},
  {id:'yesil',backendName:'Есиль',center:[71.438,51.111],bounds:[[71.410,51.060],[71.510,51.145]],ring:[[71.410,51.060],[71.510,51.060],[71.510,51.105],[71.470,51.145],[71.425,51.137],[71.410,51.085],[71.410,51.060]]},
];
export const districtById=Object.fromEntries(districts.map(d=>[d.id,d]));
export const districtByName=Object.fromEntries(districts.map(d=>[d.backendName,d]));
export const districtGeoJSON={type:'FeatureCollection',features:districts.map(d=>({type:'Feature',id:d.id,properties:{id:d.id,backendName:d.backendName,provisional:true},geometry:{type:'Polygon',coordinates:[d.ring]}}))};
export function representativePosition(name,index=0,kind='issue'){
  const d=districtByName[name];
  if(!d)return [71.443+index*.007,51.163];
  const offsets=kind==='project'?[[-.012,-.009],[.002,-.010],[.014,-.006],[-.010,-.015],[.006,-.015]]:[[-.012,.003],[.012,.001],[0,.013],[-.017,.016]];
  const [x,y]=offsets[index%offsets.length];return [d.center[0]+x,d.center[1]+y];
}
