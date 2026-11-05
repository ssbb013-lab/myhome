// Pilot branch only. Isolates pilot APIs and intentionally refuses all legacy family APIs.
const json=(message,status)=>new Response(JSON.stringify({error:message}),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store'}});
export async function onRequest({request,env,next}){
 const path=new URL(request.url).pathname;
 if(!env.PILOT_DB)return path.startsWith('/api/')?json('Pilot database is not configured',503):new Response('Pilot environment is not configured',{status:503});
 if(path.startsWith('/api/')&&path!=='/api/pilot')return json('Not available in the isolated pilot',404);
 if(path.startsWith('/functions/')||path.startsWith('/pilot/'))return new Response('Not found',{status:404});
 const res=await next();
 const h=new Headers(res.headers);
 h.set('cache-control',path==='/index.html'||path==='/'?'no-store':'private, max-age=60');
 h.set('x-content-type-options','nosniff');
 h.set('x-frame-options','DENY');
 h.set('referrer-policy','same-origin');
 h.set('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
 return new Response(res.body,{status:res.status,statusText:res.statusText,headers:h});
}
