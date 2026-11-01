import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../functions/api/shop.js',import.meta.url),'utf8');
const {onRequest}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function fixture(){
 const state={pin:'1234',kidPins:{moshi:'5678'},shopSettings:{enabled:true,children:['moshi']},shopProducts:[{id:'toy',name:'צעצוע',kind:'physical',price:6,active:true,unlimited:false,stock:1,children:[]}],shopOrders:[],bankedPoints:{moshi:10},records:{},bankLedger:[]};
 let revision=1;
 const db={prepare(sql){return {first:async()=>({data:JSON.stringify(state),revision}),bind(data,expected){return {run:async()=>{if(expected!==revision)return {meta:{changes:0}};Object.assign(state,JSON.parse(data));revision++;return {meta:{changes:1}}}}}}}};
 return {state,env:{HOME_DB:db}};
}
async function action(env,params){const request=new Request('https://example.com/api/shop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(params)});const res=await onRequest({request,env});return {status:res.status,body:await res.json()}}
test('pending request reserves physical stock; rejected request releases it',async()=>{
 const {env}=fixture();const req={action:'request',child:'moshi',kidPin:'5678',productId:'toy'};
 const first=await action(env,req);assert.equal(first.status,200);
 const second=await action(env,req);assert.equal(second.status,400);
 const reject=await action(env,{action:'reject',pin:'1234',orderId:first.body.orders[0].id});assert.equal(reject.status,200);
 assert.equal((await action(env,req)).status,200);
});
test('pending requests reserve stars, without charging until approval',async()=>{
 const {env,state}=fixture();state.shopProducts[0].unlimited=true;
 const req={action:'request',child:'moshi',kidPin:'5678',productId:'toy'};
 const first=await action(env,req);assert.equal(first.status,200);assert.equal(state.bankLedger.length,0);
 assert.equal((await action(env,req)).status,400);
 const approved=await action(env,{action:'approve',pin:'1234',orderId:first.body.orders[0].id});assert.equal(approved.status,200);
 assert.equal(state.bankLedger.length,1);
 assert.equal((await action(env,{action:'approve',pin:'1234',orderId:first.body.orders[0].id})).status,400);
});
test('new physical reward defaults to tracked stock',async()=>{
 const {env}=fixture();
 const result=await action(env,{action:'product',pin:'1234',name:'פרס',price:5,kind:'physical',stock:3});
 assert.equal(result.status,200);
 assert.equal(result.body.products.at(-1).unlimited,false);
});

test('features default off, can be toggled independently, and preserve existing shop settings',async()=>{
 const {env,state}=fixture();
 const get=async()=>{const res=await onRequest({request:new Request('https://example.com/api/shop'),env});return res.json()};
 assert.deepEqual(Object.values((await get()).settings.features).filter(Boolean),[]);
 const first=await action(env,{action:'features',pin:'1234',features:{vip:true,mysteryBoxes:false}});
 assert.equal(first.status,200);
 assert.equal(state.shopSettings.enabled,true);
 assert.equal(first.body.settings.features.vip,true);
 assert.equal(first.body.settings.features.mysteryBoxes,false);
 const second=await action(env,{action:'features',pin:'1234',features:{siblingGifts:true}});
 assert.equal(second.body.settings.features.vip,true);
 assert.equal(second.body.settings.features.siblingGifts,true);
 assert.equal((await action(env,{action:'features',pin:'bad',features:{vip:false}})).status,403);
 assert.equal((await action(env,{action:'features',pin:'1234',features:{unexpected:true}})).status,400);
});
