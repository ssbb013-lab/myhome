const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json;charset=utf-8","cache-control":"private,no-store"}});
export async function onRequest({request,env}){
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(!env.HOME_DB)return json({error:'מסד הנתונים אינו זמין'},503);
 let body;try{body=await request.json()}catch{return json({error:'בקשה לא תקינה'},400)}
 const row=await env.HOME_DB.prepare('SELECT data FROM app_state WHERE id=1').first();
 if(!row)return json({error:'נתוני המשפחה אינם זמינים'},503);
 const state=JSON.parse(row.data||'{}');
 if(!body?.pin||String(body.pin)!==String(state.pin))return json({error:'נדרש קוד הורים'},403);
 const text=String(body.text||'').trim(),taskId=String(body.taskId||'');
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(taskId)||!text||text.length>100||!/[א-ת]/.test(text))return json({error:'שם משימה לא תקין'},400);
 const known=['bed','toys','clothes','laundry','books','desk','living','dishes','sweep','wipe','vacuum'];
 if(!known.includes(taskId)&&!(state.customTasks||[]).some(t=>t.id===taskId)&&!(state.taskEdits||{})[taskId])return json({error:'המשימה לא נמצאה'},404);
 if(!env.AI)return json({error:'שירות הניקוד האוטומטי עדיין אינו זמין'},503);
 try{
  const result=await env.AI.run('@cf/meta/llama-3.1-8b-instruct',{messages:[
   {role:'system',content:'You add Hebrew niqqud (vowel marks) to text. Return ONLY the fully vocalized Hebrew text, without quotes, markdown, explanations or extra words. Keep the original words, their order, punctuation, and wording exactly. Do not transliterate or translate. If unsure, prefer the most likely modern Hebrew reading.'},
   {role:'user',content:text}
  ],max_tokens:220,temperature:0});
  const value=String(result?.response||'').trim().replace(/^["“]|["”]$/g,'').replace(/^\`+|\`+$/g,'');
  const unpointed=s=>s.normalize('NFD').replace(/[\u0591-\u05C7]/g,'').normalize('NFC');
  if(!value||value.length>200||unpointed(value)!==unpointed(text))return json({error:'לא התקבל ניקוד מהימן. אפשר להזין ניקוד ידנית.'},422);
  return json({text:value});
 }catch{return json({error:'יצירת ניקוד אוטומטי נכשלה, אפשר לנסות שוב'},502)}
}
