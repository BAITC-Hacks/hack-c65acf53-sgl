// A local, interactive 2.5D city. Geometry is illustrative, not administrative GIS.
export const geometry = {
  'Сарыарка': {points:[[35,60],[345,60],[345,295],[235,370],[35,405]], label:[145,104], anchor:[174,238]},
  'Байконур': {points:[[353,60],[670,60],[670,300],[548,347],[350,288]], label:[449,102], anchor:[495,209]},
  'Алматы': {points:[[679,60],[1080,60],[1080,348],[872,370],[675,300]], label:[823,100], anchor:[873,218]},
  'Нура': {points:[[35,465],[235,425],[350,366],[520,424],[535,680],[35,680]], label:[178,639], anchor:[235,518]},
  'Есиль': {points:[[545,421],[650,360],[853,433],[1080,407],[1080,680],[547,680]], label:[798,639], anchor:[786,525]},
};
const paths = {
  car:'M3 15V9l2-5h14l2 5v6M3 10h18M5 15v3m14-3v3M6 13h2m8 0h2',
  bus:'M5 4h14v13H5zM5 11h14M9 4v7M7 17v3m10-3v3M7 14h1m8 0h1',
  tree:'M12 2L5 11h3l-5 6h8v5h2v-5h8l-5-6h3z',
  air:'M3 8h12c5 0 5-5 1-5M3 12h16c4 0 4 5 0 5M3 16h8',
  school:'M3 10l9-7 9 7M5 9v11h14V9M10 20v-6h4v6M12 3V1m-5 11h1m8 0h1',
  clinic:'M5 3h14v18H5zM9 8h6m-3-3v6M9 21v-5h6v5',
  light:'M12 22V8M7 8h10l-2-5H9zM5 4L3 2m16 2 2-2M4 9H1m19 0h3',
  crossing:'M4 4h16v16H4zM6 8h12M6 12h12M6 16h12',
  pipe:'M3 8h6V3h6v5h6v7h-6v6H9v-6H3z',
  service:'M6 2h12v20H6zM9 5h6m-5 13h4M9 11l2 2 4-4',
  train:'M7 3h10l2 4v10H5V7zM5 10h14M8 20l-2 2m10-2 2 2M8 14h1m6 0h1',
  sport:'M3 5h18v14H3zM12 5v14M3 9h4v6H3m18-6h-4v6h4',
  truck:'M2 6h12v11H2zM14 10h5l3 4v3h-8M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4m12 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
};
export const measureIcons = {M1:'bus',M2:'light',M3:'train',M4:'tree',M5:'air',M6:'tree',M7:'school',M8:'clinic',M9:'sport',M10:'light',M11:'crossing',M12:'service',M13:'pipe',M14:'truck'};
const indicatorIcons = {T1:'car',T2:'bus',E1:'tree',E2:'air',S1:'school',S2:'clinic',B1:'light',B2:'crossing',C1:'pipe',C2:'service'};
export function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.service}"/></svg>`; }
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Oblique projection with vertical building elevation.
const P = (x,y,z=0) => [36+x*.88+y*.25,107+y*.77-x*.10-z];
const pts = points => points.map(p=>P(...p).map(v=>v.toFixed(1)).join(',')).join(' ');
const line = points => 'M'+points.map(p=>P(...p).join(',')).join('L');
const poly = (points,attrs='') => `<polygon points="${pts(points)}" ${attrs}/>`;
const river = 'M-60 467 C150 490 233 280 382 333 S527 437 639 347 S857 474 1130 353';
const highways = [
  [[20,160],[1090,160]], [[10,288],[1090,288]], [[30,503],[1090,503]], [[20,610],[1090,610]],
  [[130,45],[130,710]], [[332,45],[332,710]], [[551,40],[551,710]], [[731,40],[731,710]], [[962,40],[962,710]],
  [[35,80],[1040,655]], [[380,55],[725,660]],
];
function building(x,y,w,d,h,shade=0){
  const top = [[x,y,h],[x+w,y,h],[x+w,y+d,h],[x,y+d,h]];
  let s=poly([[x+7,y+7],[x+w+12,y+7],[x+w+12,y+d+12],[x+7,y+d+12]],'fill="#0d2923" opacity=".45"');
  s+=poly([[x,y+d],[x+w,y+d],[x+w,y+d,h],[x,y+d,h]],`fill="${shade?'#2e594a':'#29584b'}" stroke="#759c7d" stroke-opacity=".45" stroke-width=".7"`);
  s+=poly([[x+w,y],[x+w,y+d],[x+w,y+d,h],[x+w,y,h]],'fill="#204d40" stroke="#749a7c" stroke-opacity=".45" stroke-width=".7"');
  s+=poly(top,`fill="${shade?'#527966':'#406f5c'}" stroke="#a1bc8c" stroke-opacity=".55" stroke-width=".7"`);
  if(w>15&&d>12)s+=poly([[x+4,y+4,h+.5],[x+w-4,y+4,h+.5],[x+w-4,y+d-4,h+.5],[x+4,y+d-4,h+.5]],'fill="none" stroke="#a1bc8c" stroke-opacity=".32" stroke-width=".6"');
  for(let z=5;z<h-2;z+=7)s+=`<path d="${line([[x+3,y+d,z],[x+w-3,y+d,z]])}" fill="none" stroke="#9ac397" stroke-opacity=".3" stroke-dasharray="3 4" stroke-width="1"/>`;
  return s;
}
function tree(x,y,r=5){const [sx,sy]=P(x,y);return `<ellipse cx="${sx+3}" cy="${sy+2}" rx="${r+2}" ry="${r*.5}" fill="#0c2d22" opacity=".6"/><path d="M${sx} ${sy}v-8" stroke="#82996a"/><ellipse cx="${sx}" cy="${sy-7}" rx="${r}" ry="${r*.9}" fill="#4a7751" stroke="#9db57e" stroke-width=".6"/>`;}
function landmark(x,y,type,label){
  const [sx,sy]=P(x,y);let shape='';
  if(type==='tower')shape=`<ellipse cx="${sx}" cy="${sy}" rx="30" ry="11" fill="#315d47" stroke="#adc48a"/><path d="M${sx-10} ${sy-2}L${sx-4} ${sy-66}M${sx+10} ${sy-2}L${sx+4} ${sy-66}M${sx} ${sy}V${sy-70}" stroke="#c4cba0" stroke-width="2"/><circle cx="${sx}" cy="${sy-73}" r="17" fill="url(#gold-orb)" stroke="#e1d0a0"/><path d="M${sx-13} ${sy-74}h26M${sx} ${sy-90}v34" stroke="#eee1b4" stroke-opacity=".5"/>`;
  if(type==='tent')shape=`<ellipse cx="${sx}" cy="${sy}" rx="36" ry="18" fill="#285244" stroke="#88b69c"/><path d="M${sx-36} ${sy}Q${sx-5} ${sy-21} ${sx+9} ${sy-65}Q${sx+20} ${sy-17} ${sx+36} ${sy}Q${sx} ${sy+25} ${sx-36} ${sy}" fill="#477b65" stroke="#a2c6a2"/><path d="M${sx+9} ${sy-65}L${sx-14} ${sy+14}m23-79L${sx+13} ${sy+14}" stroke="#b2caae" stroke-opacity=".5"/>`;
  if(type==='dome')shape=building(x-22,y-18,44,36,12)+`<path d="M${sx-22} ${sy-14}Q${sx} ${sy-65} ${sx+22} ${sy-14}Z" fill="#779981" stroke="#c0c69e"/><path d="M${sx} ${sy-45}v-12" stroke="#d1c69a"/>`;
  if(type==='stadium')shape=`<ellipse cx="${sx}" cy="${sy-6}" rx="43" ry="26" fill="#476f58" stroke="#99b687" stroke-width="4"/><ellipse cx="${sx}" cy="${sy-8}" rx="29" ry="17" fill="#284f37" stroke="#749564"/>${poly([[x-20,y-12],[x+20,y-12],[x+20,y+12],[x-20,y+12]],'fill="none" stroke="#a2b581" stroke-width=".8"')}`;
  return shape+`<text x="${sx}" y="${sy+32}" text-anchor="middle" class="map-landmark-label">${label}</text>`;
}
function staticCity(){
  let ground='<g class="map-decoration">';
  for(let x=0;x<=1120;x+=40)ground+=`<path d="${line([[x,0],[x,740]])}" stroke="#588769" stroke-opacity=".10" stroke-width=".5"/>`;
  for(let y=0;y<=740;y+=40)ground+=`<path d="${line([[0,y],[1120,y]])}" stroke="#588769" stroke-opacity=".10" stroke-width=".5"/>`;
  ground+='</g><g id="district-layer">'+Object.entries(geometry).map(([name,g])=>poly(g.points,`class="district-region" data-district="${name}" role="button" tabindex="0" aria-label="Район ${name}"`)).join('')+'</g>';
  let decor='<g class="map-decoration">';
  // River uses the same world-to-screen matrix as the district geometry.
  decor+=`<g transform="matrix(.88 -.10 .25 .77 36 107)"><path d="${river}" fill="none" stroke="#62816a" stroke-width="69"/><path d="${river}" fill="none" stroke="#163d35" stroke-width="63"/><path d="${river}" fill="none" stroke="#436e58" stroke-width="1" stroke-dasharray="5 22"/><path d="${river}" fill="none" stroke="#86aa81" stroke-width=".8" stroke-dasharray="60 160" transform="translate(0 19)"/></g>`;
  // Large roads and bridges. Minor lot streets are below the buildings.
  for(const points of highways){decor+=`<path d="${line(points)}" fill="none" stroke="#41624b" stroke-width="12"/><path d="${line(points)}" fill="none" stroke="#193c30" stroke-width="9"/><path d="${line(points)}" fill="none" stroke="#96ad77" stroke-opacity=".30" stroke-width=".6" stroke-dasharray="4 7"/>`;}
  const ring=[[65,155],[168,64],[922,64],[1045,195],[1045,568],[908,674],[158,674],[65,562],[65,155]];
  decor+=`<path d="${line(ring)}" fill="none" stroke="#678361" stroke-opacity=".45" stroke-width="10" stroke-linejoin="round"/><path d="${line(ring)}" fill="none" stroke="#284b37" stroke-width="7" stroke-linejoin="round"/>`;
  for(const [x,y] of [[130,442],[332,338],[731,369],[962,413]])decor+=poly([[x-9,y-43],[x+9,y-43],[x+9,y+43],[x-9,y+43]],'fill="#5b7660" stroke="#adc28d" stroke-width="1"')+`<path d="${line([[x,y-43],[x,y+43]])}" stroke="#d1c895" stroke-dasharray="4 5" stroke-width="1.5"/>`;
  const parks=[[395,520,82,65],[780,175,93,73],[80,550,85,45],[570,160,63,72]];
  for(const [x,y,w,h] of parks){decor+=poly([[x,y],[x+w,y],[x+w,y+h],[x,y+h]],'fill="#2c5838" stroke="#759663" stroke-width=".8"');for(let dx=8;dx<w;dx+=16)for(let dy=8;dy<h;dy+=16)decor+=tree(x+dx,y+dy,4);decor+=`<path d="${line([[x,y+h/2],[x+w,y+h/2]])}" stroke="#8aa976" stroke-width="2" opacity=".45"/>`;}
  const buildings=[];
  for(let y=86;y<651;y+=43)for(let x=92;x<1030;x+=47){
    if(highways.some(([a,b])=>{const dx=b[0]-a[0],dy=b[1]-a[1];return Math.abs(dy*x-dx*y+b[0]*a[1]-b[1]*a[0])/Math.hypot(dx,dy)<17;}))continue;
    // Wider river exclusion avoids placing buildings over the water.
    if(y>310&&y<465)continue;
    if(parks.some(([px,py,pw,ph])=>x>px-22&&x<px+pw+12&&y>py-18&&y<py+ph+10))continue;
    if([[681,528],[471,535],[869,544],[254,555]].some(([lx,ly])=>Math.hypot(x-lx,y-ly)<65))continue;
    const seed=(x*17+y*13)%101; const h=9+(seed%4)*7;const w=17+seed%13,d=14+(seed*3)%12;
    buildings.push({x,y,s:building(x,y,w,d,h,seed%3===0)});
    if(seed%3===0)buildings.push({x:x+25,y:y+10,s:building(x+25,y+10,12,20,h*.7)});
  }
  buildings.sort((a,b)=>(a.y*.77-a.x*.1)-(b.y*.77-b.x*.1));decor+=buildings.map(b=>b.s).join('');
  decor+=landmark(681,528,'tower','БАЙТЕРЕК')+landmark(471,535,'tent','ХАН ШАТЫР')+landmark(869,544,'dome','АКОРДА')+landmark(254,555,'stadium','АРЕНА');
  // Boulevard trees, planted embankments and a few traffic lights.
  for(let x=580;x<930;x+=18)decor+=tree(x,599,3);
  for(let x=155;x<1000;x+=45)decor+=tree(x,148,3);
  const [rx,ry]=P(567,387);decor+=`<text x="${rx}" y="${ry}" transform="rotate(8 ${rx} ${ry})" fill="#7eaa91" font-size="11" letter-spacing="8" font-family="Georgia,serif">ЕСИЛЬ</text>`;
  decor+='</g><g class="map-decoration traffic">';
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)for(let i=0;i<12;i++){const route=highways[i%highways.length];decor+=`<circle class="traffic-dot" r="1.7"><animateMotion dur="${14+i%5*3}s" begin="-${i*2}s" repeatCount="indefinite" path="${line(route)}"/></circle>`;}
  decor+='</g>';
  return ground+decor;
}
function projectEffect(id,x,y){
  if(id==='M1'||id==='M3'){const route=[[x-57,y+23],[x,y+23],[x+68,y+23]];return `<path d="${line(route)}" fill="none" stroke="${id==='M3'?'#f0d28c':'#b7d6a8'}" stroke-width="4"/>`+route.map(p=>{const [sx,sy]=P(...p);return `<circle cx="${sx}" cy="${sy}" r="3" fill="#f4e6af"/>`;}).join('');}
  if(id==='M4'||id==='M6')return poly([[x-25,y-15],[x+35,y-15],[x+35,y+25],[x-25,y+25]],'fill="#547641" stroke="#d0d99c" stroke-width="1"')+Array.from({length:8},(_,i)=>tree(x-18+i%4*14,y-6+Math.floor(i/4)*20,5)).join('');
  if(id==='M7'||id==='M8')return building(x-18,y-10,38,24,18,true)+poly([[x-18,y-10,18],[x+20,y-10,18],[x+20,y+14,18],[x-18,y+14,18]],'fill="#9c9855" stroke="#ebd490" stroke-width="1"');
  if(id==='M10'||id==='M2')return [-30,0,30].map(dx=>{const [sx,sy]=P(x+dx,y+18);return `<ellipse cx="${sx}" cy="${sy}" rx="14" ry="8" fill="#e9d88e" opacity=".18"/><path d="M${sx} ${sy}v-19h7" stroke="#e4d797" stroke-width="1.5"/><circle cx="${sx+7}" cy="${sy-19}" r="2" fill="#f8e8a1"/>`;}).join('');
  if(id==='M9')return poly([[x-28,y-14],[x+28,y-14],[x+28,y+18],[x-28,y+18]],'fill="#6f8145" stroke="#e0d396" stroke-width="1.5"')+`<path d="${line([[x,y-14],[x,y+18]])}" stroke="#e0d396"/>`;
  if(id==='M11')return Array.from({length:6},(_,i)=>poly([[x-19+i*7,y-5],[x-15+i*7,y-5],[x-15+i*7,y+16],[x-19+i*7,y+16]],'fill="#e0d6a3"')).join('');
  if(id==='M13')return `<path d="${line([[x-25,y-22],[x-25,y+25],[x+36,y+25]])}" fill="none" stroke="#b6cb9a" stroke-width="4" stroke-dasharray="7 3"/>`;
  const [sx,sy]=P(x,y);return `<ellipse cx="${sx}" cy="${sy}" rx="30" ry="14" fill="none" stroke="#b6d6a0" stroke-width="2" stroke-dasharray="4 4"/>`;
}
export class CityMap {
  constructor(svg,callbacks){
    this.svg=svg;this.callbacks=callbacks;this.view=[0,0,1200,760];this.drag=null;this.suppressClick=false;
    svg.innerHTML=`<defs><radialGradient id="gold-orb" cx=".3" cy=".25"><stop stop-color="#e3d296"/><stop offset="1" stop-color="#8b8e57"/></radialGradient>${Object.entries(paths).map(([name,path])=>`<symbol id="icon-${name}" viewBox="0 0 24 24"><path d="${path}"/></symbol>`).join('')}</defs>${staticCity()}<g id="project-effects"></g><g id="district-labels"></g><g id="issue-markers"></g><g id="project-markers"></g>`;
    svg.addEventListener('click',e=>{if(this.suppressClick){this.suppressClick=false;return;}this.select(e.target);});
    svg.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.select(e.target);}});
    svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;this.drag={x:e.clientX,y:e.clientY,view:[...this.view],moved:false};});
    svg.addEventListener('pointermove',e=>{
      if(this.drag){const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;if(Math.hypot(dx,dy)>5){this.drag.moved=true;svg.setPointerCapture(e.pointerId);const scale=this.view[2]/svg.getBoundingClientRect().width;this.view[0]=this.drag.view[0]-dx*scale;this.view[1]=this.drag.view[1]-dy*scale;this.applyView();}return;}
      const target=e.target.closest('[data-district],[data-issue]');this.callbacks.hover(target?.dataset.district,target?.dataset.issue,e);
    });
    svg.addEventListener('pointerup',e=>{this.suppressClick=!!this.drag?.moved;this.drag=null;if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);});
    svg.addEventListener('pointercancel',()=>{this.drag=null;});
    svg.addEventListener('pointerleave',()=>{this.callbacks.hover(null,null);});
    svg.addEventListener('wheel',e=>{e.preventDefault();this.zoom(e.deltaY<0?1.15:1/1.15);},{passive:false});
  }
  select(target){const hit=target.closest('[data-issue],[data-project],[data-district]');if(!hit)return;if(hit.dataset.issue)this.callbacks.issue(hit.dataset.issue);else if(hit.dataset.project)this.callbacks.project(hit.dataset.project,hit.dataset.district);else this.callbacks.district(hit.dataset.district);}
  applyView(){this.view[0]=Math.max(-500,Math.min(1000,this.view[0]));this.view[1]=Math.max(-350,Math.min(650,this.view[1]));this.svg.setAttribute('viewBox',this.view.join(' '));}
  zoom(factor){const w=Math.max(450,Math.min(1550,this.view[2]/factor)),h=w*760/1200;this.view=[this.view[0]+(this.view[2]-w)/2,this.view[1]+(this.view[3]-h)/2,w,h];this.applyView();}
  reset(){this.view=[0,0,1200,760];this.applyView();}
  update({district,issue,appeals,plan,measures,scores,quarter,showIssues,showProjects}){
    for(const element of this.svg.querySelectorAll('.district-region')){element.classList.toggle('selected',element.dataset.district===district);element.setAttribute('aria-pressed',String(element.dataset.district===district));}
    this.svg.querySelector('#district-labels').innerHTML=Object.entries(geometry).map(([name,g])=>{const [x,y]=P(...g.label);return `<text x="${x}" y="${y}" class="district-label ${name===district?'selected':''}">${name.toUpperCase()}</text><text x="${x}" y="${y+17}" class="district-score-label">${scores.district_scores[name].toFixed(2)} / 100</text>`;}).join('');
    const counts={};
    this.svg.querySelector('#issue-markers').innerHTML=showIssues?appeals.map(a=>{const index=counts[a.district]||0;counts[a.district]=index+1;const anchor=geometry[a.district].anchor;const [x,y]=P(anchor[0]+(index?90:-30),anchor[1]+(index?30:0));return `<g class="issue-pin ${a.severity} ${a.status==='improved'?'improved':''} ${a.id===issue?'selected':''}" data-issue="${esc(a.id)}" data-district="${a.district}" transform="translate(${x} ${y})" role="button" tabindex="0" aria-label="${esc(a.district+': '+a.title+', '+a.value)}"><path d="M0 8v16" stroke="#c5ba89" stroke-width="1"/><ellipse cy="25" rx="7" ry="3" fill="#d3bb7d" opacity=".25"/><circle class="pin-halo" r="27"/><circle class="pin-base" r="18"/><use href="#icon-${indicatorIcons[a.indicator_code]}" x="-11" y="-12" width="22" height="22" class="pin-symbol"/>${a.status==='improved'?'<circle cx="15" cy="-14" r="6" fill="#92b478"/><path d="M12-14l2 2 4-5" stroke="#173625" fill="none"/>':''}</g>`;}).join(''):'';
    let effects='',markers='';const used={};
    if(showProjects)for(const selection of plan){const m=measures[selection.measure_id];const targets=m.scope==='Город'?Object.keys(geometry):[selection.district];for(const name of targets){if(!geometry[name])continue;const count=used[name]||0;used[name]=count+1;const anchor=geometry[name].anchor;const x=anchor[0]-18+count%3*60,y=anchor[1]+80+Math.floor(count/3)*45;const [sx,sy]=P(x,y);const active=quarter>m.lag;const state=active?'active':'pending';effects+=`<g class="project-overlay ${state}">${projectEffect(selection.measure_id,x,y)}</g>`;markers+=`<g class="project-pin ${state}" transform="translate(${sx} ${sy-25})" data-project="${selection.measure_id}" data-district="${name}" role="button" tabindex="0" aria-label="${esc(m.name+' — '+name)}"><rect class="project-base" x="-12" y="-12" width="24" height="24" rx="3"/><use href="#icon-${measureIcons[selection.measure_id]}" x="-9" y="-10" width="18" height="18" class="pin-symbol"/><text x="0" y="25" text-anchor="middle">${selection.measure_id}</text></g>`;}}
    this.svg.querySelector('#project-effects').innerHTML=effects;this.svg.querySelector('#project-markers').innerHTML=markers;
  }
}
