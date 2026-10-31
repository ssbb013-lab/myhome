const reply=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json;charset=utf-8","cache-control":"no-store"}});
const kids=['moshi','miri','racheli','chani','chayale','shrolik','shmili'];
const base={bed:10,toys:10,clothes:12,laundry:8,books:10,desk:12,living:15,dishes:12,sweep:15,wipe:15,vacuum:15};
const clean=x=>String(x||'').trim().slice(0,250);
function total(s,id){
 const values={...base};for(const t of s.customTasks||[])if(t?.id)values[t.id]=Number(t.points)||0;
 for(const [key,v] of Object.entries(s.taskPoints||{}))values[key]=Number(v)||values[key]||0;
 const earned=Object.entries(s.records||{}).reduce((n,[k,v])=>{if(v!=='approved'||!k.includes(':'+id+':'))return n;const parts=k.split(':'),task=parts.find(x=>Object.hasOwn(values,x));return n+(values[task]||0)+(s.calmReports?.[k]?1:0)},0);
 const points=(Number(s.bankedPoints?.[id])||0)+Math.max(0,earned-(Number(s.pointBaseline?.[id])||0));
 return points+(s.bankLedger||[]).filter(t=>t.child===id&&t.status==='posted').reduce((n,t)=>n+(Number(t.checking)||0),0);
}
export async function onRequest({request,env}){
 if(!env.HOME_DB)return reply({error:'Database unavailable'},503);
 const db=env.HOME_DB;
 const row=await db.prepare('SELECT data,revision FROM app_state WHERE id=1').first();
 if(!row)return reply({error:'Not initialized'},503);
 const s=JSON.parse(row.data||'{}');
 s.shopSettings||={enabled:false,children:[]};s.shopProducts||=[];s.shopOrders||=[];s.shopWishlist||={};
 if(request.method==='GET')return reply({settings:s.shopSettings,products:s.shopProducts,orders:s.shopOrders,wishlist:s.shopWishlist,revision:row.revision});
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 let p;try{p=await request.json()}catch{return reply({error:'Invalid JSON'},400)}
 const parent=p.pin&&String(p.pin)===String(s.pin),child=kids.includes(p.child)&&p.kidPin&&String(p.kidPin)===String(s.kidPins?.[p.child]);
 const now=new Date().toISOString(),id=crypto.randomUUID(),prod=s.shopProducts.find(x=>x.id===p.productId),order=s.shopOrders.find(x=>x.id===p.orderId);
 const fail=(error,status=400)=>reply({error},status);
 const actionsParent=['settings','product','deleteProduct','approve','reject','deliver','schedule','cancel'];
 if(actionsParent.includes(p.action)&&!parent)return fail('נדרשת הזדהות הורים',403);
 if(['wish','request','cancelRequest'].includes(p.action)&&!child)return fail('נדרש קוד אישי של הילד',403);
 if(p.action==='settings'){s.shopSettings={enabled:!!p.enabled,children:Array.isArray(p.children)?p.children.filter(x=>kids.includes(x)):[]}}
 else if(p.action==='product'){const price=Math.floor(Number(p.price));if(!clean(p.name)||!Number.isSafeInteger(price)||price<1||price>100000)return fail('פרטי מוצר שגויים');let existing=s.shopProducts.find(x=>x.id===p.productId);const product={id:existing?.id||id,name:clean(p.name).slice(0,80),description:clean(p.description),price,kind:p.kind==='experience'?'experience':'physical',image:clean(p.image).slice(0,500),active:p.active!==false,unlimited:p.unlimited!==false,stock:Math.max(0,Math.floor(Number(p.stock)||0)),children:Array.isArray(p.children)?p.children.filter(x=>kids.includes(x)):[],createdAt:existing?.createdAt||now};if(existing)Object.assign(existing,product);else s.shopProducts.push(product)}
 else if(p.action==='deleteProduct'){if(!prod)return fail('המוצר לא נמצא',404);prod.active=false}
 else if(p.action==='wish'){if(!prod||!prod.active)return fail('המוצר לא זמין');const list=s.shopWishlist[p.child]||[];s.shopWishlist[p.child]=list.includes(prod.id)?list.filter(x=>x!==prod.id):[...list,prod.id]}
 else if(p.action==='request'){if(!s.shopSettings.enabled||!s.shopSettings.children.includes(p.child)||!prod||!prod.active||(prod.children.length&&!prod.children.includes(p.child)))return fail('החנות או המוצר אינם זמינים');if(total(s,p.child)<prod.price)return fail('אין מספיק כוכבים בעו״ש');if(!prod.unlimited&&prod.stock<=0)return fail('המוצר אזל מהמלאי');s.shopOrders.push({id,child:p.child,productId:prod.id,name:prod.name,price:prod.price,kind:prod.kind,status:'pending',createdAt:now,events:[{type:'requested',at:now}]})}
 else if(p.action==='approve'){if(!order||order.status!=='pending')return fail('ההזמנה כבר טופלה');if(total(s,order.child)<order.price)return fail('אין מספיק כוכבים בעו״ש');if(!prod){const real=s.shopProducts.find(x=>x.id===order.productId);if(!real)return fail('המוצר לא נמצא');if(!real.unlimited){if(real.stock<=0)return fail('המלאי אזל');real.stock--}}else if(!prod.unlimited){if(prod.stock<=0)return fail('המלאי אזל');prod.stock--}s.bankLedger||=[];s.bankLedger.push({id:crypto.randomUUID(),child:order.child,type:'shop',amount:order.price,note:'חנות: '+order.name,at:now,status:'posted',checking:-order.price,savings:0,shopOrderId:order.id});order.status=order.kind==='experience'?'scheduling':'approved';order.events.push({type:'approved',at:now})}
 else if(p.action==='reject'){if(!order||order.status!=='pending')return fail('לא ניתן לדחות');order.status='rejected';order.events.push({type:'rejected',at:now})}
 else if(p.action==='cancelRequest'){if(!order||order.child!==p.child||!['approved','scheduling','scheduled'].includes(order.status))return fail('לא ניתן לבקש ביטול');order.cancellationRequested=true;order.events.push({type:'cancel_requested',at:now})}
 else if(p.action==='schedule'){if(!order||!['scheduling','scheduled'].includes(order.status))return fail('לא ניתן לתאם');order.status='scheduled';order.scheduledFor=clean(p.scheduledFor);order.events.push({type:'scheduled',at:now})}
 else if(p.action==='deliver'){if(!order||!['approved','scheduling','scheduled'].includes(order.status))return fail('לא ניתן למסור');order.status='delivered';order.events.push({type:'delivered',at:now})}
 else if(p.action==='cancel'){if(!order||!['approved','scheduling','scheduled'].includes(order.status))return fail('לא ניתן לבטל');if((s.bankLedger||[]).some(x=>x.shopRefundOrderId===order.id))return fail('כבר זוכה');s.bankLedger||=[];s.bankLedger.push({id:crypto.randomUUID(),child:order.child,type:'shopRefund',amount:order.price,note:'זיכוי חנות: '+order.name,at:now,status:'posted',checking:order.price,savings:0,shopRefundOrderId:order.id});const real=s.shopProducts.find(x=>x.id===order.productId);if(real&&!real.unlimited)real.stock++;order.status='cancelled';order.events.push({type:'refunded',at:now})}
 else return fail('פעולה לא נתמכת');
 const result=await db.prepare('UPDATE app_state SET data=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND revision=?').bind(JSON.stringify(s),row.revision).run();
 if(!result.meta.changes)return fail('נתונים השתנו. נסו שוב.',409);
 return reply({ok:true,settings:s.shopSettings,products:s.shopProducts,orders:s.shopOrders,wishlist:s.shopWishlist,revision:row.revision+1});
}