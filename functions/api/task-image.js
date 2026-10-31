const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json;charset=utf-8","cache-control":"no-store"}});
const validId=id=>/^[a-zA-Z0-9_-]{1,70}$/.test(id||"");
function key(id,side,token){return "task-scenes/"+id+"/"+side+"-"+token+".jpg"}
export async function onRequest({request,env}){
 if(!env.TASK_IMAGES)return json({error:"אחסון R2 אינו מחובר"},503);
 const url=new URL(request.url);
 if(request.method==="GET"){
  const k=url.searchParams.get("key")||"";
  if(!/^task-scenes\/[a-zA-Z0-9_-]{1,70}\/(before|after|main)-[a-f0-9-]{16,50}\.jpg$/.test(k))return json({error:"Invalid key"},400);
  const obj=await env.TASK_IMAGES.get(k);if(!obj)return json({error:"Not found"},404);
  return new Response(obj.body,{headers:{"content-type":"image/jpeg","cache-control":"private,max-age=300","x-content-type-options":"nosniff"}});
 }
 if(request.method!=="POST")return json({error:"Method not allowed"},405);
 let p;try{p=await request.json()}catch{return json({error:"JSON invalid"},400)}
 if(!validId(p?.taskId)||!["before","after","main"].includes(p?.side)||typeof p?.name!=="string"||!p.name.trim()||p.name.length>100||typeof p?.description!=="string"||p.description.length>250)return json({error:"Invalid task"},400);
 if(!env.AI)return json({error:"Workers AI אינו מחובר. לא בוצעה יצירת תמונה בתשלום."},503);
 if(!env.HOME_DB)return json({error:"Database unavailable"},503);
 const row=await env.HOME_DB.prepare("SELECT data FROM app_state WHERE id=1").first();
 const state=JSON.parse(row?.data||"{}");
 const builtins=["bed","toys","clothes","laundry","books","desk","living","dishes","sweep","wipe","vacuum"];
 if(!builtins.includes(p.taskId)&&!(state.customTasks||[]).some(t=>t.id===p.taskId))return json({error:"Task not found"},404);
 // Prevent uncontrolled inference calls even if client is bypassed: limit 30 generations/day.
 const today=new Date().toISOString().slice(0,10);
 const limitKey="image-daily-"+today;
 const count=Number(await env.HOME_DB.prepare("SELECT count(*) as n FROM ai_image_usage WHERE day=?").bind(today).first().then(r=>r?.n).catch(()=>0));
 if(count>=30)return json({error:"הגעת למגבלת 30 תמונות ליום"},429);
 const calm="friendly colorful storybook illustration for young children, simple, wholesome, flat illustration, no text, no letters, no logos, no people,";
 const prompt=calm+" chore: "+p.name+". Context: "+p.description+". "+(p.side==="before"?"BEFORE: visibly messy or undone task, clear realistic objects, not dangerous.":p.side==="after"?"AFTER: same type of scene perfectly tidy, completed chore, cheerful neat appearance.":"A clear cheerful illustration depicting the task, suitable as a single recognizable task image.");
 try{
  const result=await env.AI.run("@cf/black-forest-labs/flux-1-schnell",{prompt:prompt.slice(0,1800),steps:4});
  if(!result?.image)throw Error("AI returned no image");
  const bytes=Uint8Array.from(atob(result.image),c=>c.charCodeAt(0));
  if(bytes.byteLength>3000000)throw Error("Image too large");
  const k=key(p.taskId,p.side,crypto.randomUUID());
  await env.TASK_IMAGES.put(k,bytes,{httpMetadata:{contentType:"image/jpeg"}});
  // Usage accounting is best effort; do not block storing successful output.
  await env.HOME_DB.prepare("INSERT INTO ai_image_usage(day, object_key) VALUES(?,?)").bind(today,k).run().catch(()=>{});
  return json({ok:true,key:k,url:"/api/task-image?key="+encodeURIComponent(k),side:p.side});
 }catch(e){return json({error:"יצירת התמונה נכשלה. נסו שוב מאוחר יותר."},502)}
}
