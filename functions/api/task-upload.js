const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const valid=id=>/^[A-Za-z0-9_-]{1,70}$/.test(id||"");
export async function onRequest({request,env}){
 if(request.method!=="POST")return json({error:"Method not allowed"},405);
 if(!env.TASK_IMAGES||!env.HOME_DB)return json({error:"Image storage unavailable"},503);
 let form;try{form=await request.formData()}catch{return json({error:"Invalid upload"},400)}
 const id=String(form.get("taskId")||""),pin=String(form.get("parentPin")||""),file=form.get("image");
 if(!valid(id)||!/^\d{4}$/.test(pin)||!file||typeof file.arrayBuffer!=="function")return json({error:"Invalid upload"},400);
 const row=await env.HOME_DB.prepare("SELECT data FROM app_state WHERE id=1").first();
 const state=JSON.parse(row?.data||"{}");
 if(!state.pin||state.pin!==pin)return json({error:"Parent verification failed"},403);
 const builtins=["bed","toys","clothes","laundry","books","desk","living","dishes","sweep","wipe","vacuum"];
 if(!builtins.includes(id)&&!(state.customTasks||[]).some(t=>t.id===id))return json({error:"Task not found"},404);
 if(file.type!=="image/jpeg"||file.size>2500000||file.size<100)return json({error:"Upload a JPEG image smaller than 2.5 MB"},400);
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return json({error:"Invalid JPEG"},400);
 const key="task-scenes/"+id+"/main-"+crypto.randomUUID()+".jpg";
 await env.TASK_IMAGES.put(key,bytes,{httpMetadata:{contentType:"image/jpeg"}});
 return json({ok:true,key,url:"/api/task-image?key="+encodeURIComponent(key)});
}