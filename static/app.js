import {MapAdapter} from './map-adapter.js';
import {districts, districtById, districtByName} from './game-geography.js';
import {icon, measureIcons} from './city-map.js';
import {CityPulse} from './city-pulse.js';
import {projectStates,projectStatus} from './project-geometry.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2});
const sign=n=>(n>0?'+':'')+fmt(n);
const statusNames={new:'Открытая проблема',planned:'Решение в плане',improved:'Есть улучшение',unresolved:'Пока без улучшения'};
const severityNames={critical:'Критическая проблема',high:'Высокий приоритет',medium:'Требует внимания',attention:'Требует внимания',normal:'В норме'};
const severity=v=>v<40?'critical':v<50?'high':v<60?'medium':'normal';
// Domain state remains independent of map camera/style. No quarterly indicators.
const state={data:null,plan:[],district:null,issue:null,problem:null,drawer:'map',context:null,filter:'Все',drafts:{},result:null,aftermath:null,appeals:[],alternative:null,branch:'mine',snapshot:'after',quarter:0,busy:false,revision:0,valid:false,validationError:'',aiBusy:false,alternativeBusy:false,answer:'',feedback:'',presentation:'2d'};
let map,toastTimer,returnFocus;
state.city=null;state.relevant=null;state.branchRevision=0;
state.project=null;state.visualSummary=false;
const currentResult=()=>state.branch==='alternative'?state.alternative?.result:state.result;
const currentPlan=()=>state.branch==='alternative'?state.alternative.plan:state.plan;
const currentAftermath=()=>state.branch==='alternative'?state.alternative.aftermath:state.aftermath;
const currentAppeals=()=>state.branch==='alternative'?state.alternative.appeals:state.appeals;
const showingBefore=()=>!!currentResult()&&state.snapshot==='before';
const displayedResult=()=>showingBefore()?null:currentResult();
const currentCity=()=>state.branch==='alternative'?state.alternative.city:state.city;
const displayedCity=()=>showingBefore()?currentCity().bundle.initial:currentCity().current;
const displayedAppeals=()=>currentCity().issues(showingBefore());

async function enrichCity(city,plan,stage){
  if(!state.data.ai_available)return;
  const revision=state.revision,branchRevision=state.branchRevision;
  try{
    const response=await api('/api/events/wording',{plan,stage,run_id:city.runId,branch:city.branch});
    if(revision!==state.revision||branchRevision!==state.branchRevision||currentCity()!==city)return;
    if(city.applyWording(response)){
      renderInspector();if(state.drawer==='pulse')renderAppeals();if(state.context==='advisor')renderAdvisor();renderReactions();
    }
  }catch(_){/* Immediate deterministic wording stays visible. */}
}
function renderPulseBadge(){
  const city=currentCity();if(!city)return;
  if(state.drawer==='pulse')city.markRead();
  const count=city.unread;$('pulse-unread').hidden=!count;$('pulse-unread').textContent=count;
  $('pulse-unread').setAttribute('aria-label',`Новых событий: ${count}`);
}

