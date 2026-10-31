/* בית נוצץ - Shop module */
(function(){
'use strict';
let shop={settings:{enabled:false,children:[]},products:[],orders:[],wishlist:{}};
let loaded=false,overlay=false,editing=null,busy=false,shopView='catalog';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kidName=id=>(children.find(x=>x[0]===id)||[])[1]||id;
const img=url=>/^\/api\/(shop-image|task-image)\?key=/.test(url||'')?url:'';
const stars=n=>'⭐ '+Number(n||0).toLocaleString('he-IL');
const allowed=(p,id)=>!p.children?.length||p.children.includes(id);
const visible=()=>!!kidSession&&shop.settings.enabled&&shop.settings.children.includes(kidSession);
const product=id=>shop.products.find(p=>p.id===id);
async function getShop(){try{const r=await fetch('/api/shop',{cache:'no-store'});if(!r.ok)throw Error('לא ניתן לטעון את החנות');shop=await r.json();loaded=true;renderShop();}catch(e){console.warn('Shop:',e.message)}}
async function action(p){
 if(busy)return;busy=true;
 try{
  const pin=unlocked&&parentSession?{pin:state.pin}:{child:kidSession,kidPin:state.kidPins?.[kidSession]};
  const res=await fetch('/api/shop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...p,...pin})}),out=await res.json();
  if(!res.ok)throw Error(out.error||'הפעולה נכשלה');
  shop={...shop,...out};loaded=true;
  // Authoritative app_state includes purchases and bank entries. Refresh before any client-side writes.
  const current=await fetch('/api/state',{cache:'no-store'});
  if(current.ok){const data=await current.json();state=data.state;cloudRevision=data.revision;cloudPending=false;saveLocalOnly();restoreCustomTasks();applyTaskPointOverrides()}
  render();renderShop();renderBank();
  return true;
 }catch(e){alert('⚠️ '+e.message);await getShop();return false}
 finally{busy=false}
}
function shopIcon(p){const src=img(p.image);return src?'<img class="reward-image" loading="lazy" src="'+esc(src)+'" alt="">':'<div class="reward-placeholder">'+(p.kind==='experience'?'🎟️':'🎁')+'</div>'}
function ensureShop(){
 let b=document.getElementById('myShopButton'),actions=document.getElementById('myAccountActions');
 if(!b&&actions){b=document.createElement('button');b.id='myShopButton';b.className='btn primary';b.textContent='🛍️ חנות הכוכבים';b.onclick=()=>{if(!visible())return;overlay=true;shopView='catalog';renderShop()};actions.appendChild(b)}
 if(b)b.hidden=!visible();
 const nav=document.querySelector('#parentDashboard .parent-nav');
 if(nav&&!nav.querySelector('[data-tab="shop"]')){
  const btn=document.createElement('button');btn.type='button';btn.className='parent-nav-btn';btn.dataset.tab='shop';btn.setAttribute('role','tab');btn.textContent='🛍️ ניהול חנות';btn.onclick=()=>{selectParentDashboardTab('shop');void getShop()};nav.appendChild(btn);
 }
 const body=document.querySelector('#parentDashboard .parent-dashboard-body');
 if(body&&!body.querySelector('[data-tab="shop"]')){let pane=document.createElement('section');pane.className='parent-dashboard-pane';pane.dataset.tab='shop';pane.hidden=true;body.appendChild(pane)}
 let modal=document.getElementById('shopOverlay');
 if(!modal){modal=document.createElement('div');modal.id='shopOverlay';modal.className='shop-overlay';modal.hidden=true;document.body.appendChild(modal)}
}
function renderShop(){ensureShop();
 const pane=document.querySelector('#parentDashboard [data-tab="shop"]');
 if(pane&&unlocked&&pane.hidden===false)renderAdminShop(pane);
 let modal=document.getElementById('shopOverlay');if(!modal)return;
 modal.hidden=!overlay||!visible();
 if(!modal.hidden)renderChildShop(modal);
}
function renderChildShop(root){
 const id=kidSession,history=shop.orders.filter(o=>o.child===id).slice().reverse(),wishes=shop.wishlist?.[id]||[],balance=bankAccounts(id).checking;
 root.innerHTML='<div class="shop-panel" role="dialog" aria-modal="true" aria-label="חנות הכוכבים"><div class="shop-head"><div><h2>🛍️ חנות הכוכבים</h2><small>היתרה שלך בעו״ש: '+stars(balance)+'</small></div><button class="btn" onclick="closeShop()">✕ סגירה</button></div><div class="shop-tabs"><button class="btn '+(shopView==='catalog'?'primary':'')+'" onclick="shopTab(&#39;catalog&#39;)">🛍️ החנות</button><button class="btn '+(shopView==='wish'?'primary':'')+'" onclick="shopTab(&#39;wish&#39;)">💖 משאלות ('+wishes.length+')</button><button class="btn '+(shopView==='orders'?'primary':'')+'" onclick="shopTab(&#39;orders&#39;)">📦 ההזמנות שלי ('+history.length+')</button></div><div id="shopContent">'+(shopView==='orders'?history.length?history.map(o=>'<div class="reward-order"><strong>'+esc(o.name)+'</strong><span>'+stars(o.price)+' · '+orderStatus(o)+'</span>'+(['approved','scheduling','scheduled'].includes(o.status)&&!o.cancellationRequested?'<button class="btn" onclick="shopCancelRequest(&#39;'+o.id+'&#39;)">בקשת ביטול</button>':o.cancellationRequested?'<small>בקשת ביטול נשלחה להורים</small>':'')+'</div>').join(''):'<p class="shop-empty">אין עדיין הזמנות.</p>':childProducts(id,shopView==='wish'?wishes:null,balance))+'</div></div>';
}
function childProducts(id,wishes,balance){
 const products=shop.products.filter(p=>p.active&&allowed(p,id)&&(wishes===null||wishes.includes(p.id)));
 return products.length?'<div class="reward-grid">'+products.map(p=>'<article class="reward-card">'+shopIcon(p)+'<h3>'+esc(p.name)+'</h3><p>'+esc(p.description||'')+'</p><div class="reward-meta"><strong>'+stars(p.price)+'</strong><span>'+(p.kind==='experience'?'🎟️ חוויה':'🎁 מוצר')+'</span></div><small>'+(balance<p.price?'חסרים '+stars(p.price-balance):!p.unlimited&&p.stock<=0?'אזל מהמלאי':'זמין לבקשת רכישה')+'</small><div class="reward-actions"><button class="btn" onclick="shopWish(&#39;'+p.id+'&#39;)">'+((shop.wishlist?.[id]||[]).includes(p.id)?'💖 שמור':'🤍 משאלה')+'</button><button class="btn primary" '+(balance<p.price||!p.unlimited&&p.stock<=0?'disabled':'')+' onclick="shopBuy(&#39;'+p.id+'&#39;)">🛒 בקשת רכישה</button></div></article>').join('')+'</div>':'<p class="shop-empty">'+(wishes?'עדיין לא הוספת מוצרים לרשימת המשאלות.':'אין כרגע מוצרים בחנות.')+'</p>';
}
function orderStatus(o){return ({pending:'⏳ ממתין לאישור',rejected:'❌ נדחה',approved:'✅ אושר - ממתין למסירה',scheduling:'📅 ממתין לתיאום',scheduled:'📆 תואם',delivered:'🎉 נמסר / מומש',cancelled:'↩️ בוטל וזוכה'})[o.status]||o.status}
window.closeShop=()=>{overlay=false;renderShop()};
window.shopTab=v=>{shopView=v;renderShop()};
window.shopBuy=async id=>{const p=product(id);if(!p||!confirm('לבקש מההורים לרכוש '+p.name+' במחיר '+stars(p.price)+'? הכוכבים ירדו רק לאחר אישור.'))return;await action({action:'request',productId:id});shopView='orders';renderShop()};
window.shopWish=async id=>{await action({action:'wish',productId:id})};
window.shopCancelRequest=async id=>{if(confirm('לשלוח להורים בקשת ביטול?'))await action({action:'cancelRequest',orderId:id})};
function renderAdminShop(root){
 const pending=shop.orders.filter(o=>o.status==='pending'),cancel=shop.orders.filter(o=>o.cancellationRequested&&['approved','scheduling','scheduled'].includes(o.status));
 const configured=shop.settings.children||[];
 root.innerHTML='<div class="shop-admin"><h2>🛍️ ניהול חנות הכוכבים</h2><p class="help">החנות כבויה לילדים כברירת מחדל. כל רכישה דורשת אישור הורים לפני חיוב.</p><section class="reward-section"><h3>⚙️ חשיפת החנות לילדים</h3><label class="shop-check"><input id="shopEnabled" type="checkbox" '+(shop.settings.enabled?'checked':'')+'> להפעיל חנות לילדים</label><p class="help">לבחור ילדים מורשים. ללא בחירת ילדים החנות לא תופיע אצל אף ילד.</p><div class="shop-kids">'+children.map(c=>'<label class="shop-check"><input type="checkbox" class="shopKid" value="'+c[0]+'" '+(configured.includes(c[0])?'checked':'')+'> '+c[1]+'</label>').join('')+'</div><button class="btn primary" onclick="shopSaveSettings()">💾 שמירת הגדרות החנות</button></section><section class="reward-section"><h3>🎁 קטלוג הפרסים ('+shop.products.length+')</h3><button class="btn primary" onclick="shopEditProduct()">➕ הוספת פרס</button><div id="shopEditor"></div><div class="reward-admin-products">'+shop.products.map(p=>'<div class="reward-order">'+shopIcon(p)+'<div><strong>'+esc(p.name)+'</strong><small>'+stars(p.price)+' · '+(p.unlimited?'מלאי ללא הגבלה':'מלאי: '+p.stock)+' · '+(p.active?'פעיל':'מוסתר')+'</small></div><button class="btn" onclick="shopEditProduct(&#39;'+p.id+'&#39;)">✏️ עריכה</button></div>').join('')+'</div></section><section class="reward-section"><h3>⏳ בקשות לאישור ('+pending.length+')</h3>'+(pending.length?pending.map(o=>orderLine(o,true)).join(''):'<p>אין בקשות ממתינות.</p>')+'</section>'+(cancel.length?'<section class="reward-section"><h3>↩️ בקשות ביטול ('+cancel.length+')</h3>'+cancel.map(o=>orderLine(o,false)).join('')+'</section>':'')+'<section class="reward-section"><h3>📦 הזמנות ומימושים</h3>'+shop.orders.slice().reverse().filter(o=>o.status!=='pending').map(o=>orderLine(o,false)).join('')+'</section></div>';
 if(editing!==null)editProductForm(editing);
}
function orderLine(o,pending){
 let actions='';
 if(pending)actions='<button class="btn green" onclick="shopOrderAction(&#39;approve&#39;,&#39;'+o.id+'&#39;)">✅ אישור וחיוב</button><button class="btn" onclick="shopOrderAction(&#39;reject&#39;,&#39;'+o.id+'&#39;)">❌ דחייה</button>';
 else if(o.cancellationRequested)actions='<button class="btn" onclick="shopOrderAction(&#39;cancel&#39;,&#39;'+o.id+'&#39;)">↩️ ביטול וזיכוי</button>';
 if(['approved','scheduled','scheduling'].includes(o.status)){
  if(o.kind==='experience'&&o.status==='scheduling')actions+='<button class="btn" onclick="shopOrderAction(&#39;schedule&#39;,&#39;'+o.id+'&#39;)">📅 תיאום</button>';
  actions+='<button class="btn green" onclick="shopOrderAction(&#39;deliver&#39;,&#39;'+o.id+'&#39;)">✅ נמסר / מומש</button>';
  if(!o.cancellationRequested)actions+='<button class="btn" onclick="shopOrderAction(&#39;cancel&#39;,&#39;'+o.id+'&#39;)">ביטול וזיכוי</button>';
 }
 return '<div class="reward-order"><div><strong>'+esc(kidName(o.child))+' - '+esc(o.name)+'</strong><small>'+stars(o.price)+' · '+orderStatus(o)+'</small></div><div class="reward-actions">'+actions+'</div></div>';
}
window.shopSaveSettings=()=>action({action:'settings',enabled:document.getElementById('shopEnabled')?.checked,children:[...document.querySelectorAll('.shopKid:checked')].map(x=>x.value)});
window.shopOrderAction=async (type,id)=>{
 if(!confirm(({approve:'לאשר ולחייב את הכוכבים?',reject:'לדחות את הבקשה?',cancel:'לבטל את ההזמנה ולהחזיר את הכוכבים?',deliver:'לסמן שהפרס נמסר / מומש?',schedule:'לשמור תיאום לחוויה?'})[type]))return;
 const p={action:type,orderId:id};
 if(type==='schedule'){p.scheduledFor=prompt('מתי תתקיים החוויה? (תאריך ושעה או הערה)')||'';if(!p.scheduledFor)return}
 await action(p);
};
window.shopEditProduct=id=>{editing=id||'';renderShop()};
function editProductForm(id){
 const p=product(id)||{name:'',description:'',price:50,kind:'physical',image:'',active:true,unlimited:true,stock:1,children:[]};
 const el=document.getElementById('shopEditor');if(!el)return;
 el.innerHTML='<div class="reward-editor"><h3>'+(!id?'➕ פרס חדש':'✏️ עריכת פרס')+'</h3><label>שם הפרס<input id="shopName" maxlength="80" value="'+esc(p.name)+'"></label><label>תיאור<input id="shopDescription" maxlength="250" value="'+esc(p.description)+'"></label><div class="reward-fields"><label>מחיר בכוכבים<input id="shopPrice" type="number" min="1" max="100000" value="'+p.price+'"></label><label>סוג<select id="shopKind"><option value="physical" '+(p.kind==='physical'?'selected':'')+'>מוצר פיזי</option><option value="experience" '+(p.kind==='experience'?'selected':'')+'>חוויה</option></select></label><label>כמות מלאי<input id="shopStock" type="number" min="0" value="'+p.stock+'"></label></div><label class="shop-check"><input id="shopUnlimited" type="checkbox" '+(p.unlimited?'checked':'')+'> מלאי ללא הגבלה</label><label class="shop-check"><input id="shopActive" type="checkbox" '+(p.active?'checked':'')+'> פרס פעיל</label><p>זמין ל: (ללא בחירה - לכל הילדים שהחנות פתוחה להם)</p><div class="shop-kids">'+children.map(c=>'<label class="shop-check"><input type="checkbox" class="shopProductKid" value="'+c[0]+'" '+(p.children?.includes(c[0])?'checked':'')+'> '+c[1]+'</label>').join('')+'</div><label>תמונת הפרס<input id="shopImageUrl" readonly placeholder="ללא תמונה" value="'+esc(p.image)+'"></label><div class="reward-actions"><label class="btn">📤 העלאת תמונה<input type="file" accept="image/*" style="display:none" onchange="shopUploadImage(event)"></label><button class="btn" onclick="shopAiImage()">✨ AI</button><button class="btn" onclick="shopLibrary()">🗂️ תמונות מהמאגר</button></div><div id="shopImagePreview">'+(img(p.image)?'<img class="reward-image" src="'+esc(p.image)+'" alt="">':'')+'</div><div id="shopImageLibrary"></div><div class="reward-actions"><button class="btn primary" onclick="shopSaveProduct()">💾 שמירת פרס</button><button class="btn" onclick="shopEditProductClose()">ביטול</button></div></div>';
}
window.shopEditProductClose=()=>{editing=null;renderShop()};
function formProduct(){return {action:'product',productId:editing||undefined,name:document.getElementById('shopName').value,description:document.getElementById('shopDescription').value,price:Number(document.getElementById('shopPrice').value),kind:document.getElementById('shopKind').value,image:document.getElementById('shopImageUrl').value,unlimited:document.getElementById('shopUnlimited').checked,stock:Number(document.getElementById('shopStock').value),active:document.getElementById('shopActive').checked,children:[...document.querySelectorAll('.shopProductKid:checked')].map(x=>x.value)}}
window.shopSaveProduct=async()=>{if(await action(formProduct()))editing=null;renderShop()};
function setProductImg(url){const field=document.getElementById('shopImageUrl');if(field)field.value=url;const preview=document.getElementById('shopImagePreview');if(preview)preview.innerHTML='<img class="reward-image" src="'+esc(url)+'" alt="תצוגה מקדימה">'}
window.shopUploadImage=async event=>{
 const file=event.target.files?.[0];if(!file)return;
 try{
  if(!file.type.startsWith('image/')||file.size>12000000)throw Error('תמונה גדולה מדי');
  const bitmap=await createImageBitmap(file),scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const blob=await new Promise(done=>canvas.toBlob(done,'image/jpeg',.82)),form=new FormData();form.append('image',blob,'reward.jpg');form.append('parentPin',state.pin);
  const r=await fetch('/api/shop-image',{method:'POST',body:form}),out=await r.json();if(!r.ok)throw Error(out.error);
  setProductImg(out.url);
 }catch(e){alert('⚠️ '+e.message)}
};
window.shopAiImage=async()=>{
 const name=document.getElementById('shopName')?.value,description=document.getElementById('shopDescription')?.value;
 if(!name)return alert('יש להזין שם פרס לפני יצירת תמונה');
 if(!confirm('ליצור תמונת AI חדשה לפרס '+name+'?'))return;
 try{const r=await fetch('/api/shop-image',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,description,parentPin:state.pin})}),out=await r.json();if(!r.ok)throw Error(out.error);setProductImg(out.url)}catch(e){alert('⚠️ '+e.message)}
};
window.shopLibrary=async()=>{
 const box=document.getElementById('shopImageLibrary');box.textContent='טוען תמונות מהמאגר...';
 try{
  const r=await fetch('/api/task-images-library'),out=await r.json();if(!r.ok)throw Error(out.error);
  box.innerHTML='<div class="reward-grid">'+(out.items||[]).map(x=>'<button type="button" class="reward-library-item" data-url="'+esc(x.url)+'" onclick="shopChooseLibrary(this)"><img src="'+esc(x.url)+'" loading="lazy" alt=""><small>'+esc(x.taskId)+'</small></button>').join('')+'</div>';
 }catch(e){box.textContent='⚠️ '+e.message}
};
window.shopChooseLibrary=b=>{setProductImg(b.dataset.url);document.getElementById('shopImageLibrary').innerHTML=''};
const oldRender=render;
render=function(){oldRender();ensureShop();renderShop()};
const oldBuild=buildParentDashboard;
buildParentDashboard=function(){oldBuild();ensureShop();renderShop()};
const oldRenderAdmin=renderAdmin;
renderAdmin=function(){oldRenderAdmin();ensureShop();renderShop()};
const oldLock=lockVault;
lockVault=function(){overlay=false;oldLock();renderShop()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&overlay){overlay=false;renderShop()}});
void getShop();
})();
