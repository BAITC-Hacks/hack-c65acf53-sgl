/** Symbolic SIMULATION geometry, never an actual site, route, height or coverage.
 * Rules, lag and effects come exclusively from the server's project catalog.
 * This registry describes appearance only. Geometry is independent of plan order.
 */
import {districts,districtByName} from './game-geography.js';

export const visualTypes=Object.freeze({M1:'bus',M2:'traffic',M3:'rail',M4:'park',M5:'air',M6:'greening',M7:'school',M8:'clinic',M9:'sport',M10:'lighting',M11:'crossing',M12:'digital',M13:'utilities',M14:'response'});
const cache=new Map();
const offset=(center,x,y)=>[center[0]+x,center[1]+y];
export function projectPosition(id,name=null){
  const slot=Number(id.slice(1))-1;
  if(!Number.isInteger(slot)||slot<0||slot>=14)throw new Error('Unknown project visual');
  const center=name?districtByName[name]?.center:[71.444,51.169];
  if(!center)throw new Error('Unknown district');
  // Fourteen exclusive, fixed slots, south of the district label/issue anchors.
  return name?offset(center,((slot%4)-1.5)*.011,-.006-Math.floor(slot/4)*.005)
    :offset(center,(slot%4)*.009,Math.floor(slot/4)*.007);
}
export function projectStates(plan,measures,quarter,result,{before=false,scenario='main'}={}){
  if(before)return [];
  return plan.filter(s=>measures[s.measure_id]&&(measures[s.measure_id].scope==='Город'||districtByName[s.district])).map(s=>{
    const m=measures[s.measure_id],activationQuarter=m.lag+1,district=m.scope==='Город'?null:s.district;
    return {projectId:s.measure_id,district,scenario,activationQuarter,visualType:visualTypes[s.measure_id]||'service',
      state:result&&quarter===8?'completed':quarter>=activationQuarter?'active':'planned',
      coordinates:projectPosition(s.measure_id,district),name:m.name,indicators:Object.keys(m.effects)};
  }).sort((a,b)=>Number(a.projectId.slice(1))-Number(b.projectId.slice(1)));
}
export function projectStatus(project,quarter){
  return project.state==='planned'?`Запланировано · Эффект с Q${project.activationQuarter}`
    :project.state==='active'&&quarter===project.activationQuarter?`Начинается · Q${quarter}`
    :`Работает с Q${project.activationQuarter}${project.state==='completed'?' · Итог Q8':''}`;
}

export function projectGeometry(project){
  const key=`${project.projectId}:${project.district||'city'}`;
  if(cache.has(key))return cache.get(key);
  const features=[],anchor=project.coordinates;
  const add=(type,coordinates,role,extra={})=>features.push({type:'Feature',id:`${key}:${features.length}`,
    properties:{projectId:project.projectId,district:project.district||'',role,simulated:true,...extra},geometry:{type,coordinates}});
  const line=(c,xy,role='route')=>add('LineString',xy.map(([x,y])=>offset(c,x,y)),role);
  const ring=(c,w,h)=>[[-w,-h],[w,-h],[w,h],[-w,h],[-w,-h]].map(([x,y])=>offset(c,x,y));
  const patch=(c,w,h,role='building',height=22)=>add('Polygon',[ring(c,w,h)],role,{height});
  const dot=(c,role='node',extra={})=>add('Point',c,role,extra);
  const trees=(c,count=6)=>{
    for(let i=0;i<count;i++){
      const p=offset(c,((i%3)-1)*.0026,(Math.floor(i/3)-.5)*.0024);
      dot(p,'tree',{delay:(i%3)*.15});patch(p,.00055,.0004,'canopy',14);
    }
  };
  switch(project.visualType){
    case 'bus':
    case 'rail': {
      const xy=[[-.010,-.002],[-.004,-.002],[.002,.002],[.010,.002]];
      line(anchor,xy);
      for(const [x,y] of xy)dot(offset(anchor,x,y),'station');
      if(project.visualType==='rail')line(offset(anchor,0,-.0007),xy,'rail');
      break;
    }
    case 'traffic':
      for(const d of districts){const c=projectPosition(project.projectId,d.backendName);dot(c,'signal');line(c,[[-.002,0],[.002,0]],'network');line(c,[[0,-.0012],[0,.0012]],'network');}
      break;
    case 'park':
      patch(anchor,.0065,.0039,'green',1);trees(anchor,9);line(anchor,[[-.005,-.002],[0,0],[.005,.002]],'path');break;
    case 'greening':
      for(const d of districts){const c=projectPosition(project.projectId,d.backendName);patch(c,.0038,.0025,'green',1);trees(c,3);}break;
    case 'air':
      patch(anchor,.008,.0045,'haze',0);
      for(let i=0;i<5;i++)dot(offset(anchor,(i-2)*.003,.001*(i%2)),'haze');
      line(anchor,[[-.008,-.004],[.008,-.004]],'network');break;
    case 'school':
      patch(offset(anchor,-.0018,0),.0011,.0025);patch(offset(anchor,.0012,.0016),.002,.0009);
      patch(offset(anchor,.0015,-.001),.0022,.0013,'court',0);break;
    case 'clinic': {
      const xy=[[-.001,-.003],[.001,-.003],[.001,-.001],[.004,-.001],[.004,.001],[.001,.001],[.001,.003],[-.001,.003],[-.001,.001],[-.004,.001],[-.004,-.001],[-.001,-.001],[-.001,-.003]];
      add('Polygon',[xy.map(([x,y])=>offset(anchor,x,y))],'building',{height:26});break;
    }
    case 'sport':
      patch(anchor,.004,.0024,'court',0);line(anchor,[[0,-.0024],[0,.0024]],'path');
      for(const x of [-.003,.003])line(anchor,[[x,-.001],[x,.001]],'path');dot(anchor,'court-center');break;
    case 'lighting':
      line(anchor,[[-.008,-.002],[0,.001],[.008,.002]],'lit-route');
      for(let i=0;i<4;i++)dot(offset(anchor,-.008+i*.0053,-.002+i*.0013),'lamp');break;
    case 'crossing':
      for(const x of [-.005,.005]){
        const c=offset(anchor,x,0);patch(c,.002,.0018,'safety',0);
        for(let i=0;i<4;i++)line(c,[[-.0012,-.001+i*.00065],[.0012,-.001+i*.00065]],'crosswalk');
      }break;
    case 'digital': {
      const nodes=districts.map(d=>projectPosition(project.projectId,d.backendName));
      nodes.forEach(c=>dot(c,'service'));add('LineString',nodes,'digital');break;
    }
    case 'utilities':
      line(anchor,[[-.009,0],[.009,0]],'network');
      for(const x of [-.006,0,.006]){line(anchor,[[x,-.003],[x,.003]],'network');dot(offset(anchor,x,0),'service');}break;
    case 'response':
      for(const d of districts)dot(projectPosition(project.projectId,d.backendName),'response');break;
    default: dot(anchor);
  }
  // A selectable halo guarantees presence at city overview even for small footprints.
  dot(anchor,'anchor');cache.set(key,features);return features;
}
