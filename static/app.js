import {MapAdapter} from './map-adapter.js';
import {districts, districtById, districtByName} from './game-geography.js';
import {icon, measureIcons} from './city-map.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2});
const sign=n=>(n>0?'+':'')+fmt(n);
const statusNames={new:'Открытая проблема',planned:'Решение в плане',improved:'Есть улучшение',unresolved:'Пока без улучшения'};
const severityNames={critical:'Критично',high:'Высокий приоритет',medium:'Требует внимания',normal:'В норме'};
const severity=v=>v<40?'critical':v<50?'high':v<60?'medium':'normal';
// Domain state remains independent of map camera/style. No quarterly indicators.
const state={data:null,plan:[],district:null,issue:null,problem:null,drawer:'map',context:null,filter:'Все',drafts:{},result:null,aftermath:null,appeals:[],alternative:null,branch:'mine',snapshot:'after',quarter:0,busy:false,revision:0,valid:false,validationError:'',aiBusy:false,alternativeBusy:false,answer:'',feedback:'',presentation:'2d'};
let map,toastTimer,returnFocus;
const currentResult=()=>state.branch==='alternative'?state.alternative?.result:state.result;
const currentPlan=()=>state.branch==='alternative'?state.alternative.plan:state.plan;
const currentAftermath=()=>state.branch==='alternative'?state.alternative.aftermath:state.aftermath;
const currentAppeals=()=>state.branch==='alternative'?state.alternative.appeals:state.appeals;
const showingBefore=()=>!!currentResult()&&state.snapshot==='before';
const displayedResult=()=>showingBefore()?null:currentResult();
const displayedAppeals=()=>showingBefore()?state.data.appeals:currentAppeals();

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
  state.revision++;state.result=null;state.aftermath=null;state.alternative=null;state.branch='mine';state.snapshot='after';state.quarter=0;state.valid=false;state.validationError='';state.feedback='';state.answer='';state.alternativeBusy=false;
  updatePlannedAppeals();persist();render();
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
  $('playback').hidden=!state.busy;
  $('time-label').textContent=state.quarter?`Квартал ${state.quarter} из 8`:'Готовим симуляцию…';
  $('phase-label').textContent=state.busy?'СИМУЛЯЦИЯ':currentResult()?'РЕЗУЛЬТАТ':'ПЛАНИРОВАНИЕ';
  $('quarters').innerHTML=Array.from({length:8},(_,i)=>`<span class="quarter ${state.quarter>i?'done':''} ${state.quarter===i+1?'current':''}">Q${i+1}</span>`).join('');
  $('city-subtitle').textContent=currentResult()?'Ваши решения. Два года спустя.':'Пять решений, которые меняют город.';
  document.body.classList.toggle('busy',state.busy);
  document.body.dataset.phase=state.busy?'playback':currentResult()?'result':'planning';
  document.body.dataset.quarter=state.quarter;
  document.body.dataset.snapshot=state.snapshot;
  document.body.dataset.branch=state.branch;
}
function renderMap(){
  map?.update({district:state.district,issue:state.issue,appeals:displayedAppeals(),plan:showingBefore()?[]:currentPlan(),measures:state.data.measures,scores:displayedResult()?.result||state.data.baseline,quarter:showingBefore()?0:state.quarter,showIssues:true,showProjects:true});
}
function hideSmallMenus(){for(const id of ['menu','district-picker'])$(id).hidden=true;$('menu-toggle').setAttribute('aria-expanded','false');$('district-picker-toggle').setAttribute('aria-expanded','false');}
function syncSurfaces(){
  $('drawer').hidden=state.drawer==='map';$('district-card').hidden=state.context!=='district';$('advisor-panel').hidden=state.context!=='advisor';
  $('advisor').setAttribute('aria-expanded',String(state.context==='advisor'));
  document.body.classList.toggle('has-overlay',state.drawer!=='map'||!!state.context);
  for(const b of document.querySelectorAll('#navigation [data-view]')){const active=b.dataset.view===state.drawer;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
}
function showDrawer(name,focus=true){
  returnFocus=document.activeElement;state.drawer=name;state.context=null;hideSmallMenus();syncSurfaces();renderDrawer();
  if(name!=='map'&&focus)$('drawer-close').focus({preventScroll:true});
}
function closeOverlay(){state.drawer='map';state.context=null;hideSmallMenus();syncSurfaces();if(returnFocus?.isConnected&&!returnFocus.closest('[hidden]'))returnFocus.focus({preventScroll:true});else document.querySelector('#navigation [data-view=map]').focus();}
function selectDistrict(id){
  const d=districtById[id]||districtByName[id];if(!d)return;
  returnFocus=document.activeElement;state.district=d.backendName;state.issue=null;state.problem=null;state.drawer='map';state.context='district';hideSmallMenus();syncSurfaces();renderMap();renderInspector();map.focusDistrict(d.id);$('district-close').focus({preventScroll:true});
}
function selectIssue(id){
  const a=displayedAppeals().find(a=>a.id===id);if(!a)return;
  selectDistrict(a.district);state.issue=id;state.problem=a.indicator_code;renderMap();renderInspector();
}
function valuesFor(name){return displayedResult()?.districts[name].after||state.data.districts[name].indicators;}
function priorityProblems(name){return Object.entries(valuesFor(name)).sort((a,b)=>a[1]-b[1]).slice(0,3);}
function renderInspector(){
  if(!state.district)return;
  const name=state.district,r=displayedResult(),d=r?.districts[name],score=d?d.score_after:state.data.baseline.district_scores[name];
  const appeal=displayedAppeals().find(a=>a.district===name&&a.indicator_code===state.problem);
  const metrics=Object.entries(state.data.indicators).map(([key,label])=>{const after=valuesFor(name)[key],delta=d?d.delta[key]:0;return `<div class="indicator-row"><div class="indicator-line"><span>${esc(label)}</span><b>${fmt(after)}${delta?`<span class="${delta<0?'negative':'delta'}"> ${sign(delta)}</span>`:''}</b></div><div class="indicator-track"><i class="${after<40?'critical':''}" style="width:${after}%"></i></div></div>`;}).join('');
  $('district-content').innerHTML=`<span class="eyebrow">РАЙОН ГОРОДА</span><div class="district-title-row"><h2 id="district-title">${esc(name)}</h2><div><strong>${fmt(score)}</strong><small>качество жизни</small></div></div><div class="section-caption">Главные проблемы</div>${priorityProblems(name).map(([key,value])=>`<button class="priority-issue" data-problem="${key}"><strong>${esc(state.data.indicators[key])}</strong><b>${fmt(value)}</b><small class="${severity(value)}">${severityNames[severity(value)]}</small><span class="issue-arrow">↗</span></button>`).join('')}
  ${state.problem?`<div class="appeal-detail"><strong>${esc(state.data.indicators[state.problem])}</strong>${appeal?`<blockquote>«${esc(appeal.message)}»</blockquote><span class="source-label">${appeal.source==='ai'?'AI-текст':'Локальный текст'} · синтетическое обращение</span>`:''}<button class="text-button" data-resolve="${state.problem}">Найти решение ↗</button></div>`:''}
  <button class="primary wide" data-district-decisions>Решения для района <span>↗</span></button><details id="all-metrics"><summary>Все показатели</summary>${metrics}<p class="description">${esc(state.data.districts[name].profile)}</p></details>`;
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
  ${Object.entries(state.data.measures).filter(([,m])=>state.filter==='Все'||m.direction===state.filter).map(([id,m])=>{
    const selected=state.plan.find(s=>s.measure_id===id),district=selected?.district||state.drafts[id]||state.district||'';
    return `<article class="initiative ${selected?'selected':''}"><div class="initiative-head"><span class="initiative-icon">${icon(measureIcons[id])}</span><h3>${esc(m.name)}</h3><strong class="cost">${m.cost}<small>бюджета</small></strong></div><p class="initiative-meta">Эффект после ${m.lag} ${m.lag===1?'квартала':'кварталов'}</p><div class="initiative-controls">${m.scope==='Район'?`<select data-measure-district="${id}" aria-label="Район для ${esc(m.name)}" ${state.busy?'disabled':''}><option value="" ${!district?'selected':''}>Выберите район</option>${Object.keys(state.data.districts).map(d=>`<option value="${esc(d)}" ${d===district?'selected':''}>${esc(d)}</option>`).join('')}</select>`:'<span>Для всего города</span>'}<button class="${selected?'secondary':'primary'}" data-add="${id}" ${state.busy||(!selected&&state.plan.length===5)?'disabled':''}>${selected?'Убрать':'Выбрать'}</button></div><details><summary>Что изменится</summary><p>${Object.entries(m.scaled_effects).map(([k,v])=>`${esc(state.data.indicators[k])}: ${sign(v)}`).join('<br>')}<br>К концу двух лет, с учётом срока запуска.</p></details></article>`;
  }).join('')}`;
}
function renderAppeals(){
  const final=!!displayedResult();
  $('drawer-content').innerHTML=`<p class="description">${final?'Город после ваших решений.':'То, что волнует жителей сейчас.'}</p><button class="text-button" data-ai="appeals" ${state.aiBusy||!state.data.ai_available?'disabled':''}>${state.aiBusy?'Обновляем тексты…':state.data.ai_available?'✦ Обновить тексты':'Синтетические обращения'}</button><div class="pulse-heading">${final?'ПОСЛЕ СИМУЛЯЦИИ':'ИСХОДНОЕ СОСТОЯНИЕ'}</div>${displayedAppeals().map(a=>`<article class="appeal-card" data-appeal-id="${esc(a.id)}"><div class="card-line"><strong>${esc(a.district)}</strong><span class="badge ${a.severity}">${severityNames[a.severity]}</span></div><h3>${esc(a.title)}</h3><p>«${esc(a.message)}»</p><div class="metric-line">${fmt(a.before)}${final?` → ${fmt(a.value)}`:''} / 100 · ${statusNames[a.status]}</div><span class="source-label">${a.source==='ai'?'AI-текст':'Локальный текст'} · ${esc(a.resident_type)}</span><button class="text-button" data-issue="${esc(a.id)}">На карте ↗</button></article>`).join('')}`;
  // The API has snapshots, not an event stream. No invented timestamps/unread count.
  $('pulse-unread').hidden=true;
}
function renderResults(){
  const r=currentResult(),story=currentAftermath();
  if(!r){$('drawer-content').innerHTML='<p class="empty-note">Пять решений. Два года.<br>Посмотрите, что изменится в городе.</p><button class="primary wide" data-view="decisions">Выбрать решения <span>↗</span></button>';return;}
  const best=Object.entries(r.districts).sort((a,b)=>b[1].score_delta-a[1].score_delta)[0];
  const alt=state.alternative;
  $('drawer-content').innerHTML=`<div class="result-number"><span class="old-score">${fmt(r.baseline.score)} →</span> ${fmt(r.result.score)}</div><p class="result-gain">${sign(r.score_delta)} к качеству жизни</p><div class="snapshot-tabs" role="group" aria-label="Состояние города">${['before','after'].map(v=>`<button data-snapshot="${v}" class="${state.snapshot===v?'active':''}" aria-pressed="${state.snapshot===v}">${v==='before'?'До':'После'}</button>`).join('')}</div><p class="source-label">Меняются игровые слои. Реальная карта остаётся прежней.</p><div class="insight"><span>Критические показатели</span><strong>${r.baseline.n_crit} → ${r.result.n_crit}</strong></div><div class="insight"><span>Наибольший прирост · ${esc(best[0])}</span><strong>${sign(best[1].score_delta)}</strong></div><div class="insight"><span>Использовано бюджета</span><strong>${r.total_cost} / 100</strong></div>
  <details id="comparison-details"><summary>Другой сценарий</summary><div>${alt?`<div class="scenario-tabs"><button data-branch="mine" class="${state.branch==='mine'?'active':''}">Моя Астана</button><button data-branch="alternative" class="${state.branch==='alternative'?'active':''}">Альтернатива</button></div><p class="description">${esc(state.data.measures[alt.replaced.measure_id].name)} → ${esc(state.data.measures[alt.replacement.measure_id].name)} · ${esc(alt.replacement.district||'Весь город')}</p><div class="comparison-row"><span>Разница качества жизни</span><strong>${sign(alt.comparison.score_delta)}</strong></div>${Object.entries(alt.comparison.district_deltas).map(([name,delta])=>`<div class="comparison-row"><span>${esc(name)}</span><span class="${delta<0?'negative':'positive'}">${sign(delta)}</span></div>`).join('')}<p class="source-label">Лучшая из ${alt.checked} допустимых замен одной меры, не глобальный оптимум.</p>`:`<button id="alternative" class="secondary wide" ${state.alternativeBusy?'disabled':''}>${state.alternativeBusy?'Сравниваем варианты…':'Найти альтернативу ↗'}</button>`}</div></details>
  <details id="reactions-details"><summary>Реакции жителей</summary><div><button class="text-button" data-ai="result" ${state.aiBusy||!state.data.ai_available?'disabled':''}>${state.aiBusy?'Готовим тексты…':'✦ Обновить с AI'}</button><span class="source-label">Синтетические реакции · ${story.source==='ai'?'AI':'локальные тексты'}</span>${story.citizen_reactions.map(v=>`<div class="reaction"><strong>${esc(v.district)}</strong><p>«${esc(v.message)}»</p></div>`).join('')}</div></details>
  <details id="press-details"><summary>Пресс-конференция</summary><div><p class="description">${esc(story.press_question.question)}</p><label class="source-label" for="press-answer">Ваш ответ</label><textarea id="press-answer" maxlength="3000" placeholder="Расскажите о ваших приоритетах…">${esc(state.answer)}</textarea><button id="feedback" class="secondary wide" ${state.aiBusy?'disabled':''}>${state.data.ai_available?'Получить отзыв AI':'Памятка для ответа'}</button><p id="feedback-text" class="feedback">${esc(state.feedback)}</p><span class="source-label">Ответ не влияет на оценку города.</span></div></details>`;
}
function renderAdvisor(){
  const name=state.district||Object.keys(state.data.districts).sort((a,b)=>priorityProblems(a)[0][1]-priorityProblems(b)[0][1])[0];
  const [key,value]=priorityProblems(name)[0];const story=displayedResult()?currentAftermath():null;
  $('advisor-content').innerHTML=`<p class="advisor-insight">${esc(name)}: стоит обратить внимание на ${esc(state.data.indicators[key].toLowerCase())}.</p>${story?.source==='ai'?`<p class="description">${esc(story.citizen_reactions.find(r=>r.district===name)?.message||'')}</p>`:''}<span class="source-label">По показателям ${displayedResult()?'после симуляции':'исходного состояния'}</span><div class="advisor-actions"><button class="primary" data-focus-district="${districtByName[name].id}">Показать</button><button class="secondary" data-advisor-decisions="${key}" data-district="${esc(name)}">Что можно сделать?</button></div><details><summary>Почему?</summary><p>${esc(state.data.indicators[key])}: ${fmt(value)} / 100. ${severityNames[severity(value)]}. Это самый низкий показатель выбранного района.</p></details>`;
}
function render(){renderHeader();renderMap();renderInspector();renderDrawer();if(state.context==='advisor')renderAdvisor();syncSurfaces();}
async function simulate(){
  if(!state.valid||state.busy)return;
  state.revision++;const revision=state.revision;state.busy=true;state.result=null;state.alternative=null;state.branch='mine';state.snapshot='after';state.aftermath=null;state.quarter=0;state.answer='';state.feedback='';updatePlannedAppeals();showDrawer('map',false);render();
  try{
    const response=await api('/api/simulate',{plan:state.plan});
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    for(let q=1;q<=8;q++){
      if(revision!==state.revision)return;state.quarter=q;
      const starting=state.plan.filter(s=>state.data.measures[s.measure_id].lag+1===q);
      $('milestone').textContent=starting.length?starting.map(s=>`${state.data.measures[s.measure_id].name} — начинает работу${s.district?' · '+s.district:''}`).join('. '):q===8?'Подводим итоги…':'Город движется вперёд.';
      renderHeader();renderMap();await new Promise(resolve=>setTimeout(resolve,reduced?30:650));
    }
    if(revision!==state.revision)return;
    // Only now publish authoritative numeric state. Never interpolate Q1–Q7.
    state.result=response.result;state.aftermath=response.aftermath;state.appeals=response.appeals;state.busy=false;render();showDrawer('results');
  }catch(error){if(revision!==state.revision)return;state.busy=false;state.quarter=0;render();toast(error.message);}
}
async function findAlternative(){
  if(!state.result||state.busy||state.alternativeBusy)return;
  const revision=state.revision;state.alternativeBusy=true;renderDrawer();$('comparison-details').open=true;
  try{const value=await api('/api/alternative',{plan:state.plan});if(revision!==state.revision)return;if(!value.available){toast('Допустимых замен не найдено');return;}state.alternative=value;state.branch='alternative';state.snapshot='after';state.answer='';state.feedback='';render();if($('comparison-details'))$('comparison-details').open=true;}
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
    if('districtDecisions' in d){state.filter='Все';return showDrawer('decisions');}
    if(d.filter){state.filter=d.filter;return renderDrawer();}
    if(d.ai)return generateAI(d.ai);
    if(d.branch){state.branch=d.branch;state.snapshot='after';state.answer='';state.feedback='';render();$('comparison-details').open=true;return;}
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
  state.data=await api('/api/catalog');state.appeals=state.data.appeals;
  $('district-options').innerHTML=districts.map(d=>`<button data-focus-district="${d.id}">${esc(d.backendName)}</button>`).join('');
  map=new MapAdapter($('city-map'),{district:selectDistrict,issue:selectIssue,project:(id,name)=>{if(name)state.district=name;state.filter=state.data.measures[id].direction;showDrawer('decisions');},status:mapStatus});
  bindEvents();
  try{const saved=JSON.parse(localStorage.getItem('akim-map-plan-v1')||'null');if(Array.isArray(saved)&&saved.length<=5&&saved.every(s=>s&&Object.hasOwn(state.data.measures,s.measure_id)&&Object.keys(s).every(k=>['measure_id','district'].includes(k))&&(state.data.measures[s.measure_id].scope==='Город'?s.district==null:Object.hasOwn(state.data.districts,s.district||''))))state.plan=saved;}catch(_){}
  await changed();document.body.dataset.ready='true';
}
init().catch(error=>{toast(error.message);$('city-subtitle').textContent='Нет связи с сервером. Обновите страницу.';});
