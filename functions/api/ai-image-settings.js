const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json;charset=utf-8","cache-control":"no-store"}});
export async function onRequest({request,env}){
 if(!env.HOME_DB)return json({error:"Database unavailable"},503);
 const db=env.HOME_DB;
 if(request.method==="GET"){
  const row=await db.prepare("SELECT data FROM app_state WHERE id=1").first();
  const state=JSON.parse(row?.data||"{}");
  const day=new Date().toISOString().slice(0,10);
  const usage=await db.prepare("SELECT COUNT(*) AS count FROM ai_image_usage WHERE day=?").bind(day).first();
  const value=Number(state.aiDailyImageLimit),limit=Number.isInteger(value)&&value>=1&&value<=1000?value:50;
  return json({day,count:Number(usage?.count||0),limit});
 }
 if(request.method!=="POST")return json({error:"Method not allowed"},405);
 let input;try{input=await request.json()}catch{return json({error:"Invalid JSON"},400)}
 const limit=Number(input?.limit);if(!Number.isInteger(limit)||limit<1||limit>1000)return json({error:"יש להזין מגבלה בין 1 ל-1000"},400);
 const row=await db.prepare("SELECT data,revision FROM app_state WHERE id=1").first();
 const state=JSON.parse(row?.data||"{}");
 if(!state.pin||String(input.pin)!==String(state.pin))return json({error:"נדרש קוד הורים"},403);
 state.aiDailyImageLimit=limit;
 const result=await db.prepare("UPDATE app_state SET data=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND revision=?").bind(JSON.stringify(state),row.revision).run();
 if(!result.meta.changes)return json({error:"נתונים השתנו - נסו שוב"},409);
 return json({ok:true,limit});
}