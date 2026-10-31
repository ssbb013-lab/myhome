const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json;charset=utf-8","cache-control":"no-store"}});
const kids=['moshi','miri','racheli','chani','chayale','shrolik','shmili'];
function israelDay(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function period(frequency){
 const d=israelDay();if(frequency==='monthly')return d.slice(0,7);
 const utc=new Date(d+'T12:00:00Z'),weekday=utc.getUTCDay();utc.setUTCDate(utc.getUTCDate()-weekday);return utc.toISOString().slice(0,10);
}
function config(s){const x=s.bankInterestSettings||{};return {enabled:!!x.enabled,rate:Number.isFinite(Number(x.rate))?Number(x.rate):0,frequency:x.frequency==='monthly'?'monthly':'weekly',startPeriod:x.startPeriod||null}}
function savings(s,id){return (s.bankLedger||[]).filter(t=>t.child===id&&t.status==='posted').reduce((n,t)=>n+Number(t.savings||0),0)}
async function accrue(db){
 for(let retry=0;retry<4;retry++){
  const row=await db.prepare('SELECT data,revision FROM app_state WHERE id=1').first();if(!row)return {error:'Missing state'};
  const state=JSON.parse(row.data||'{}'),cfg=config(state),current=period(cfg.frequency);
  if(!cfg.enabled||cfg.rate<=0||!cfg.startPeriod||current<=cfg.startPeriod)return {settings:cfg,current,awards:[]};
  const already=(state.bankInterestPeriods||[]).includes(current);
  if(already)return {settings:cfg,current,awards:[]};
  state.bankLedger||=[];state.bankInterestPeriods||=[];
  const at=new Date().toISOString(),awards=[];
  for(const id of kids){
   const balance=Math.max(0,savings(state,id)),amount=Math.round(balance*cfg.rate/100);
   if(amount<=0)continue;
   const transaction={id:crypto.randomUUID(),child:id,type:'interest',amount,checking:0,savings:amount,status:'posted',at,note:'ריבית '+cfg.rate+'% על חיסכון ('+(cfg.frequency==='weekly'?'שבועית':'חודשית')+')',interestPeriod:current};
   state.bankLedger.push(transaction);awards.push({child:id,amount});
  }
  // Record the period even when every account earned less than half a star.
  state.bankInterestPeriods.push(current);
  const result=await db.prepare('UPDATE app_state SET data=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND revision=?').bind(JSON.stringify(state),row.revision).run();
  if(result.meta.changes)return {settings:cfg,current,awards,credited:true};
 }
 return {error:'Concurrent update, please retry'};
}
export async function onRequest({request,env}){
 if(!env.HOME_DB)return json({error:'Database unavailable'},503);const db=env.HOME_DB;
 if(request.method==='GET'){
  const r=await accrue(db);if(r.error)return json(r,409);
  const row=await db.prepare('SELECT data FROM app_state WHERE id=1').first(),s=JSON.parse(row?.data||'{}');
  return json({...r,balances:Object.fromEntries(kids.map(id=>[id,Math.max(0,savings(s,id))])),lastAwards:(s.bankLedger||[]).filter(x=>x.type==='interest').slice(-14).map(x=>({child:x.child,amount:x.amount,at:x.at,note:x.note}))});
 }
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 let p;try{p=await request.json()}catch{return json({error:'Invalid JSON'},400)}
 const rate=Number(p.rate),frequency=p.frequency;
 if(!Number.isFinite(rate)||rate<0||rate>100||!['weekly','monthly'].includes(frequency))return json({error:'ריבית צריכה להיות בין 0% ל-100%'},400);
 for(let n=0;n<4;n++){
  const row=await db.prepare('SELECT data,revision FROM app_state WHERE id=1').first(),s=JSON.parse(row?.data||'{}');
  if(!s.pin||String(p.pin)!==String(s.pin))return json({error:'Parent authentication required'},403);
  const previous=config(s);s.bankInterestSettings={enabled:!!p.enabled,rate,frequency,startPeriod:period(frequency)};
  // Changing the rate/frequency or enabling it begins at the current period, no retroactive bonus.
  if(previous.enabled&&previous.rate===rate&&previous.frequency===frequency&&p.enabled)s.bankInterestSettings.startPeriod=previous.startPeriod||period(frequency);
  if(previous.enabled===!!p.enabled&&previous.rate===rate&&previous.frequency===frequency)return json({ok:true,settings:s.bankInterestSettings});
  s.bankInterestPeriods=[];
  const result=await db.prepare('UPDATE app_state SET data=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND revision=?').bind(JSON.stringify(s),row.revision).run();
  if(result.meta.changes)return json({ok:true,settings:s.bankInterestSettings});
 }
 return json({error:'Concurrent change'},409);
}