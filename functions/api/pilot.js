// Pilot-only API. This file is deployed from the pilot branch, not from main.
// Authentication is session-bound, and every family resource verifies server-side membership.
const reply=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff',...headers}});
const enc=new TextEncoder();
const toHex=b=>Array.from(new Uint8Array(b)).map(v=>v.toString(16).padStart(2,'0')).join('');
const randomHex=n=>{const b=new Uint8Array(n);crypto.getRandomValues(b);return toHex(b)};
const sha=async v=>toHex(await crypto.subtle.digest('SHA-256',enc.encode(v)));
const validEmail=x=>typeof x==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)&&x.length<=254;
const fail=(msg,status=400)=>reply({error:msg},status);
const SESSION_TTL=7*24*3600;
const familyIdOk=s=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s);
const uidOk=s=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s);
const getCookie=(r,key)=>(r.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(key+'='))?.slice(key.length+1)||'';
const cookie=(token,maxAge)=>'pilot_session='+token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge;
const digestPassword=async(password,salt)=>{
 const raw=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:Uint8Array.from(salt.match(/../g).map(n=>parseInt(n,16))),iterations:210000,hash:'SHA-256'},raw,256);
 return toHex(bits);
};
const safeCompare=(a,b)=>{let c=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)c|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return c===0};
async function userFromSession(db,request){
 const token=getCookie(request,'pilot_session');
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 const row=await db.prepare('SELECT u.id,u.email FROM pilot_sessions s JOIN pilot_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await sha(token),Math.floor(Date.now()/1000)).first();
 return row||null;
}
async function memberships(db,user){
 const rows=await db.prepare("SELECT f.id,f.name,f.slug,f.status,m.role FROM pilot_memberships m JOIN pilot_families f ON f.id=m.family_id WHERE m.user_id=? ORDER BY f.created_at DESC").bind(user.id).all();
 return rows.results||[];
}
async function authorizeFamily(db,user,familyId,manager=false){
 if(!familyIdOk(familyId))return null;
 const m=await db.prepare("SELECT m.role,f.status FROM pilot_memberships m JOIN pilot_families f ON f.id=m.family_id WHERE m.user_id=? AND m.family_id=?").bind(user.id,familyId).first();
 return m?.status==='active'&&(!manager||['owner','parent'].includes(m.role))?m:null;
}
async function publicSession(db,user){
 const fam=await memberships(db,user);
 const admin=await db.prepare("SELECT 1 AS ok FROM pilot_superadmins WHERE user_id=?").bind(user.id).first();
 return {authenticated:true,email:user.email,superadmin:!!admin,families:fam};
}
async function tooMany(db,key,failed=false){
 const now=Math.floor(Date.now()/900000),old=await db.prepare('SELECT window_start,failures FROM pilot_login_attempts WHERE key=?').bind(key).first();
 const count=old?.window_start===now?old.failures:0;
 if(failed)await db.prepare('INSERT INTO pilot_login_attempts(key,window_start,failures) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,failures=CASE WHEN window_start=excluded.window_start THEN failures+1 ELSE 1 END').bind(key,now).run();
 return count>=10;
}
async function loginKey(req,env){return sha('pilot:'+String(env.PILOT_RATE_SECRET||'pilot')+':'+(req.headers.get('cf-connecting-ip')||'unknown'))}
async function handlePilot({request,env}){
 const u=new URL(request.url);
 if(request.method==='GET'&&u.searchParams.get('health')==='1')return reply({ok:true,service:'pilot',database:!!env.PILOT_DB});
 const db=env.PILOT_DB;
 if(!db)return fail('סביבת הניסיון אינה מוגדרת',503);
 if(request.method==='GET'){
  const user=await userFromSession(db,request);
  if(!user)return reply({authenticated:false});
  const url=new URL(request.url),familyId=url.searchParams.get('family');
  if(!familyId)return reply(await publicSession(db,user));
  if(!await authorizeFamily(db,user,familyId))return fail('אין הרשאה למשפחה זו',403);
  const [children,tasks]=await db.batch([
    db.prepare('SELECT id,display_name,age FROM pilot_children WHERE family_id=? ORDER BY created_at').bind(familyId),
    db.prepare('SELECT id,title,points,assigned_child,created_at FROM pilot_tasks WHERE family_id=? ORDER BY created_at DESC').bind(familyId)
  ]);
  return reply({familyId,children:children.results||[],tasks:tasks.results||[]});
 }
 if(request.method!=='POST')return fail('Method not allowed',405);
 const sameOrigin=request.headers.get('origin');
 if(sameOrigin&&new URL(sameOrigin).origin!==new URL(request.url).origin)return fail('Cross-origin request denied',403);
 const contentType=request.headers.get('content-type')||'';
 if(!contentType.startsWith('application/json'))return fail('JSON required',415);
 let b;try{b=await request.json()}catch{return fail('בקשה לא תקינה')}
 const action=b?.action;
 if(action==='register'){
  const invite=String(b.invite||'').trim().toUpperCase(),email=String(b.email||'').trim().toLowerCase(),password=b.password;
  if(!/^[A-F0-9]{48}$/.test(invite)||!validEmail(email)||typeof password!=='string'||password.length<12||password.length>128)return fail('יש להזין הזמנה תקינה, מייל וסיסמה של 12 תווים לפחות');
  const key=await loginKey(request,env);
  if(await tooMany(db,key))return fail('יותר מדי ניסיונות. נסו שוב מאוחר יותר',429);
  const now=Math.floor(Date.now()/1000);
  const row=await db.prepare('SELECT role,family_id FROM pilot_invites WHERE code=? AND used_at IS NULL AND expires_at>?').bind(invite,now).first();
  if(!row){await tooMany(db,key,true);return fail('קוד ההזמנה שגוי, פג או כבר מומש',403)}
  const salt=randomHex(16),hash=await digestPassword(password,salt),userId=randomHex(16),token=randomHex(32);
  try{
   const statements=[
    db.prepare("UPDATE pilot_invites SET used_at=CURRENT_TIMESTAMP WHERE code=? AND used_at IS NULL AND expires_at>?").bind(invite,now),
    db.prepare('INSERT INTO pilot_users(id,email,password_hash,password_salt) VALUES(?,?,?,?)').bind(userId,email,hash,salt)
   ];
   statements.push(db.prepare('INSERT INTO pilot_invite_uses(code,user_id) VALUES(?,?)').bind(invite,userId));
   if(row.role==='superadmin')statements.push(db.prepare('INSERT INTO pilot_superadmins(user_id) VALUES(?)').bind(userId));
   else if(row.family_id)statements.push(db.prepare('INSERT INTO pilot_memberships(family_id,user_id,role) VALUES(?,?,?)').bind(row.family_id,userId,row.role));
   statements.push(db.prepare('INSERT INTO pilot_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha(token),userId,now+SESSION_TTL));
   const results=await db.batch(statements);
   if(results[0]?.meta?.changes!==1)throw Error('Invite already used');
   return reply({ok:true,...await publicSession(db,{id:userId,email})},200,{'set-cookie':cookie(token,SESSION_TTL)});
  }catch(e){return fail('הרישום לא הושלם. ייתכן שכתובת המייל כבר רשומה.',409)}
 }
 if(action==='login'){
  const email=String(b.email||'').trim().toLowerCase(),password=b.password;
  if(!validEmail(email)||typeof password!=='string')return fail('פרטי הכניסה שגויים',401);
  const key=await loginKey(request,env);
  if(await tooMany(db,key))return fail('יותר מדי ניסיונות. נסו שוב מאוחר יותר',429);
  const user=await db.prepare('SELECT id,email,password_hash,password_salt FROM pilot_users WHERE email=?').bind(email).first();
  const salt=user?.password_salt||'00'.repeat(16);
  const hash=await digestPassword(password,salt);
  if(!user||!safeCompare(hash,user.password_hash)){await tooMany(db,key,true);return fail('פרטי הכניסה שגויים',401)}
  const token=randomHex(32),now=Math.floor(Date.now()/1000);
  await db.prepare('INSERT INTO pilot_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha(token),user.id,now+SESSION_TTL).run();
  return reply({ok:true,...await publicSession(db,user)},200,{'set-cookie':cookie(token,SESSION_TTL)});
 }
 if(action==='logout'){
  const t=getCookie(request,'pilot_session');
  if(/^[a-f0-9]{64}$/.test(t))await db.prepare('DELETE FROM pilot_sessions WHERE token_hash=?').bind(await sha(t)).run();
  return reply({ok:true},200,{'set-cookie':cookie('',0)});
 }
 const user=await userFromSession(db,request);
 if(!user)return fail('יש להתחבר קודם',401);
 if(action==='createFamily'){
  const admin=await db.prepare('SELECT 1 ok FROM pilot_superadmins WHERE user_id=?').bind(user.id).first();
  if(!admin)return fail('אין הרשאת מנהל מערכת',403);
  const name=String(b.name||'').trim(),slug=String(b.slug||'').trim().toLowerCase();
  if(!name||name.length>100||!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug))return fail('יש להזין שם משפחה ומזהה באנגלית');
  const id=randomHex(16),invite=randomHex(24).toUpperCase(),expiry=Math.floor(Date.now()/1000)+7*86400;
  try{
   await db.batch([
    db.prepare('INSERT INTO pilot_families(id,name,slug,status) VALUES(?,?,?,?)').bind(id,name,slug,'active'),
    db.prepare("INSERT INTO pilot_family_state(family_id,revision,data) VALUES(?,1,'{}')").bind(id),
    db.prepare("INSERT INTO pilot_invites(code,role,family_id,expires_at) VALUES(?,'owner',?,?)").bind(invite,id,expiry)
   ]);
  }catch{return fail('שם מזהה המשפחה כבר קיים',409)}
  return reply({ok:true,family:{id,name,slug},invite,expiresAt:expiry});
 }
 if(action==='listAllFamilies'){
  const admin=await db.prepare('SELECT 1 ok FROM pilot_superadmins WHERE user_id=?').bind(user.id).first();
  if(!admin)return fail('אין הרשאת מנהל מערכת',403);
  const rows=await db.prepare("SELECT f.id,f.name,f.slug,f.status,f.created_at,COUNT(DISTINCT c.id) children,COUNT(DISTINCT m.user_id) parents FROM pilot_families f LEFT JOIN pilot_children c ON c.family_id=f.id LEFT JOIN pilot_memberships m ON m.family_id=f.id GROUP BY f.id ORDER BY f.created_at DESC").all();
  return reply({families:rows.results||[]});
 }
 const familyId=b.familyId;
 if(!await authorizeFamily(db,user,familyId,true))return fail('אין הרשאה למשפחה זו',403);
 if(action==='inviteParent'){
  const invite=randomHex(24).toUpperCase(),expiry=Math.floor(Date.now()/1000)+7*86400;
  await db.prepare("INSERT INTO pilot_invites(code,role,family_id,expires_at) VALUES(?,'parent',?,?)").bind(invite,familyId,expiry).run();
  return reply({invite,expiresAt:expiry});
 }
 if(action==='addChild'){
  const name=String(b.name||'').trim(),age=Number(b.age);
  if(!name||name.length>60||!Number.isInteger(age)||age<0||age>19)return fail('יש להזין שם וגיל תקינים');
  const id=randomHex(16);
  await db.prepare('INSERT INTO pilot_children(id,family_id,display_name,age) VALUES(?,?,?,?)').bind(id,familyId,name,age).run();
  return reply({ok:true,child:{id,name,age}});
 }
 if(action==='addTask'){
  const title=String(b.title||'').trim(),points=Number(b.points),childId=b.childId||null;
  if(!title||title.length>120||!Number.isInteger(points)||points<1||points>10000)return fail('יש להזין משימה וניקוד תקינים');
  if(childId&&!uidOk(childId))return fail('מזהה הילד אינו תקין');
  if(childId){
   const found=await db.prepare('SELECT 1 ok FROM pilot_children WHERE id=? AND family_id=?').bind(childId,familyId).first();
   if(!found)return fail('הילד לא שייך למשפחה זו',403);
  }
  const id=randomHex(16);
  await db.prepare('INSERT INTO pilot_tasks(id,family_id,title,points,assigned_child) VALUES(?,?,?,?,?)').bind(id,familyId,title,points,childId).run();
  return reply({ok:true,task:{id,title,points,childId}});
 }
 return fail('פעולה לא נתמכת',400);
}

export async function onRequest(context){
 try { return await handlePilot(context); }
 catch(err){console.error('Pilot API error',err);return reply({error:'אירעה שגיאה בעיבוד הבקשה',errorCode:'PILOT_API_RUNTIME'},500)}
}
