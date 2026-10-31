const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"content-type":"application/json;charset=utf-8","cache-control":"no-store"}});
export async function onRequestGet({env,request}){
 if(!env.TASK_IMAGES||!env.HOME_DB)return json({error:"מאגר התמונות אינו זמין"},503);
 const u=new URL(request.url),filter=u.searchParams.get("filter")||"all",taskId=u.searchParams.get("taskId")||"";
 if(!["all","task","unassigned"].includes(filter))return json({error:"Invalid filter"},400);
 const db=await env.HOME_DB.prepare("SELECT data FROM app_state WHERE id=1").first();
 const st=JSON.parse(db?.data||"{}");
 const linked=new Map();
 for(const [id,item] of Object.entries(st.taskImages||{}))for(const k of [item?.image,item?.after,item?.before].filter(Boolean)){if(!linked.has(k))linked.set(k,[]);linked.get(k).push(id)}
 if(st.defaultTaskImage){linked.set(st.defaultTaskImage,["default"])}
 const objects=[];let cursor;
 for(let page=0;page<10;page++){const batch=await env.TASK_IMAGES.list({prefix:"task-scenes/",limit:1000,...(cursor?{cursor}:{})});objects.push(...batch.objects);if(!batch.truncated||!batch.cursor)break;cursor=batch.cursor}
 const items=objects.map(x=>{const segments=x.key.split("/"),id=segments[1],assigned=linked.get(x.key)||[];return {key:x.key,taskId:id,assignedTo:assigned,createdAt:x.uploaded?.toISOString?.()||null,source:x.customMetadata?.source||(/main-/.test(x.key)?"ai-or-upload":"legacy"),url:"/api/task-image?key="+encodeURIComponent(x.key)}}).filter(x=>filter==="all"||(filter==="task"?x.taskId===taskId:!x.assignedTo.length)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 return json({items,total:items.length});
}