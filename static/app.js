import {CityMap, icon, measureIcons, geometry} from './city-map.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2});
const sign=n=>(n>0?'+':'')+fmt(n);
const statusNames={new:'НОВОЕ',planned:'В ПЛАНЕ',improved:'УЛУЧШЕНО',unresolved:'НЕ РЕШЕНО'};
const severityNames={critical:'КРИТИЧНО',high:'ВЫСОКИЙ ПРИОРИТЕТ',medium:'ТРЕБУЕТ ВНИМАНИЯ',normal:'В НОРМЕ'};
const state={data:null,plan:[],district:'Нура',issue:null,drawer:'map',filter:'Все',result:null,aftermath:null,appeals:[],alternative:null,branch:'mine',quarter:0,busy:false,revision:0,valid:false,showIssues:true,showProjects:true,aiBusy:false,answer:'',feedback:''};
let map,toastTimer;
const currentResult=()=>state.branch==='alternative'?state.alternative?.result:state.result;
const currentPlan=()=>state.branch==='alternative'?state.alternative.plan:state.plan;
const currentAftermath=()=>state.branch==='alternative'?state.alternative.aftermath:state.aftermath;
const currentAppeals=()=>state.branch==='alternative'?state.alternative.appeals:state.appeals;

async function api(path,body){
  const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const text=await response.text();let value;
  try{value=JSON.parse(text);}catch(_){throw new Error('Сервер вернул неверный ответ. Проверьте, что запущена новая версия app.py.');}
  if(!response.ok)throw new Error(value.errors?value.errors.map(x=>x.message).join(' '):value.error||'Не удалось выполнить запрос');
  return value;
}
function toast(message){clearTimeout(toastTimer);$('map-toast').textContent=message;$('map-toast').hidden=false;toastTimer=setTimeout(()=>{$('map-toast').hidden=true;},6500);}
function persist(){try{localStorage.setItem('akim-map-plan-v1',JSON.stringify(state.plan));}catch(_){/* Export remains available in private/restricted browser contexts. */}}
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
  state.revision++;state.result=null;state.aftermath=null;state.alternative=null;state.branch='mine';state.quarter=0;state.valid=false;state.feedback='';state.answer='';
  updatePlannedAppeals();persist();render();
  const errors=localErrors();
  if(errors.length||state.plan.length!==5)return;
  const revision=state.revision;
  $('plan-status').textContent='Проверяем план…';
  try{await api('/api/validate',{plan:state.plan});if(revision!==state.revision)return;state.valid=true;renderHeader();}
  catch(error){if(revision!==state.revision)return;$('plan-status').textContent=error.message;$('plan-status').classList.add('error');}
}
function renderHeader(){
  const result=currentResult(),plan=currentPlan();const cost=plan.reduce((n,s)=>n+state.data.measures[s.measure_id].cost,0);
  $('score').textContent=fmt(result?result.result.score:state.data.baseline.score);
  $('score-delta').textContent=result?`${sign(result.score_delta)} К ИСХОДНОМУ`:'БАЗОВЫЙ SCORE';
  $('budget').innerHTML=`${cost} <em>/ 100</em>`;$('budget-bar').style.width=`${Math.min(cost,100)}%`;$('budget-bar').style.background=cost>100?'var(--red)':'var(--gold)';
  $('count').innerHTML=`${plan.length} <em>/ 5</em>`;
  $('phase-title').textContent=state.busy?'Решения становятся частью города':result?(state.branch==='alternative'?'Альтернативная Астана':'Ваша Астана через два года'):'Город ждёт ваших решений';
  $('phase-label').textContent=state.busy?'СИМУЛЯЦИЯ':result?'РЕЗУЛЬТАТ':'ПЛАНИРОВАНИЕ';
  const errors=localErrors();
  $('plan-status').classList.toggle('error',errors.length>0);
  $('plan-status').textContent=state.busy?`Квартал ${state.quarter} / 8 · Проекты вводятся в работу`:errors.length?errors.join(' · '):state.plan.length!==5?`Выбрано ${state.plan.length} / 5 · Осталось ${100-cost} ед.`:state.valid?'План проверен. Город готов к изменениям.':'Проверяем план…';
  $('simulate').disabled=!state.valid||state.busy;
  $('simulate').innerHTML=state.busy?'<span>◌</span> Город меняется…':`<span>▶</span> ${result?'Повторить симуляцию':'Запустить симуляцию'}`;
  $('launch-note').textContent=state.branch==='alternative'?'Запуск вернёт исходный план':result?'Score рассчитан Python · Итоги в панели слева':'Одинаковый бюджет. Ваш выбор.';
  $('example').disabled=state.busy;$('reset').disabled=state.busy;$('import').disabled=state.busy;$('export').disabled=!state.valid||state.busy;
  $('time-label').textContent=state.busy?`КВАРТАЛ ${state.quarter}`:result?'ЧЕРЕЗ 2 ГОДА':'ПЛАНИРОВАНИЕ';
  $('timeline-note').textContent=state.busy?'Визуальная шкала · Score в финале':'Горизонт — 2 года';
  $('quarters').innerHTML=Array.from({length:8},(_,i)=>`<div class="quarter ${state.quarter>i?'done':''} ${state.quarter===i+1?'current':''}"><span>Q${i+1}</span></div>`).join('');
  document.body.classList.toggle('busy',state.busy);
}
function renderMap(){
  map.update({district:state.district,issue:state.issue,appeals:currentAppeals(),plan:currentPlan(),measures:state.data.measures,scores:currentResult()?.result||state.data.baseline,quarter:state.quarter,showIssues:state.showIssues,showProjects:state.showProjects});
}
function selectDistrict(name){if(!state.data.districts[name])return;state.district=name;state.issue=null;renderMap();renderInspector();if(state.drawer==='initiatives')renderDrawer();}
function selectIssue(id){const item=currentAppeals().find(a=>a.id===id);if(!item)return;state.district=item.district;state.issue=id;showDrawer('map');renderMap();renderInspector();}
function renderInspector(){
  const name=state.district,base=state.data.districts[name],result=currentResult(),district=result?.districts[name];
  const score=district?district.score_after:state.data.baseline.district_scores[name];
  $('district-id').textContent=`0${Object.keys(geometry).indexOf(name)+1} / 05`;
  const issues=currentAppeals().filter(a=>a.district===name);const selected=issues.find(a=>a.id===state.issue);
  const projects=currentPlan().filter(s=>s.district===name||state.data.measures[s.measure_id].scope==='Город');
  $('inspector-content').innerHTML=`<div class="district-heading"><h2>${esc(name)}</h2><div><strong>${fmt(score)}</strong><small>${district?`${sign(district.score_delta)} К БАЗЕ`:'РАЙОННЫЙ SCORE'}</small></div></div><p class="profile">${esc(base.profile)}<br><span class="eyebrow">${fmt(base.population_share*100)}% НАСЕЛЕНИЯ ГОРОДА</span></p>
    <div class="section-caption"><span>ПРИОРИТЕТНЫЕ ПРОБЛЕМЫ</span><span>${issues.length}</span></div>
    ${issues.map(a=>`<button class="issue-preview ${a.severity}" data-issue="${esc(a.id)}"><span class="issue-value">${fmt(a.value)}</span><strong>${esc(a.title)}</strong><small>${severityNames[a.severity]} · ${statusNames[a.status]}</small></button>`).join('')}
    ${selected?`<div class="appeal-detail"><span class="badge ${selected.severity}">${statusNames[selected.status]}</span><blockquote>«${esc(selected.message)}»</blockquote><span class="source-label">${esc(selected.resident_type)} · ${selected.source==='ai'?'AI-сгенерированное синтетическое обращение':'Синтетическое обращение · локальный шаблон'}</span><button class="accent wide" data-resolve="${esc(selected.category)}">Подобрать инициативу ↗</button></div>`:`<button class="wide" data-initiative-district="${name}">Инициативы для района ↗</button>`}
    <details ${selected?'':'open'}><summary>ВСЕ 10 ПОКАЗАТЕЛЕЙ</summary>${Object.entries(state.data.indicators).map(([key,label])=>{const before=base.indicators[key],after=district?district.after[key]:before,delta=after-before;return `<div class="indicator-row"><div class="indicator-line"><span>${esc(label)}</span><b>${fmt(after)}${delta?`<span class="delta">${sign(delta)}</span>`:''}</b></div><div class="indicator-track"><i class="before" style="width:${before}%"></i><i class="${after<40?'critical':''}" style="width:${after}%"></i></div></div>`;}).join('')}</details>
    <div class="section-caption"><span>ПРОЕКТЫ В РАЙОНЕ</span><span>${projects.length}</span></div>${projects.length?projects.map(s=>`<div class="project-list-item">${s.measure_id} · ${esc(state.data.measures[s.measure_id].name)}</div>`).join(''):'<p class="muted">Проекты пока не назначены.</p>'}`;
}
function renderDock(){
  const plan=currentPlan();
  $('project-slots').innerHTML=Array.from({length:5},(_,i)=>{
    const s=plan[i];if(!s)return `<button class="project-slot empty" data-slot="${i}" ${state.busy?'disabled':''}><b>+</b><small>Решение 0${i+1}</small></button>`;
    const m=state.data.measures[s.measure_id],active=state.quarter>m.lag;
    return `<article class="project-slot ${active?'active':''}"><div class="slot-strip"><span>${active?'В РАБОТЕ':'ЗАПЛАНИРОВАНО'}</span><span>${s.measure_id}</span></div><div class="slot-content" role="button" tabindex="0" data-edit="${s.measure_id}" aria-label="Изменить ${esc(m.name)}"><span class="slot-icon">${icon(measureIcons[s.measure_id])}</span><span><strong>${esc(m.name)}</strong><small>${esc(s.district||'Весь город')}</small></span></div><div class="slot-cost">${m.cost} ЕД. · ЛАГ ${m.lag} КВ.</div>${state.branch==='mine'?`<button class="slot-remove" data-remove="${s.measure_id}" aria-label="Убрать ${esc(m.name)}" ${state.busy?'disabled':''}>×</button>`:''}</article>`;
  }).join('');
}
function showDrawer(name){state.drawer=name;$('drawer').hidden=name==='map';for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('active',b.dataset.view===name);renderDrawer();}
function renderDrawer(){
  if(state.drawer==='map')return;
  const titles={appeals:'Журнал обращений',initiatives:'Городские инициативы',results:'Итоги вашей смены'};$('drawer-title').textContent=titles[state.drawer];
  if(state.drawer==='initiatives')renderInitiatives();else if(state.drawer==='appeals')renderAppeals();else renderResults();
}
function renderInitiatives(){
  const dirs=['Все',...new Set(Object.values(state.data.measures).map(m=>m.direction))];
  $('drawer-content').innerHTML=`<p class="description">Выберите меру и район. Эффекты указаны с учётом лага, для горизонта 2 года.</p><div class="filters">${dirs.map(d=>`<button class="filter-button ${state.filter===d?'active':''}" data-filter="${esc(d)}">${esc(d)}</button>`).join('')}</div>${Object.entries(state.data.measures).filter(([,m])=>state.filter==='Все'||state.filter===m.direction).map(([id,m])=>{
    const s=state.plan.find(s=>s.measure_id===id);return `<article class="initiative ${s?'selected':''}"><div class="initiative-head"><div><span class="code">${id} / ${esc(m.direction)}</span><h3>${esc(m.name)}</h3></div><strong class="cost">${m.cost}<small> ед.</small></strong></div><p>${esc(m.scope)} · Лаг ${m.lag} кв.<br>${Object.entries(m.scaled_effects).map(([k,v])=>`${esc(state.data.indicators[k])} ${sign(v)}`).join(' · ')}</p><div class="initiative-controls">${m.scope==='Район'?`<select data-measure-district="${id}" aria-label="Район для ${esc(m.name)}" ${state.busy?'disabled':''}>${Object.keys(state.data.districts).map(d=>`<option ${d===(s?.district||state.district)?'selected':''}>${esc(d)}</option>`).join('')}</select>`:'<span class="muted">Все 5 районов</span>'}<button class="${s?'':'accent'}" data-add="${id}" ${state.busy||(!s&&state.plan.length===5)?'disabled':''}>${s?'Убрать':'Добавить'}</button></div></article>`;
  }).join('')}`;
}
function renderAppeals(){
  $('drawer-content').innerHTML=`<p class="description">Два слабейших показателя каждого района. Критичность определяется численно, а тексты жителей — синтетические.</p><button class="wide" data-ai="appeals" ${state.aiBusy||!state.data.ai_available?'disabled':''}>${state.aiBusy?'◌ Генерация…':state.data.ai_available?'✦ Обновить тексты с AI':'Локальные обращения · AI не подключён'}</button>${currentAppeals().map(a=>`<article class="appeal-card"><div class="card-line"><span>${esc(a.district)}</span><span class="badge ${a.status==='improved'?'improved':a.severity}">${statusNames[a.status]}</span></div><h3>${esc(a.title)}</h3><span class="source-label">${severityNames[a.severity]} · ${esc(a.resident_type)}</span><p>«${esc(a.message)}»</p><div class="metric-line">${a.indicator_code} · ${fmt(a.before)}${currentResult()?` → ${fmt(a.value)}`:''} / 100</div><span class="source-label">${a.source==='ai'?'AI-сгенерированное синтетическое обращение':'Синтетическое обращение · локальный шаблон'}</span><button class="text-button" data-issue="${esc(a.id)}">Показать на карте ↗</button></article>`).join('')}`;
}
function renderResults(){
  const r=currentResult(),story=currentAftermath();
  if(!r){$('drawer-content').innerHTML='<p class="empty-note">Ваша смена ещё продолжается.<br>Изучите проблемы, выберите пять инициатив и запустите симуляцию. Здесь появятся итоговый Score, реакции жителей и пресс-конференция.</p>';return;}
  const alt=state.alternative;
  $('drawer-content').innerHTML=`<span class="eyebrow">ASTANA QUALITY OF LIFE</span><div class="result-number">${fmt(r.result.score)} <small>${sign(r.score_delta)}</small></div><p class="description">Было ${fmt(r.baseline.score)} · Бюджет ${r.total_cost}/100<br>Критические показатели: ${r.baseline.n_crit} → ${r.result.n_crit}</p>
    ${alt?`<div class="scenario-tabs"><button data-branch="mine" class="${state.branch==='mine'?'active':''}">Моя Астана</button><button data-branch="alternative" class="${state.branch==='alternative'?'active':''}">Альтернативная</button></div><p class="description">${alt.replaced.measure_id} → ${alt.replacement.measure_id} · ${esc(alt.replacement.district||'Весь город')}<br>Лучшая из ${alt.checked} допустимых замен одной меры; не глобальный оптимум.</p><div class="comparison-row"><span>Score альтернативы − моего</span><strong class="${alt.comparison.score_delta>=0?'positive':'negative'}">${sign(alt.comparison.score_delta)}</strong></div>${Object.entries(alt.comparison.district_deltas).map(([d,v])=>`<div class="comparison-row"><span>${esc(d)}</span><span class="${v>=0?'positive':'negative'}">${sign(v)}</span></div>`).join('')}`:`<button class="wide" id="alternative" ${state.busy?'disabled':''}>◇ Посмотреть альтернативную линию</button>`}
    <hr class="results-divider"><h3>Город говорит</h3><span class="source-label">Синтетические реакции жителей · ${story.source==='ai'?'AI':'локальные шаблоны'}</span><button class="wide" data-ai="result" ${state.aiBusy||!state.data.ai_available?'disabled':''}>${state.aiBusy?'◌ Генерация…':state.data.ai_available?'✦ Получить AI-реакции':'Реакции по данным модели'}</button>${story.citizen_reactions.map(v=>`<div class="reaction"><strong>${esc(v.district)} · ${esc(v.resident_type)}</strong><p>«${esc(v.message)}»</p></div>`).join('')}
    <hr class="results-divider"><h3>Пресс-конференция</h3><p class="press-question">«${esc(story.press_question.question)}»</p><label class="source-label" for="press-answer">Ваш ответ журналисту</label><textarea id="press-answer" maxlength="3000" placeholder="Объясните приоритет и оставшийся компромисс…">${esc(state.answer)}</textarea><button id="feedback" class="wide" ${state.aiBusy?'disabled':''}>${state.data.ai_available?'Получить отзыв AI':'Памятка для ответа'}</button><p class="feedback" id="feedback-text">${esc(state.feedback)}</p><span class="source-label">Пресс-конференция не влияет на Score.</span>`;
}
function render(){renderHeader();renderMap();renderInspector();renderDock();renderDrawer();}
async function simulate(){
  if(!state.valid||state.busy)return;
  state.revision++;const revision=state.revision;state.busy=true;state.result=null;state.alternative=null;state.branch='mine';state.aftermath=null;state.quarter=0;state.answer='';state.feedback='';updatePlannedAppeals();showDrawer('map');render();
  try{
    const response=await api('/api/simulate',{plan:state.plan});
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    for(let q=1;q<=8;q++){if(revision!==state.revision)return;state.quarter=q;renderHeader();renderMap();renderDock();await new Promise(resolve=>setTimeout(resolve,reduced?30:570));}
    if(revision!==state.revision)return;
    state.result=response.result;state.aftermath=response.aftermath;state.appeals=response.appeals;state.busy=false;render();toast(`Два года спустя. Score ${fmt(state.result.result.score)} · ${sign(state.result.score_delta)} к базе`);showDrawer('results');
  }catch(error){state.busy=false;state.quarter=0;render();toast(error.message);}
}
async function findAlternative(){
  if(!state.result||state.busy)return;const rev=state.revision;$('alternative').disabled=true;$('alternative').textContent='◌ Проверяем допустимые замены…';
  try{const value=await api('/api/alternative',{plan:state.plan});if(rev!==state.revision)return;if(!value.available){toast('Допустимых замен одной меры не найдено');return;}state.alternative=value;state.branch='alternative';state.answer='';state.feedback='';render();toast('На карте — альтернативная Астана. Переключайте временные линии в панели.');}
  catch(error){toast(error.message);renderDrawer();}
}
async function generateAI(kind){
  if(state.aiBusy)return;const revision=state.revision,branch=state.branch;state.aiBusy=true;renderDrawer();
  try{const value=await api(`/api/ai/${kind}`,{...(currentResult()?{plan:currentPlan()}:{}),...(kind==='feedback'?{answer:state.answer}:{})});if(revision!==state.revision||branch!==state.branch)return;
    if(kind==='appeals'){if(currentResult()){if(branch==='alternative')state.alternative.appeals=value.appeals;else state.appeals=value.appeals;}else{state.data.appeals=value.appeals;updatePlannedAppeals();}}
    else if(kind==='result'){if(branch==='alternative')state.alternative.aftermath=value;else state.aftermath=value;}
    else state.feedback=value.feedback;
    if(value.notice)toast(value.notice);
  }catch(error){toast(error.message);}finally{state.aiBusy=false;render();}
}
function tooltip(district,issue,event){
  const box=$('map-tooltip');if(!district||!event||!geometry[district]){box.hidden=true;return;}
  const r=currentResult(),a=currentAppeals().find(a=>a.id===issue),score=r?r.result.district_scores[district]:state.data.baseline.district_scores[district];
  box.innerHTML=`<strong>${esc(district.toUpperCase())}</strong>Score: ${fmt(score)}${a?`<span>${esc(a.title)} · ${fmt(a.value)}</span><span>${severityNames[a.severity]}</span>`:currentAppeals().filter(a=>a.district===district).map(a=>`<span>${esc(a.title)} · ${fmt(a.value)}</span>`).join('')}`;
  const rect=$('city-map').getBoundingClientRect();box.style.left=`${Math.max(4,Math.min(event.clientX-rect.left+14,rect.width-235))}px`;box.style.top=`${Math.max(80,Math.min(event.clientY-rect.top+12,rect.height-130))}px`;box.hidden=false;
}
function bindEvents(){
  document.querySelector('.rail').addEventListener('click',e=>{const button=e.target.closest('[data-view]');if(button)showDrawer(button.dataset.view);});
  $('drawer-close').onclick=()=>showDrawer('map');$('help').onclick=()=>$('help-dialog').showModal();$('help-close').onclick=()=>$('help-dialog').close();
  $('example').onclick=()=>{if(state.busy)return;state.plan=structuredClone(state.data.example);state.district='Нура';state.issue=null;changed();toast('Демо-план размещён. Нажмите «Запустить симуляцию».');};
  $('reset').onclick=()=>{if(state.busy)return;state.plan=[];state.issue=null;changed();showDrawer('map');map.reset();};
  $('simulate').onclick=simulate;
  $('zoom-in').onclick=()=>map.zoom(1.25);$('zoom-out').onclick=()=>map.zoom(.8);$('zoom-reset').onclick=()=>map.reset();
  for(const [id,key] of [['issues-toggle','showIssues'],['projects-toggle','showProjects']])$(id).onclick=()=>{state[key]=!state[key];$(id).classList.toggle('active',state[key]);$(id).setAttribute('aria-pressed',String(state[key]));renderMap();};
  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-issue],[data-resolve],[data-initiative-district],[data-slot],[data-edit],[data-remove],[data-add],[data-filter],[data-ai],[data-branch],#alternative,#feedback');
    if(!button||button.closest('#city-map'))return;
    const d=button.dataset;
    if(d.issue)return selectIssue(d.issue);
    if(d.resolve){state.filter=d.resolve;return showDrawer('initiatives');}
    if(d.initiativeDistrict){state.filter='Все';return showDrawer('initiatives');}
    if(d.slot!==undefined||d.edit){state.filter=d.edit?state.data.measures[d.edit].direction:'Все';showDrawer('initiatives');return;}
    if(d.filter){state.filter=d.filter;return renderDrawer();}
    if(d.ai)return generateAI(d.ai);
    if(d.branch){state.branch=d.branch;state.answer='';state.feedback='';return render();}
    if(button.id==='alternative')return findAlternative();
    if(button.id==='feedback'){state.answer=$('press-answer').value.trim();if(!state.answer)return toast('Сначала напишите ответ журналисту.');return generateAI('feedback');}
    if(state.busy)return;
    if(d.remove){state.plan=state.plan.filter(s=>s.measure_id!==d.remove);return changed();}
    if(d.add){const id=d.add,index=state.plan.findIndex(s=>s.measure_id===id);if(index>=0)state.plan.splice(index,1);else if(state.plan.length<5){const m=state.data.measures[id];const select=document.querySelector(`[data-measure-district="${id}"]`);state.plan.push({measure_id:id,...(m.scope==='Район'?{district:select.value}:{})});}return changed();}
  });
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-edit]')){e.preventDefault();e.target.click();}});
  $('drawer-content').addEventListener('change',e=>{if(!e.target.matches('[data-measure-district]')||state.busy)return;const s=state.plan.find(s=>s.measure_id===e.target.dataset.measureDistrict);if(s){s.district=e.target.value;changed();}});
  $('drawer-content').addEventListener('input',e=>{if(e.target.id==='press-answer')state.answer=e.target.value;});
  $('import').onclick=()=>$('file').click();$('file').onchange=async()=>{try{const file=$('file').files[0];if(!file)return;if(file.size>32768)throw new Error('Максимальный размер плана — 32 КБ');const plan=JSON.parse((await file.text()).replace(/^\uFEFF/,''));await api('/api/validate',{plan});if(state.busy)return;state.plan=plan;await changed();toast('План импортирован. Запустите симуляцию.');}catch(error){toast(error.message);}finally{$('file').value='';}};
  $('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(currentPlan(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='astana-plan.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
}
async function init(){
  state.data=await api('/api/catalog');state.appeals=state.data.appeals;
  map=new CityMap($('city-map'),{district:selectDistrict,issue:selectIssue,project:(id,name)=>{selectDistrict(name);state.filter=state.data.measures[id].direction;showDrawer('initiatives');},hover:tooltip});
  bindEvents();
  try{const saved=JSON.parse(localStorage.getItem('akim-map-plan-v1')||'null');if(Array.isArray(saved)&&saved.length<=5&&saved.every(s=>s&&Object.hasOwn(state.data.measures,s.measure_id)&&Object.keys(s).every(k=>['measure_id','district'].includes(k))))state.plan=saved;}catch(_){/* Corrupt local drafts do not block the map. */}
  await changed();document.body.dataset.ready='true';
}
init().catch(error=>{toast(error.message);$('plan-status').textContent='Не удалось загрузить данные. Запустите python app.py и обновите страницу.';$('connection').textContent='● НЕТ СОЕДИНЕНИЯ';});
