const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store"}});
function israelWeek(){
 const d=new Date();
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).formatToParts(d);
 const get=k=>parts.find(p=>p.type===k)?.value;
 const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'));
 const sunday=new Date(Date.UTC(Number(get('year')),Number(get('month'))-1,Number(get('day'))-day));
 return sunday.toISOString().slice(0,10);
}
export async function onRequest({request,env}){
 if(!env.HOME_DB)return json({error:'Database unavailable'},503);
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 let input;try{input=await request.json()}catch{return json({error:'Invalid request'},400)}
 const child=String(input?.child||''),pin=String(input?.pin||'');
 if(!/^(moshi|miri|racheli|chani|chayale|shrolik|shmili)$/.test(child)||!/^[0-9]{4}$/.test(pin))return json({error:'Invalid credentials'},403);
 const row=await env.HOME_DB.prepare('SELECT data FROM app_state WHERE id=1').first();
 const state=JSON.parse(row?.data||'{}');
 if(input.parent===true){
   if(!state.pin||pin!==state.pin)return json({error:'Parent authentication required'},403);
   return json({ok:true,parent:true});
 }
 if(!state.kidPins?.[child]||pin!==state.kidPins[child])return json({error:'Incorrect child PIN'},403);
 const week=israelWeek();
 const r=await env.HOME_DB.prepare('INSERT OR IGNORE INTO bank_print_limits (child_id,week_start) VALUES (?,?)').bind(child,week).run();
 if(r.meta?.changes!==1)return json({error:'Weekly printing limit reached',week},429);
 return json({ok:true,week});
}