async function api(path,body){
  const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let value;try{value=JSON.parse(await response.text());}catch(_){throw new Error('Не удалось прочитать ответ сервера.');}
  if(!response.ok)throw new Error(value.errors?value.errors.map(x=>x.message).join(' '):value.error||'Не удалось выполнить запрос');
  return value;
}
function toast(message){clearTimeout(toastTimer);$('map-toast').textContent=message;$('map-toast').hidden=false;toastTimer=setTimeout(()=>{$('map-toast').hidden=true;},5500);}
function persist(){try{localStorage.setItem('akim-map-plan-v1',JSON.stringify(state.plan));}catch(_){}}
function localErrors(){
  const errors=[],counts={},directions={},byId={};let cost=0;
  for(const s of state.plan){const m=state.data.measures[s.measure_id];if(!m){errors.push('Неизвестное мероприятие');continue;}cost+=m.cost;counts[s.measure_id]=(counts[s.measure_id]||0)+1;directions[m.direction]=(directions[m.direction]||0)+1;byId[s.measure_id]=s;
    if(m.scope==='Район'&&!Object.hasOwn(state.data.districts,s.district||''))errors.push(`${s.measure_id}: выберите район`);
    if(m.scope==='Город'&&s.district!=null)errors.push(`${s.measure_id}: городская мера не требует района`);
  }
  if(cost>100)errors.push(`Бюджет превышен на ${cost-100} ед.`);
  if(Object.values(counts).some(n=>n>1))errors.push('Мероприятия не должны повторяться');
  for(const [d,n] of Object.entries(directions))if(n>2)errors.push(`${d}: максимум 2 мероприятия`);
  if(byId.M1&&byId.M3)errors.push('M1 и M3 несовместимы');
  for(const [a,b] of [['M4','M7'],['M5','M13']])if(byId[a]&&byId[b]&&byId[a].district===byId[b].district)errors.push(`${a} и ${b} несовместимы в одном районе`);
  if(state.plan.length>5)errors.push('Разрешено ровно 5 решений');
  return errors;
}
function updatePlannedAppeals(){
  state.appeals=state.data.appeals.map(a=>({...a,status:state.plan.some(s=>{const m=state.data.measures[s.measure_id];return m.effects[a.indicator_code]>0&&(m.scope==='Город'||s.district===a.district);})?'planned':'new'}));
}
async function changed(){
  state.project=null;state.visualSummary=false;
  state.revision++;state.result=null;state.aftermath=null;state.alternative=null;state.branch='mine';state.snapshot='after';state.quarter=0;state.valid=false;state.validationError='';state.feedback='';state.answer='';state.alternativeBusy=false;
  state.city=new CityPulse(state.data.city,state.city);updatePlannedAppeals();persist();render();
  const contextRevision=state.revision;
  // Partial plans have no simulated final values. This request only annotates priorities.
  api('/api/events/context',{plan:state.plan,run_id:`draft-${contextRevision}`}).then(bundle=>{
    if(contextRevision!==state.revision)return;
    state.city=new CityPulse(bundle,state.city);render();enrichCity(state.city,structuredClone(state.plan),'baseline');
  }).catch(()=>{});
  if(localErrors().length||state.plan.length!==5)return;
  const revision=state.revision;
  try{await api('/api/validate',{plan:state.plan});if(revision!==state.revision)return;state.valid=true;renderHeader();}
  catch(error){if(revision!==state.revision)return;state.validationError=error.message;renderHeader();}
}
function renderHeader(){
  const r=displayedResult(),plan=currentPlan(),cost=plan.reduce((n,s)=>n+state.data.measures[s.measure_id].cost,0);
  $('score').textContent=fmt(r?r.result.score:state.data.baseline.score);
  $('budget').textContent=fmt(100-cost);$('budget').classList.toggle('negative',cost>100);
  $('count').innerHTML=`${plan.length} <small>/ 5</small>`;
  const errors=localErrors();if(state.validationError)errors.push(state.validationError);
  $('plan-status').classList.toggle('error',errors.length>0);
  $('plan-status').textContent=state.busy?'Проекты начинают работать…':errors.length?errors.join(' · '):state.plan.length!==5?`Выбрано ${state.plan.length} из 5 решений`:state.valid?'План готов к запуску':'Проверяем план…';
  $('simulate').disabled=!state.valid||state.busy;
  $('simulate').innerHTML=state.busy?'Симуляция идёт…':`${currentResult()?'Повторить симуляцию':'Запустить симуляцию'} <span>↗</span>`;
  for(const id of ['example','reset','import'])$(id).disabled=state.busy;
  $('export').disabled=!state.valid||state.busy;
  $('theme').textContent=window.AkimTheme.get()==='dark'?'☀':'☾';
  $('theme').setAttribute('aria-label',window.AkimTheme.get()==='dark'?'Включить светлую тему':'Включить тёмную тему');
  $('presentation').textContent=state.presentation==='2d'?'3D':'2D';
  $('presentation').setAttribute('aria-pressed',String(state.presentation==='3d'));
  $('presentation').setAttribute('aria-label',state.presentation==='2d'?'Включить 3D':'Включить 2D');
  $('time-label').textContent=state.quarter?`Квартал ${state.quarter} из 8`:'Готовим симуляцию…';
  $('phase-label').textContent=state.busy?'СИМУЛЯЦИЯ':currentResult()?'РЕЗУЛЬТАТ':'ПЛАНИРОВАНИЕ';
  $('quarters').innerHTML=Array.from({length:8},(_,i)=>`<span class="quarter ${state.quarter>i?'done':''} ${state.quarter===i+1?'current':''}">Q${i+1}</span>`).join('');
  $('city-subtitle').textContent=currentResult()?'Ваши решения. Два года спустя.':'Пять решений, которые меняют город.';
  document.body.classList.toggle('busy',state.busy);
  document.body.dataset.phase=state.busy?'playback':currentResult()?'result':'planning';
  document.body.dataset.quarter=state.quarter;
  document.body.dataset.snapshot=state.snapshot;
  document.body.dataset.branch=state.branch;
  renderCompletion();
}
function renderMap(){
  const ids=displayedCity().map_issue_ids;
  map?.update({district:state.district,issue:state.issue,project:state.context==='project'?state.project:null,appeals:displayedAppeals().filter(a=>ids.includes(a.id)||a.id===state.issue),plan:showingBefore()?[]:currentPlan(),measures:state.data.measures,scores:displayedResult()?.result||state.data.baseline,quarter:showingBefore()?0:state.quarter,result:displayedResult(),before:showingBefore(),scenario:currentCity().runId,summary:state.visualSummary&&!showingBefore(),showIssues:true,showProjects:true});
}
function renderCompletion(){
  const r=currentResult(),visible=!!r&&!state.busy&&state.drawer==='map'&&!state.context;
  $('playback').hidden=!state.busy&&!visible;$('playback').classList.toggle('completed',visible);
  $('quarters').hidden=!state.busy;$('playback-note').hidden=!state.busy;$('map-comparison').hidden=!visible;
  if(visible){$('time-label').textContent=`${fmt(r.baseline.score)} → ${fmt(r.result.score)}`;$('phase-label').textContent='ИТОГ Q8';$('milestone').textContent=`${sign(r.score_delta)} к качеству жизни`;
    for(const b of $('map-comparison').querySelectorAll('[data-snapshot]'))b.setAttribute('aria-pressed',String(b.dataset.snapshot===state.snapshot));
    $('show-changes').setAttribute('aria-pressed',String(state.visualSummary&&!showingBefore()));
    $('show-changes').textContent=state.visualSummary&&!showingBefore()?'Обычный вид':'Показать изменения';
  }
}
function hideSmallMenus(){for(const id of ['menu','district-picker'])$(id).hidden=true;$('menu-toggle').setAttribute('aria-expanded','false');$('district-picker-toggle').setAttribute('aria-expanded','false');}
function syncSurfaces(){
  $('drawer').hidden=state.drawer==='map';$('district-card').hidden=!['district','project'].includes(state.context);$('advisor-panel').hidden=state.context!=='advisor';
  $('advisor').setAttribute('aria-expanded',String(state.context==='advisor'));
  document.body.classList.toggle('has-overlay',state.drawer!=='map'||!!state.context);
  for(const b of document.querySelectorAll('#navigation [data-view]')){const active=b.dataset.view===state.drawer;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
  renderCompletion();
}
function showDrawer(name,focus=true){
  returnFocus=document.activeElement;state.drawer=name;state.context=null;hideSmallMenus();syncSurfaces();renderDrawer();
  renderPulseBadge();renderMap();if(name!=='map'&&focus)$('drawer-close').focus({preventScroll:true});
}
function closeOverlay(){state.drawer='map';state.context=null;hideSmallMenus();syncSurfaces();renderMap();if(returnFocus?.isConnected&&!returnFocus.closest('[hidden]'))returnFocus.focus({preventScroll:true});else document.querySelector('#navigation [data-view=map]').focus();}
function selectDistrict(id){
  const d=districtById[id]||districtByName[id];if(!d)return;
  returnFocus=document.activeElement;state.district=d.backendName;state.issue=null;state.problem=null;state.drawer='map';state.context='district';hideSmallMenus();syncSurfaces();renderMap();renderInspector();map.focusDistrict(d.id);$('district-close').focus({preventScroll:true});
}
function selectIssue(id){
  const a=displayedAppeals().find(a=>a.id===id);if(!a)return;
  selectDistrict(a.district);state.issue=id;state.problem=a.indicator_code;renderMap();renderInspector();
}
function valuesFor(name){return displayedResult()?.districts[name].after||state.data.districts[name].indicators;}
function priorityProblems(name){return displayedCity().issues.filter(a=>a.district===name).slice(0,3).map(a=>[a.indicator,a.value]);}
function renderInspector(){
  if(state.context==='project')return renderProjectCard();
  if(!state.district)return;
  const name=state.district,r=displayedResult(),d=r?.districts[name],score=d?d.score_after:state.data.baseline.district_scores[name];
  const appeal=displayedAppeals().find(a=>a.district===name&&a.indicator_code===state.problem);
  const metrics=Object.entries(state.data.indicators).map(([key,label])=>{const after=valuesFor(name)[key],delta=d?d.delta[key]:0;return `<div class="indicator-row"><div class="indicator-line"><span>${esc(label)}</span><b>${fmt(after)}${delta?`<span class="${delta<0?'negative':'delta'}"> ${sign(delta)}</span>`:''}</b></div><div class="indicator-track"><i class="${after<40?'critical':''}" style="width:${after}%"></i></div></div>`;}).join('');
  $('district-content').innerHTML=`<span class="eyebrow">РАЙОН ГОРОДА</span><div class="district-title-row"><h2 id="district-title">${esc(name)}</h2><div><strong>${fmt(score)}</strong><small>качество жизни</small></div></div><div class="section-caption">Главные проблемы</div>${priorityProblems(name).map(([key,value])=>`<button class="priority-issue" data-problem="${key}"><strong>${esc(state.data.indicators[key])}</strong><b>${fmt(value)}</b><small class="${severity(value)}">${severityNames[severity(value)]}</small><span class="issue-arrow">↗</span></button>`).join('')}
  ${state.problem?`<div class="appeal-detail" data-current-issue="${esc(appeal?.id||'')}"><strong>${esc(state.data.indicators[state.problem])}</strong>${appeal?`<div class="metric-line">${fmt(appeal.value)} / 100 · <span class="${appeal.severity}">${severityNames[appeal.severity]}</span></div><blockquote>«${esc(appeal.message)}»</blockquote><span class="source-label">${appeal.source==='ai'?'AI-текст':'Локальный текст'} · синтетическое обращение</span>`:''}<button class="text-button" data-focus-district="${districtByName[name].id}">Показать район</button><button class="text-button" data-resolve="${state.problem}">Найти решение ↗</button></div>`:''}
  <button class="primary wide" data-district-decisions>Решения для района <span>↗</span></button><details id="all-metrics"><summary>Все показатели</summary>${metrics}<p class="description">${esc(state.data.districts[name].profile)}</p></details>`;
}
function selectProject(id,name){
  if(!currentPlan().some(s=>s.measure_id===id))return;
  returnFocus=document.activeElement;state.project=id;state.context='project';state.drawer='map';
  if(name)state.district=name;hideSmallMenus();syncSurfaces();renderMap();renderProjectCard();$('district-close').focus({preventScroll:true});
}
function renderProjectCard(){
  const project=projectStates(currentPlan(),state.data.measures,state.quarter,displayedResult()).find(p=>p.projectId===state.project);
  if(!project)return;
  const r=displayedResult(),names=project.district?[project.district]:Object.keys(state.data.districts);
  $('district-content').innerHTML=`<span class="eyebrow">ПРОЕКТ СИМУЛЯЦИИ</span><h2 id="district-title" class="project-card-title">${esc(project.name)}</h2><p class="description">${esc(project.district||'Весь город')} · ${projectStatus(project,state.quarter)}</p><span class="source-label">Условное размещение. Не реальный объект или маршрут.</span><div class="section-caption">Затрагивает</div>${project.indicators.map(key=>`<p class="project-target">${esc(state.data.indicators[key])}</p>`).join('')}${r?`<details open><summary>Проверенные изменения Q8</summary><p class="source-label">Суммарный результат всех выбранных мер и синергий, не отдельный вклад этого проекта.</p>${names.map(name=>`<div class="project-deltas"><strong>${esc(name)}</strong>${project.indicators.map(key=>`<div class="comparison-row"><span>${esc(state.data.indicators[key])}</span><b>${sign(r.districts[name].delta[key])}</b></div>`).join('')}</div>`).join('')}</details>`:'<p class="description">Проверенные значения появятся в Q8. Сейчас показан только визуальный этап проекта.</p>'}`;
}
function renderDrawer(){
  $('decision-footer').hidden=state.drawer!=='decisions';
  const titles={decisions:'Решения',pulse:'Пульс города',results:state.branch==='alternative'?'Альтернативная Астана':'Ваша Астана'};
  if(state.drawer==='map')return;
  $('drawer-title').textContent=titles[state.drawer];
  $('drawer-kicker').textContent=state.drawer==='decisions'?'ПЯТЬ ШАГОВ К ЛУЧШЕМУ':state.drawer==='pulse'?'ГОРОД ГОВОРИТ':'ДВА ГОДА СПУСТЯ';
  if(state.drawer==='decisions')renderInitiatives();else if(state.drawer==='pulse')renderAppeals();else renderResults();
}
function renderInitiatives(){
  const dirs=['Все',...new Set(Object.values(state.data.measures).map(m=>m.direction))];
  const cost=state.plan.reduce((sum,s)=>sum+state.data.measures[s.measure_id].cost,0);
  $('drawer-content').innerHTML=`${state.branch==='alternative'?'<p class="description">Вы редактируете свой исходный план. Изменение начнёт новый расчёт.</p>':''}<section class="plan-summary"><h3>Ваш план · ${state.plan.length}/5</h3>${state.plan.length?state.plan.map(s=>`<div class="plan-item"><span>${esc(state.data.measures[s.measure_id].name)}<small>${esc(s.district||'Весь город')} · ${state.data.measures[s.measure_id].cost}</small></span><button data-remove="${s.measure_id}" aria-label="Убрать ${esc(state.data.measures[s.measure_id].name)}" ${state.busy?'disabled':''}>×</button></div>`).join(''):'<p>Выберите, что важно для вашего города.</p>'}<div class="plan-budget"><span>Осталось бюджета</span><strong class="${cost>100?'negative':''}">${100-cost}</strong></div></section>
  <div class="filters">${dirs.map(d=>`<button class="filter-button ${state.filter===d?'active':''}" data-filter="${esc(d)}">${esc(d)}</button>`).join('')}</div>
  ${state.relevant?`<p class="description">По проблеме: ${esc(state.data.indicators[state.relevant])}. <button class="text-button" data-filter="Все">Все решения</button></p>`:''}
  ${Object.entries(state.data.measures).filter(([,m])=>state.relevant?(m.effects[state.relevant]||0)>0:state.filter==='Все'||m.direction===state.filter).map(([id,m])=>{
    const selected=state.plan.find(s=>s.measure_id===id),district=selected?.district||state.drafts[id]||state.district||'';
    return `<article class="initiative ${selected?'selected':''}"><div class="initiative-head"><span class="initiative-icon">${icon(measureIcons[id])}</span><h3>${esc(m.name)}</h3><strong class="cost">${m.cost}<small>бюджета</small></strong></div><p class="initiative-meta">Эффект после ${m.lag} ${m.lag===1?'квартала':'кварталов'}</p><div class="initiative-controls">${m.scope==='Район'?`<select data-measure-district="${id}" aria-label="Район для ${esc(m.name)}" ${state.busy?'disabled':''}><option value="" ${!district?'selected':''}>Выберите район</option>${Object.keys(state.data.districts).map(d=>`<option value="${esc(d)}" ${d===district?'selected':''}>${esc(d)}</option>`).join('')}</select>`:'<span>Для всего города</span>'}<button class="${selected?'secondary':'primary'}" data-add="${id}" ${state.busy||(!selected&&state.plan.length===5)?'disabled':''}>${selected?'Убрать':'Выбрать'}</button></div><details><summary>Что изменится</summary><p>${Object.entries(m.scaled_effects).map(([k,v])=>`${esc(state.data.indicators[k])}: ${sign(v)}`).join('<br>')}<br>К концу двух лет, с учётом срока запуска.</p></details></article>`;
  }).join('')}`;
}
function renderAppeals(){
  const city=currentCity();
  $('drawer-content').innerHTML=`<p class="description">Синтетические события учебной модели · ${city.branch==='alternative'?'альтернативный':'основной'} сценарий. Числовые наблюдения — только до симуляции и в Q8.</p>${city.events.map(e=>{
    const text=city.text(e);
    return `<article class="appeal-card" data-event-id="${esc(e.event_id)}" data-event-quarter="${e.quarter}" data-event-type="${e.event_type}"><div class="card-line"><strong>${e.quarter?'Q'+e.quarter:'До симуляции'} · ${esc(e.district||'Весь город')}</strong>${e.severity?`<span class="badge ${e.severity}">${severityNames[e.severity]}</span>`:''}</div><h3>${esc(e.title)}</h3><p>${esc(text.message)}</p>${e.value!==undefined?`<div class="metric-line">${fmt(e.before)}${e.quarter===8?` → ${fmt(e.value)}`:''} / 100</div>`:''}<span class="source-label">${text.source==='ai'?'AI-текст':'Локальный текст'} · ${e.source_basis==='catalog_activation'?'начало работы по каталогу':e.source_basis==='final'?'проверенный итог':'исходные данные'}</span>${e.district?`<button class="text-button" data-focus-district="${districtByName[e.district].id}">На карте ↗</button>`:''}</article>`;
  }).join('')}`;
  renderPulseBadge();
}
function renderResults(){
  const r=currentResult(),story=currentAftermath();
  if(!r){$('drawer-content').innerHTML='<p class="empty-note">Пять решений. Два года.<br>Посмотрите, что изменится в городе.</p><button class="primary wide" data-view="decisions">Выбрать решения <span>↗</span></button>';return;}
  const best=Object.entries(r.districts).sort((a,b)=>b[1].score_delta-a[1].score_delta)[0];
  const alt=state.alternative;
  $('drawer-content').innerHTML=`<div class="result-number"><span class="old-score">${fmt(r.baseline.score)} →</span> ${fmt(r.result.score)}</div><p class="result-gain">${sign(r.score_delta)} к качеству жизни</p><div class="snapshot-tabs" role="group" aria-label="Состояние города">${['before','after'].map(v=>`<button data-snapshot="${v}" class="${state.snapshot===v?'active':''}" aria-pressed="${state.snapshot===v}">${v==='before'?'До':'После'}</button>`).join('')}</div><p class="source-label">Меняются игровые слои. Реальная карта остаётся прежней.</p><div class="insight"><span>Критические показатели</span><strong>${r.baseline.n_crit} → ${r.result.n_crit}</strong></div><div class="insight"><span>Наибольший прирост · ${esc(best[0])}</span><strong>${sign(best[1].score_delta)}</strong></div><div class="insight"><span>Использовано бюджета</span><strong>${r.total_cost} / 100</strong></div>
  <details id="comparison-details"><summary>Другой сценарий</summary><div>${alt?`<div class="scenario-tabs"><button data-branch="mine" class="${state.branch==='mine'?'active':''}">Моя Астана</button><button data-branch="alternative" class="${state.branch==='alternative'?'active':''}">Альтернатива</button></div><p class="description">${esc(state.data.measures[alt.replaced.measure_id].name)} → ${esc(state.data.measures[alt.replacement.measure_id].name)} · ${esc(alt.replacement.district||'Весь город')}</p><div class="comparison-row"><span>Разница качества жизни</span><strong>${sign(alt.comparison.score_delta)}</strong></div>${Object.entries(alt.comparison.district_deltas).map(([name,delta])=>`<div class="comparison-row"><span>${esc(name)}</span><span class="${delta<0?'negative':'positive'}">${sign(delta)}</span></div>`).join('')}<p class="source-label">Лучшая из ${alt.checked} допустимых замен одной меры, не глобальный оптимум.</p>`:`<button id="alternative" class="secondary wide" ${state.alternativeBusy?'disabled':''}>${state.alternativeBusy?'Сравниваем варианты…':'Найти альтернативу ↗'}</button>`}</div></details>
  <details id="reactions-details"><summary>Реакции жителей</summary><div id="reactions-content"></div></details>
  <details id="press-details"><summary>Пресс-конференция</summary><div><p class="description">${esc(story.press_question.question)}</p><label class="source-label" for="press-answer">Ваш ответ</label><textarea id="press-answer" maxlength="3000" placeholder="Расскажите о ваших приоритетах…">${esc(state.answer)}</textarea><button id="feedback" class="secondary wide" ${state.aiBusy?'disabled':''}>${state.data.ai_available?'Получить отзыв AI':'Памятка для ответа'}</button><p id="feedback-text" class="feedback">${esc(state.feedback)}</p><span class="source-label">Ответ не влияет на оценку города.</span></div></details>`;
  renderReactions();
}
function renderReactions(){
  if(!$('reactions-content'))return;
  const city=currentCity(),events=city.events.filter(e=>e.quarter===8);
  $('reactions-content').innerHTML=`<span class="source-label">Синтетические реакции · проверенные итоги Q8</span>${events.map(e=>`<div class="reaction"><strong>${esc(e.district)} · ${esc(e.title)}</strong><p>${esc(city.text(e).message)}</p><span class="source-label">${fmt(e.before)} → ${fmt(e.value)} · ${city.text(e).source==='ai'?'AI-текст':'Локальный текст'}</span></div>`).join('')}`;
}
function renderAdvisor(){
  const snapshot=displayedCity(),a=state.district?snapshot.district_advisors[state.district]:snapshot.advisor,p=a.priority;
  const wording=currentCity().text(a.wording);
  $('advisor-content').innerHTML=`<p class="advisor-insight">${esc(wording.message)}</p><span class="source-label">${wording.source==='ai'?'AI-текст · ':''}По показателям ${a.basis==='final'?'Q8':'исходного состояния'}</span>${p?`<div class="advisor-actions"><button class="primary" data-focus-district="${districtByName[p.district].id}">Показать</button><button class="secondary" data-advisor-decisions="${p.indicator}" data-district="${esc(p.district)}">Что можно сделать?</button></div><details><summary>Почему?</summary><p>${esc(p.title)}: ${fmt(p.value)} / 100. ${severityNames[p.severity]}. Приоритет: сначала меньший показатель, затем больший вес и стабильный порядок.</p></details>`:''}${Object.keys(a.direction_counts).length?`<p class="description">В плане: ${Object.entries(a.direction_counts).map(([d,n])=>`${esc(d)} — ${n}`).join('; ')}.</p>`:''}${a.untouched?`<p class="description">Выбранные меры пока не нацелены на улучшение: ${esc(a.untouched.title)} · ${esc(a.untouched.district)}.</p>`:''}${a.biggest_gain?`<p class="description">Наибольший итоговый прирост: ${esc(a.biggest_gain.district)} · ${sign(a.biggest_gain.delta)}.</p>`:''}`;
}
function render(){renderHeader();renderMap();renderInspector();renderDrawer();renderPulseBadge();if(state.context==='advisor')renderAdvisor();syncSurfaces();}
async function simulate(){
  if(!state.valid||state.busy)return;
  state.visualSummary=false;
  state.revision++;const revision=state.revision;state.busy=true;state.result=null;state.alternative=null;state.branch='mine';state.snapshot='after';state.aftermath=null;state.quarter=0;state.answer='';state.feedback='';state.city=new CityPulse(state.data.city,state.city);updatePlannedAppeals();showDrawer('map',false);render();
  try{
    const response=await api('/api/simulate',{plan:state.plan});
    if(revision!==state.revision)return;
    state.city=new CityPulse(response.city,state.city);render();enrichCity(state.city,structuredClone(state.plan),'final');
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    for(let q=1;q<=8;q++){
      if(revision!==state.revision)return;state.quarter=q;
      const starting=state.plan.filter(s=>state.data.measures[s.measure_id].lag+1===q);
      $('milestone').textContent=starting.length?starting.map(s=>`${state.data.measures[s.measure_id].name} — начинает работу${s.district?' · '+s.district:''}`).join('. '):q===8?'Подводим итоги…':'Город движется вперёд.';
      state.city.publish(q);renderHeader();renderMap();if(state.context==='project')renderProjectCard();renderPulseBadge();if(state.drawer==='pulse')renderAppeals();await new Promise(resolve=>setTimeout(resolve,reduced?30:650));
    }
    if(revision!==state.revision)return;
    // Only now publish authoritative numeric state. Never interpolate Q1–Q7.
    state.city.finish();state.result=response.result;state.aftermath=response.aftermath;state.appeals=response.appeals;state.busy=false;render();
  }catch(error){if(revision!==state.revision)return;state.busy=false;state.quarter=0;render();toast(error.message);}
}
async function findAlternative(){
  if(!state.result||state.busy||state.alternativeBusy)return;
  const revision=state.revision;state.alternativeBusy=true;renderDrawer();$('comparison-details').open=true;
  try{const value=await api('/api/alternative',{plan:state.plan});if(revision!==state.revision)return;if(!value.available){toast('Допустимых замен не найдено');return;}value.city=new CityPulse(value.city);value.city.finish();state.alternative=value;state.branch='alternative';state.branchRevision++;state.snapshot='after';state.answer='';state.feedback='';render();enrichCity(value.city,structuredClone(value.plan),'final');if($('comparison-details'))$('comparison-details').open=true;}
  catch(error){toast(error.message);}finally{if(revision===state.revision){state.alternativeBusy=false;if($('alternative')){$('alternative').disabled=false;$('alternative').textContent='Найти альтернативу ↗';}}}
}
async function generateAI(kind){
  if(state.aiBusy)return;const revision=state.revision,branch=state.branch,before=showingBefore();state.aiBusy=true;
  const disclosures=[...document.querySelectorAll('#drawer details[open]')].map(e=>e.id);renderDrawer();for(const id of disclosures)if($(id))$(id).open=true;
  try{const value=await api(`/api/ai/${kind}`,{...(currentResult()&&!(kind==='appeals'&&before)?{plan:currentPlan()}:{}),...(kind==='feedback'?{answer:state.answer}:{})});if(revision!==state.revision||branch!==state.branch)return;
    if(kind==='appeals'){if(currentResult()&&!before){if(branch==='alternative')state.alternative.appeals=value.appeals;else state.appeals=value.appeals;}else{state.data.appeals=value.appeals;if(!currentResult())updatePlannedAppeals();}}
    else if(kind==='result'){if(branch==='alternative')state.alternative.aftermath=value;else state.aftermath=value;}
    else state.feedback=value.feedback;
    if(value.notice)toast(value.notice);
  }catch(error){toast(error.message);}finally{state.aiBusy=false;render();if(revision===state.revision&&branch===state.branch)for(const id of disclosures)if($(id))$(id).open=true;}
}
function openRelevantDecisions(key,name=state.district){
  state.district=name;
  state.relevant=key;
  const match=Object.values(state.data.measures).find(m=>(m.effects[key]||0)>0);
  state.filter=match?.direction||'Все';showDrawer('decisions');
}
function mapStatus(status){
  document.body.dataset.mapState=status;
  $('map-status').hidden=status==='ready';
  $('map-status-text').textContent=status==='loading'?'Загружаем карту Астаны…':status==='legacy'?'Схематичная карта · резервный режим':'Карта недоступна. Ваш план сохранён.';
  $('map-retry').hidden=status==='loading';$('map-fallback').hidden=status!=='error';
  $('presentation').disabled=status==='legacy';
}
function bindEvents(){
  $('show-changes').onclick=()=>{state.snapshot='after';state.visualSummary=!state.visualSummary;render();};
  $('drawer-close').onclick=closeOverlay;$('district-close').onclick=closeOverlay;$('advisor-close').onclick=closeOverlay;
  $('help').onclick=()=>{hideSmallMenus();$('help-dialog').showModal();};$('help-close').onclick=()=>$('help-dialog').close();
  $('theme').onclick=()=>window.AkimTheme.set(window.AkimTheme.get()==='dark'?'light':'dark');
  window.addEventListener('themechange',()=>{map.setTheme(window.AkimTheme.get());renderHeader();});
  $('presentation').onclick=()=>{state.presentation=state.presentation==='2d'?'3d':'2d';map.setPresentation(state.presentation);renderHeader();};
  $('zoom-in').onclick=()=>map.zoom(1.25);$('zoom-out').onclick=()=>map.zoom(.8);$('zoom-reset').onclick=()=>map.resetView();
  $('map-retry').onclick=()=>map.retry();$('map-fallback').onclick=()=>map.useLegacy();
  $('menu-toggle').onclick=()=>{const show=$('menu').hidden;hideSmallMenus();$('menu').hidden=!show;$('menu-toggle').setAttribute('aria-expanded',String(show));};
  $('district-picker-toggle').onclick=()=>{const show=$('district-picker').hidden;hideSmallMenus();$('district-picker').hidden=!show;$('district-picker-toggle').setAttribute('aria-expanded',String(show));if(show)$('district-options').querySelector('button').focus();};
  $('advisor').onclick=()=>{if(state.context==='advisor')return closeOverlay();returnFocus=$('advisor');state.drawer='map';state.context='advisor';hideSmallMenus();syncSurfaces();renderAdvisor();$('advisor-close').focus();};
  $('example').onclick=()=>{if(state.busy)return;state.plan=structuredClone(state.data.example);state.drafts={};changed();showDrawer('decisions');};
  $('reset').onclick=()=>{if(state.busy)return;state.plan=[];state.district=null;state.issue=null;state.problem=null;state.drafts={};changed();showDrawer('map');map.resetView();};
  $('simulate').onclick=simulate;
  document.addEventListener('click',e=>{
    const button=e.target.closest('button');
    if(!button||button.disabled||!button.matches('[data-view],[data-focus-district],[data-issue],[data-problem],[data-resolve],[data-district-decisions],[data-remove],[data-add],[data-filter],[data-ai],[data-branch],[data-snapshot],[data-advisor-decisions],#alternative,#feedback'))return;const d=button.dataset;
    if(d.view)return showDrawer(d.view);
    if(d.focusDistrict)return selectDistrict(d.focusDistrict);
    if(d.issue)return selectIssue(d.issue);
    if(d.problem){state.problem=d.problem;renderInspector();return;}
    if(d.resolve)return openRelevantDecisions(d.resolve);
    if(d.advisorDecisions)return openRelevantDecisions(d.advisorDecisions,d.district);
    if('districtDecisions' in d){state.filter='Все';state.relevant=null;return showDrawer('decisions');}
    if(d.filter){state.filter=d.filter;state.relevant=null;return renderDrawer();}
    if(d.ai)return generateAI(d.ai);
    if(d.branch){state.branch=d.branch;state.branchRevision++;state.snapshot='after';state.answer='';state.feedback='';render();enrichCity(currentCity(),structuredClone(currentPlan()),'final');$('comparison-details').open=true;return;}
    if(d.snapshot){state.snapshot=d.snapshot;render();return;}
    if(button.id==='alternative')return findAlternative();
    if(button.id==='feedback'){state.answer=$('press-answer').value.trim();if(!state.answer)return toast('Сначала напишите ответ.');return generateAI('feedback');}
    if(state.busy)return;
    if(d.remove){state.plan=state.plan.filter(s=>s.measure_id!==d.remove);return changed();}
    if(d.add){const id=d.add,index=state.plan.findIndex(s=>s.measure_id===id);if(index>=0)state.plan.splice(index,1);else if(state.plan.length<5){const m=state.data.measures[id],select=document.querySelector(`[data-measure-district="${id}"]`);if(m.scope==='Район'&&!select.value){toast('Выберите район для проекта.');select.focus();return;}state.plan.push({measure_id:id,...(m.scope==='Район'?{district:select.value}:{})});}return changed();}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('help-dialog').open)closeOverlay();});
  $('drawer-content').addEventListener('change',e=>{if(!e.target.matches('[data-measure-district]')||state.busy)return;const id=e.target.dataset.measureDistrict;state.drafts[id]=e.target.value;const s=state.plan.find(s=>s.measure_id===id);if(s){s.district=e.target.value;changed();}});
  $('drawer-content').addEventListener('input',e=>{if(e.target.id==='press-answer')state.answer=e.target.value;});
  $('import').onclick=()=>$('file').click();$('file').onchange=async()=>{const revision=state.revision;try{const file=$('file').files[0];if(!file)return;if(file.size>32768)throw new Error('Максимальный размер плана — 32 КБ');const plan=JSON.parse((await file.text()).replace(/^\uFEFF/,''));await api('/api/validate',{plan});if(state.busy||revision!==state.revision)return;state.plan=plan;await changed();showDrawer('decisions');toast('План импортирован.');}catch(error){toast(error.message);}finally{$('file').value='';}};
  $('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(currentPlan(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='astana-plan.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);hideSmallMenus();};
}
async function init(){
  state.data=await api('/api/catalog');state.appeals=state.data.appeals;state.city=new CityPulse(state.data.city);
  $('district-options').innerHTML=districts.map(d=>`<button data-focus-district="${d.id}">${esc(d.backendName)}</button>`).join('');
  map=new MapAdapter($('city-map'),{district:selectDistrict,issue:selectIssue,project:selectProject,status:mapStatus});
  bindEvents();
  try{const saved=JSON.parse(localStorage.getItem('akim-map-plan-v1')||'null');if(Array.isArray(saved)&&saved.length<=5&&saved.every(s=>s&&Object.hasOwn(state.data.measures,s.measure_id)&&Object.keys(s).every(k=>['measure_id','district'].includes(k))&&(state.data.measures[s.measure_id].scope==='Город'?s.district==null:Object.hasOwn(state.data.districts,s.district||''))))state.plan=saved;}catch(_){}
  await changed();document.body.dataset.ready='true';
}
init().catch(error=>{toast(error.message);$('city-subtitle').textContent='Нет связи с сервером. Обновите страницу.';});
