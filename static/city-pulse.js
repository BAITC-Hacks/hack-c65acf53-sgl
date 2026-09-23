/** Branch-local presentation state. Numeric facts and history are never patched. */
function freezeFacts(value){
  if(value&&typeof value==='object'){Object.values(value).forEach(freezeFacts);Object.freeze(value);}
  return value;
}
export class CityPulse {
  constructor(bundle, previous=null) {
    this.bundle=freezeFacts(structuredClone(bundle));
    this.quarter=0;
    this.read=new Set();
    this.wording=new Map();
    // Rebuilding a draft/run must not announce the same read baseline concern
    // again. Alternative branches keep their own read state.
    if(previous?.branch===this.branch){
      const seen=new Set(previous.bundle.events.filter(e=>e.quarter===0&&previous.read.has(e.event_id)).map(e=>e.issue_id));
      for(const e of this.bundle.events)if(e.quarter===0&&seen.has(e.issue_id))this.read.add(e.event_id);
    }
  }
  get runId(){return this.bundle.run_id;}
  get branch(){return this.bundle.branch;}
  get current(){return this.quarter===8&&this.bundle.final?this.bundle.final:this.bundle.initial;}
  get events(){return this.bundle.events.filter(e=>e.quarter<=this.quarter).sort((a,b)=>b.quarter-a.quarter||a.event_id.localeCompare(b.event_id));}
  get unread(){return this.events.filter(e=>!this.read.has(e.event_id)).length;}
  publish(quarter){this.quarter=Math.max(this.quarter,Math.min(7,quarter));}
  finish(){if(this.bundle.final)this.quarter=8;}
  markRead(){for(const e of this.events)this.read.add(e.event_id);}
  text(item){return this.wording.get(item.event_id)||{message:item.message,source:'template'};}
  items(){
    const items=[...this.bundle.events];
    for(const stage of [this.bundle.initial,this.bundle.final])if(stage)items.push(stage.advisor.wording,...Object.values(stage.district_advisors).map(a=>a.wording));
    return items;
  }
  applyWording(response){
    if(response.run_id!==this.runId||response.branch!==this.branch||!Array.isArray(response.items))return false;
    const known=new Map(this.items().map(e=>[e.event_id,e]));
    const patches=new Map();
    for(const item of response.items){
      const event=known.get(item.event_id);
      if(!event||patches.has(item.event_id)||!event.allowed_messages.includes(item.message))return false;
      patches.set(item.event_id,{message:item.message,source:item.source==='ai'?'ai':'template'});
    }
    for(const [id,value] of patches)this.wording.set(id,value);
    return true;
  }
  issues(before=false){
    const snapshot=before?this.bundle.initial:this.current;
    return snapshot.issues.map(issue=>{
      const event=this.events.find(e=>e.issue_id===issue.id&&(before?e.quarter===0:e.source_basis===issue.source_basis));
      return event?{...issue,...this.text(event)}:issue;
    });
  }
}
