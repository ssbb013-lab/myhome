const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
const childrenIds=new Set(["moshi","miri","racheli","chani","chayale","shrolik","shmili"]);
const text=v=>typeof v==="string"?v:"";
const eq=(a,b)=>{a=text(a);b=text(b);let d=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0};
const randomCode=()=>{let r=new Uint32Array(1);crypto.getRandomValues(r);return String(r[0]%100000000).padStart(8,"0")};
async function appState(db){const row=await db.prepare("SELECT data FROM app_state WHERE id=1").first();return JSON.parse(row?.data||"{}")}
async function failOrLocked(db,key,bucket,failed=false){
 const old=await db.prepare("SELECT failures,bucket FROM voucher_attempts WHERE key=?").bind(key).first();
 if(old?.bucket===bucket&&old.failures>=8)return true;
 if(failed)await db.prepare("INSERT INTO voucher_attempts (key,bucket,failures) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN bucket=excluded.bucket THEN failures+1 ELSE 1 END,bucket=excluded.bucket").bind(key,bucket).run();
 return false;
}
async function attemptKey(req,secret){const ip=req.headers.get("cf-connecting-ip")||"unknown";const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret+"|vouchers|"+ip));return [...new Uint8Array(bytes)].slice(0,12).map(x=>x.toString(16).padStart(2,"0")).join("")}
function voucherSafe(row){return {code:row.code,title:row.title,points:row.points,assigned_child:row.assigned_child,expires_at:row.expires_at,status:row.status,created_at:row.created_at,redeemed_by:row.redeemed_by,redeemed_at:row.redeemed_at,voided_at:row.voided_at}}
export async function onRequest({request,env}){
 const db=env.HOME_DB;if(!db)return json({error:"מסד הנתונים אינו מחובר"},503);
 if(request.method==="GET"){
  const u=new URL(request.url);if(u.searchParams.get("view")!=="balances")return json({error:"Bad request"},400);
  const data=await db.prepare("SELECT child_id,SUM(delta) AS amount FROM voucher_ledger GROUP BY child_id").all();
  const balances=Object.fromEntries((data.results||[]).map(r=>[r.child_id,r.amount]));
  const recent=await db.prepare("SELECT l.child_id,l.delta,l.kind,l.created_at,v.title FROM voucher_ledger l LEFT JOIN vouchers v ON v.code=l.code ORDER BY l.created_at DESC,l.id DESC LIMIT 120").all();
  return json({balances,transactions:recent.results||[]});
 }
 if(request.method!=="POST")return json({error:"Method not allowed"},405);
 let b;try{b=await request.json()}catch{return json({error:"בקשה לא תקינה"},400)}
 if(!b||typeof b!=="object")return json({error:"בקשה לא תקינה"},400);
 const action=text(b.action);
 const st=await appState(db);
 const parentOk=/^\d{4}$/.test(text(b.parentPin))&&eq(st.pin,b.parentPin);
 const childId=text(b.childId),childPin=text(b.childPin);
 const kidOk=childrenIds.has(childId)&&/^\d{4}$/.test(childPin)&&eq(st.kidPins?.[childId],childPin);
 const key=await attemptKey(request,env.FAMILY_SESSION_SECRET||"home");
 const bucket=Math.floor(Date.now()/900000);
 if(await failOrLocked(db,key,bucket))return json({error:"בוצעו יותר מדי ניסיונות. נסו שוב בעוד 15 דקות."},429);
 if(["list","create","cancel","reverse"].includes(action)){
  if(!parentOk){await failOrLocked(db,key,bucket,true);return json({error:"קוד ההורים אינו תקין"},403)}
  if(action==="list"){
   const rows=await db.prepare("SELECT * FROM vouchers ORDER BY created_at DESC,code DESC LIMIT 2000").all();
   return json({vouchers:(rows.results||[]).map(voucherSafe)});
  }
  if(action==="create"){
   const points=Number(b.points),quantity=Number(b.quantity),title=text(b.title).trim().slice(0,80);
   const assignedChild=b.assignedChild?text(b.assignedChild):null;
   const expiry=b.expiresAt?text(b.expiresAt):null;
   if(!Number.isInteger(points)||points<1||points>10000||!Number.isInteger(quantity)||quantity<1||quantity>100||assignedChild&&!childrenIds.has(assignedChild)||expiry&&!/^\d{4}-\d{2}-\d{2}$/.test(expiry))return json({error:"ערכי השובר אינם תקינים"},400);
   const created=[];let tries=0;
   while(created.length<quantity&&tries<quantity*10){
    tries++;
    const code=randomCode();
    const result=await db.prepare("INSERT OR IGNORE INTO vouchers(code,title,points,assigned_child,expires_at,status) VALUES(?,?,?,?,?,'available')").bind(code,title||"שובר מתנה",points,assignedChild,expiry).run();
    if(result.meta?.changes)created.push(code);
   }
   if(created.length!==quantity)return json({error:"נוצרו רק חלק מהשוברים. בדקו ברשימה לפני ניסיון נוסף.",codes:created},503);
   return json({ok:true,codes:created});
  }
  const code=text(b.code);
  if(!/^\d{8}$/.test(code))return json({error:"קוד השובר אינו תקין"},400);
  if(action==="cancel"){
   const r=await db.prepare("UPDATE vouchers SET status='cancelled',voided_at=CURRENT_TIMESTAMP WHERE code=? AND status='available'").bind(code).run();
   return r.meta?.changes?json({ok:true}):json({error:"ניתן לבטל רק שובר שלא מומש"},409);
  }
  if(action==="reverse"){
   try{
    const rs=await db.batch([
     db.prepare("UPDATE vouchers SET status='reversed',voided_at=CURRENT_TIMESTAMP WHERE code=? AND status='redeemed'").bind(code),
     db.prepare("INSERT INTO voucher_ledger(code,child_id,delta,kind) SELECT code,redeemed_by,-points,'reversal' FROM vouchers WHERE code=? AND status='reversed'").bind(code)
    ]);
    return rs[0].meta?.changes===1&&rs[1].meta?.changes===1?json({ok:true}):json({error:"ניתן לבטל זיכוי רק לשובר שמומש"},409);
   }catch(e){return json({error:"לא ניתן לבטל את הזיכוי"},409)}
  }
 }
 if(action==="redeem"){
  if(!childrenIds.has(childId)||(!kidOk&&!parentOk)){await failOrLocked(db,key,bucket,true);return json({error:"יש להזין קוד ילד או קוד הורים תקין"},403)}
  const code=text(b.code);if(!/^\d{8}$/.test(code)){await failOrLocked(db,key,bucket,true);return json({error:"יש להזין שמונה ספרות"},400)}
  const v=await db.prepare("SELECT code,points,assigned_child,expires_at,status FROM vouchers WHERE code=?").bind(code).first();
  if(!v){await failOrLocked(db,key,bucket,true);return json({error:"השובר לא נמצא"},404)}
  if(v.status!=="available")return json({error:"השובר כבר מומש או בוטל"},409);
  if(v.assigned_child&&v.assigned_child!==childId)return json({error:"השובר מיועד לילד אחר"},403);
  if(v.expires_at&&v.expires_at<(new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jerusalem"})))return json({error:"תוקף השובר פג"},409);
  try{
   const rs=await db.batch([
    db.prepare("UPDATE vouchers SET status='redeemed',redeemed_by=?,redeemed_at=CURRENT_TIMESTAMP WHERE code=? AND status='available' AND (assigned_child IS NULL OR assigned_child=?) AND (expires_at IS NULL OR expires_at >= ?)").bind(childId,code,childId,new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jerusalem"})),
    db.prepare("INSERT INTO voucher_ledger (code,child_id,delta,kind) SELECT code,redeemed_by,points,'redemption' FROM vouchers WHERE code=? AND status='redeemed' AND redeemed_by=?").bind(code,childId)
   ]);
   if(rs[0].meta?.changes!==1||rs[1].meta?.changes!==1)return json({error:"השובר כבר מומש"},409);
   const sum=await db.prepare("SELECT COALESCE(SUM(delta),0) balance FROM voucher_ledger WHERE child_id=?").bind(childId).first();
   return json({ok:true,points:v.points,balance:sum.balance});
  }catch(e){return json({error:"השובר כבר מומש או התרחשה התנגשות. נסו לרענן."},409)}
 }
 return json({error:"פעולה לא מוכרת"},400);
}
