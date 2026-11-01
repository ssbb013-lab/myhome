const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json;charset=utf-8","cache-control":"no-store"}});
const kids=['moshi','miri','racheli','chani','chayale','shrolik','shmili'];
function israelDay(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function period(frequency){
 const d=israelDay();if(frequency==='monthly')return d.slice(0,7);
 const utc=new Date(d+'T12:00:00Z'),weekday=utc.getUTCDay();utc.setUTCDate(utc.getUTCDate()-weekday);return utc.toISOString().slice(0,10);
}
function config(s){const x=s.bankInterestSettings||{};return {enabled:!!x.enabled,rate:Number.isFinite(Number(x.rate))?Number(x.rate):0,frequency:x.frequency==='monthly'?'monthly':'weekly',startPeriod:x.startPeriod||null}}
function checkingConfig(s){const x=s.bankCheckingInterestSettings||{};return {enabled:!!x.enabled,rate:Number.isFinite(Number(x.rate))?Number(x.rate):0,frequency:x.frequency==='monthly'?'monthly':'weekly',startPeriod:x.startPeriod||null}}
function checking(s,id){const points=Number(s.bankedPoints?.[id]||0);const baseline=Number(s.pointBaseline?.[id]||0);const earned=Object.entries(s.records||{}).reduce((n,[k,v])=>{if(v!=='approved'||k.split(':')[2]!==id)return n;const taskId=k.split(':').slice(3).join(':').replace(/__repeat[0-9]+$/,'');const task=(s.customTasks||[]).find(t=>t.id===taskId);return n+(Number.isInteger(s.taskChildPoints?.[taskId]?.[id])?s.taskChildPoints[taskId][id]:Number(s.taskPoints?.[taskId]??task?.points??({bed:10,toys:10,laundry:8,clothes:12,books:10,desk:12,living:15,dishes:12,sweep:15,wipe:15,vacuum:15}[taskId]||0)))+(s.calmReports?.[k]?1:0)},0);return points+Math.max(0,earned-baseline)+(s.bankLedger||[]).filter(t=>t.child===id&&t.status==='posted').reduce((n,t)=>n+Number(t.checking||0),0)}
function savings(s,id){return (s.bankLedger||[]).filter(t=>t.child===id&&t.status==='posted').reduce((n,t)=>n+Number(t.savings||0),0)}
async function accrue(db){
 for(let retry=0;retry<4;retry++){
  const row=await db.prepare('SELECT data,revision FROM app_state WHERE id=1').first();if(!row)return {error:'Missing state'};
  const state=JSON.parse(row.data||'{}'),cfg=config(state),checkingCfg=checkingConfig(state),current=period(cfg.frequency),checkingPeriod=period(checkingCfg.frequency);
  state.bankLedger||=[];state.bankInterestPeriods||=[];state.bankCheckingInterestPeriods||=[];
  const awards=[];let changed=false;
  if(cfg.enabled&&cfg.rate>0&&cfg.startPeriod&&current>cfg.startPeriod&&!state.bankInterestPeriods.includes(current)){
   for(const id of kids){const amount=Math.round(Math.max(0,savings(state,id))*cfg.rate/100);if(!amount)continue;state.bankLedger.push({id:crypto.randomUUID(),child:id,type:'interest',amount,checking:0,savings:amount,status:'posted',at:new Date().toISOString(),note:'ריבית '+cfg.rate+'% על חיסכון ('+(cfg.frequency==='weekly'?'שבועית':'חודשית')+')',interestPeriod:current});awards.push({child:id,amount,account:'savings'})}
   state.bankInterestPeriods.push(current);changed=true;
  }
  if(checkingCfg.enabled&&checkingCfg.rate>0&&checkingCfg.startPeriod&&checkingPeriod>checkingCfg.startPeriod&&!state.bankCheckingInterestPeriods.includes(checkingPeriod)){
   for(const id of kids){const amount=Math.round(Math.max(0,checking(state,id))*checkingCfg.rate/100);if(!amount)continue;state.bankLedger.push({id:crypto.randomUUID(),child:id,type:'checkingInterest',amount,checking:amount,savings:0,status:'posted',at:new Date().toISOString(),note:'ריבית '+checkingCfg.rate+'% על עו״ש ('+(checkingCfg.frequency==='weekly'?'שבועית':'חודשית')+')',interestPeriod:checkingPeriod});awards.push({child:id,amount,account:'checking'})}
   state.bankCheckingInterestPeriods.push(checkingPeriod);changed=true;
  }
  if(!changed)return {settings:cfg,checkingSettings:checkingCfg,current,awards:[]};
  const result=await db.prepare('UPDATE app_state SET data=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND revision=?').bind(JSON.stringify(state),row.revision).run();
  if(result.meta.changes)return {settings:cfg,checkingSettings:checkingCfg,current,awards,credited:true};
 }
 return {error:'Concurrent update, please retry'};
}
export async function onRequest({request,env}){
 if(!env.HOME_DB)return json({error:'Database unavailable'},503);const db=env.HOME_DB;
 if(request.method==='GET'){
  const r=await accrue(db);if(r.error)return json(r,409);
  const row=await db.prepare('SELECT data FROM app_state WHERE id=1').first(),s=JSON.parse(row?.data||'{}');
  return json({...r,checkingSettings:checkingConfig(s),checkingBalances:Object.fromEntries(kids.map(id=>[id,Math.max(0,checking(s,id))])),balances:Object.fromEntries(kids.map(id=>[id,Math.max(0,savings(s,id))])),lastAwards:(s.bankLedger||[]).filter(x=>x.type==='interest').slice(-14).map(x=>({child:x.child,amount:x.amount,at:x.at,note:x.note}))});
 }
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 let p;try{p=await request.json()}catch{return json({error:'Invalid JSON'},400)}
 const rate=Number(p.rate),frequency=p.frequency,account=p.account==='checking'?'checking':'savings';
 if(!Number.isFinite(rate)||rate<0||rate>100||!['weekly','monthly'].includes(frequency))return json({error:'ריבית צריכה להיות בין 0% ל-100%'},400);
 for(let n=0;n<4;n++){
  const row=await db.prepare('SELECT data,revision FROM app_state WHERE id=1').first(),s=JSON.parse(row?.data||'{}');
  if(!s.pin||String(p.pin)!==String(s.pin))return json({error:'Parent authentication required'},403);
  const previous=account==='checking'?checkingConfig(s):config(s);const key=account==='checking'?'bankCheckingInterestSettings':'bankInterestSettings';s[key]={enabled:!!p.enabled,rate,frequency,startPeriod:period(frequency)};
  // Changing the rate/frequency or enabling it begins at the current period, no retroactive bonus.
  if(previous.enabled&&previous.rate===rate&&previous.frequency===frequency&&p.enabled)s[key].startPeriod=previous.startPeriod||period(frequency);
  if(previous.enabled===!!p.enabled&&previous.rate===rate&&previous.frequency===frequency)return json({ok:true,settings:s[key]});
  if(account==='checking')s.bankCheckingInterestPeriods=[];else s.bankInterestPeriods=[];
  const result=await db.prepare('UPDATE app_state SET data=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND revision=?').bind(JSON.stringify(s),row.revision).run();
  if(result.meta.changes)return json({ok:true,settings:s.bankInterestSettings});
 }
 return json({error:'Concurrent change'},409);
}