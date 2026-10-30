const response=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store"}});
export async function onRequest({request,env}){
 if(!env.HOME_DB)return response({error:"HOME_DB unavailable"},503);
 const db=env.HOME_DB;
 const read=async()=>{let row=await db.prepare("SELECT data, revision FROM app_state WHERE id=1").first();return {state:JSON.parse(row?.data||'{}'),revision:row?.revision||1}};
 if(request.method==="GET")return response(await read());
 if(request.method!=="PUT")return response({error:"Method not allowed"},405);
 let payload;try{payload=await request.json()}catch{return response({error:"Invalid JSON"},400)}
 if(!Number.isInteger(payload?.revision)||typeof payload?.state!=="object"||!payload.state||Array.isArray(payload.state))return response({error:"Invalid payload"},400);
 const data=JSON.stringify(payload.state);
 if(data.length>1500000)return response({error:"Too large"},413);
 const update=await db.prepare("UPDATE app_state SET data=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND revision=?").bind(data,payload.revision).run();
 if(!update.meta.changes)return response({error:"Conflict",...await read()},409);
 return response({ok:true,revision:payload.revision+1});
}