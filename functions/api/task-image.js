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
 if(!env.AI)return json({error:"Workers AI אינו זמין בפריסה הנוכחית. ודאו שהחיבור AI מוגדר ב-Production ובצעו פריסה חדשה."},503);
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
 const scenes={
 bed:"A neatly made BED with a pillow, folded duvet and straight bedsheet in a children's bedroom",
 toys:"Toys neatly organized in toy bins and boxes in a children's playroom",
 clothes:"Folded clothing arranged neatly in a wardrobe and drawers",
 laundry:"Dirty clothes being placed into a laundry basket",
 books:"Children's books neatly organized upright on a bookshelf",
 desk:"A tidy study desk with pencils, notebook, and school supplies organized",
 living:"A clean and tidy living room with arranged sofa cushions",
 dishes:"Clean dishes and cups stacked neatly next to a kitchen sink",
 sweep:"A broom sweeping crumbs from a kitchen floor",
 wipe:"A cleaning cloth wiping a table surface",
 vacuum:"A vacuum cleaner cleaning a carpet"
 };
 const hebrewScenes=[
 [/מיטה|מיטות|מצעים|כרית/,scenes.bed],
 [/צעצוע|משחקים|לגו/,scenes.toys],
 [/כביסה|בגד מלוכלך|סל כביסה/,scenes.laundry],
 [/בגדים|ארון|קיפול/,scenes.clothes],
 [/ספרים|ספריה|מדף ספר/,scenes.books],
 [/שולחן|שיעורי בית|כתיבה/,scenes.desk],
 [/מטבח|כלים|צלחות|כוסות/,scenes.dishes],
 [/סלון|ספה|כריות הספה/,scenes.living],
 [/טאטוא|מטאטא/,scenes.sweep],
 [/ניגוב|מטלית|לנגב/,scenes.wipe],
 [/שואב|שאיבה|שטיח/,scenes.vacuum],
 [/פח|אשפה|זבל/,"A child placing a tied rubbish bag inside a trash bin"],
 [/נעליים|נעל/,"A pair of shoes neatly arranged on a shoe rack"],
 [/תיק|ילקוט/,"A school backpack neatly packed with notebooks and pencils"],
 [/שיניים|צחצוח/,"A toothbrush and toothpaste next to a clean bathroom sink"]
 ];
 const known=hebrewScenes.find(([regex])=>regex.test(p.name+" "+p.description));
 const visual=typeof p.visualPrompt==="string"?p.visualPrompt.trim().slice(0,500):"";
 const style=["realistic","illustration","auto"].includes(p.style)?p.style:"realistic";
 const fallback=visual||scenes[p.taskId]||known?.[1]||"The literal household task: "+p.name+". "+p.description;
 let subject=fallback;
 // Understand arbitrary Hebrew chores using a multilingual text model before image generation.
 if(!visual){
  try{
   const out=await env.AI.run("@cf/meta/llama-3.1-8b-instruct",{messages:[
    {role:"system",content:"You are an expert visual prompt translator. Convert Hebrew household chore name and description into one precise ENGLISH visual scene description of the actual task. Mention specific physical objects, their arrangement and the room. For abstract actions, depict concrete objects associated with that action. Do not invent unrelated cleaning, children, brooms or buckets. No text, icons, symbols, posters or writing in the image. Return ONLY one English sentence, no preface, max 60 words."},
    {role:"user",content:"Hebrew task name: "+p.name+"\nHebrew details: "+p.description+"\nSuggested context: "+fallback}
   ],max_tokens:140,temperature:0.15});
   const answer=String(out?.response||"").trim().replace(/^["']|["']$/g,"");
   if(answer.length>=20&&answer.length<=550&&/[a-zA-Z]/.test(answer))subject=answer;
  }catch(e){/* Safe fallback when the translation model is unavailable. */}
 }
 const photoStyle="Photorealistic documentary photography, authentic real-life Israeli family home interior, realistic furniture and everyday objects, natural daylight, crisp details, realistic material textures, natural colors, eye-level camera, believable proportions, no illustration, no cartoon, no drawing, no 3D render, no clipart";
 const drawingStyle="Clean, accurate children's book illustration, simple friendly colors, clearly recognizable physical objects";
 const chosenStyle=style==="illustration"?drawingStyle:photoStyle;
 const prompt=chosenStyle+". EXACT SUBJECT occupying most of the image: "+subject+". One coherent physical scene. Show only the objects involved in this particular task, do not depict an unrelated activity. No words, no text, no labels, no letters, no checklists, no watermarks, no icons. "+(p.side==="before"?"Show the task before completion.":p.side==="after"?"Show the task completed.":"Clearly show the task or the completed result.");
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
