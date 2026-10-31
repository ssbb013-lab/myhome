const response=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json;charset=utf-8","cache-control":"no-store"}});
export async function onRequest({request,env}){
 if(!env.TASK_IMAGES||!env.HOME_DB)return response({error:'אחסון תמונות לא מחובר'},503);
 const u=new URL(request.url);
 if(request.method==='GET'){
  const key=u.searchParams.get('key')||'';
  if(!/^shop-scenes\/[a-f0-9-]{36}\.jpg$/.test(key))return response({error:'Invalid key'},400);
  const obj=await env.TASK_IMAGES.get(key);
  return obj?new Response(obj.body,{headers:{"content-type":"image/jpeg","cache-control":"private,max-age=300","x-content-type-options":"nosniff"}}):response({error:'Not found'},404);
 }
 if(request.method!=='POST')return response({error:'Method not allowed'},405);
 const row=await env.HOME_DB.prepare('SELECT data FROM app_state WHERE id=1').first();
 const s=JSON.parse(row?.data||'{}');
 const isParent=p=>String(p)===String(s.pin)&&!!s.pin;
 const contentType=request.headers.get('content-type')||'';
 let bytes;
 if(contentType.includes('multipart/form-data')){
  const form=await request.formData();if(!isParent(form.get('parentPin')))return response({error:'הורים בלבד'},403);
  const file=form.get('image');if(!file||file.type!=='image/jpeg'||file.size>2500000||file.size<100)return response({error:'יש להעלות תמונת JPG עד 2.5MB'},400);
  bytes=new Uint8Array(await file.arrayBuffer());if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return response({error:'תמונה לא תקינה'},400);
 }else{
  const p=await request.json().catch(()=>null);if(!p||!isParent(p.parentPin))return response({error:'הורים בלבד'},403);
  const name=String(p.name||'').trim(),description=String(p.description||'').trim();
  if(!name||name.length>80||description.length>250)return response({error:'נדרש שם מוצר'},400);
  if(!env.AI)return response({error:'AI אינו זמין'},503);
  const prompt='Professional realistic product catalog photography for a family reward shop, no text, no logo. Reward: '+name+'. Details: '+description+'. Bright warm studio background, clear subject.';
  const result=await env.AI.run('@cf/black-forest-labs/flux-1-schnell',{prompt,num_steps:4});
  if(!result?.image)return response({error:'AI did not return an image'},502);
  bytes=Uint8Array.from(atob(result.image),c=>c.charCodeAt(0));
 }
 const key='shop-scenes/'+crypto.randomUUID()+'.jpg';
 await env.TASK_IMAGES.put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}});
 return response({ok:true,key,url:'/api/shop-image?key='+encodeURIComponent(key)});
}