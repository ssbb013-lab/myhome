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
 if(input.parent===true && input.action!=='issue'){
   if(!state.pin||pin!==state.pin)return json({error:'Parent authentication required'},403);
   return json({ok:true,parent:true});
 }
 if(input.parent!==true&&(!state.kidPins?.[child]||pin!==state.kidPins[child]))return json({error:'Incorrect child PIN'},403);

 // Single-use parent-issued numeric override, stored in D1 and bound to a child.
 await env.HOME_DB.prepare('CREATE TABLE IF NOT EXISTS bank_print_passes (code_hash TEXT PRIMARY KEY, child_id TEXT NOT NULL, issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, used_at TEXT)').run();
 if(input.action==='issue'){
  if(!state.pin||pin!==state.pin||input.parent!==true)return json({error:'Parent authentication required'},403);
  const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);
  const code=String(10000000+(bytes[0]%90000000));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(child+':'+code)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const expires=new Date(Date.now()+7*86400000).toISOString();
  await env.HOME_DB.prepare('INSERT INTO bank_print_passes (code_hash,child_id,expires_at) VALUES (?,?,?)').bind(hash,child,expires).run();
  return json({ok:true,code,child,expires});
 }
 if(input.parent===true){if(!state.pin||pin!==state.pin)return json({error:'Parent authentication required'},403);return json({ok:true,parent:true})}
 const week=israelWeek();
 const r=await env.HOME_DB.prepare('INSERT OR IGNORE INTO bank_print_limits (child_id,week_start) VALUES (?,?)').bind(child,week).run();
 if(r.meta?.changes===1)return json({ok:true,week});
 const code=String(input.code||'');
 if(!/^[0-9]{8}$/.test(code))return json({error:'Weekly printing limit reached',week},429);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(child+':'+code)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const consumed=await env.HOME_DB.prepare("UPDATE bank_print_passes SET used_at=CURRENT_TIMESTAMP WHERE code_hash=? AND child_id=? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP").bind(hash,child).run();
 if(consumed.meta?.changes!==1)return json({error:'Invalid, expired or used code'},403);
 return json({ok:true,extra:true,week});

}
