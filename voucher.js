(() => {
  "use strict";
  const ids=[["moshi","מושי"],["miri","מירי"],["racheli","רחלי"],["chani","חני"],["chayale","חיה׳לה"],["shrolik","שרוליק"],["shmili","שמילי"]];
  const esc=s=>String(s??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const childName=id=>ids.find(x=>x[0]===id)?.[1]||id||"-";
  const fmt=stamp=>stamp?new Intl.DateTimeFormat("he-IL",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(stamp.replace(" ","T")+"Z")):"-";
  let parentPin="",childPin="",kid="",balances={},ledger=[],vouchers=[],lastCodes=[];
  let panelReady=false;
  window.voucherBalances=balances;
  const POST=async data=>{
    const res=await fetch("/api/vouchers",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify(data)});
    const body=await res.json().catch(()=>({error:"השירות לא החזיר תשובה תקינה"}));
    if(!res.ok)throw Error(body.error||"שגיאה בפעולה");
    return body;
  };
  const balanceFetch=async()=>{
    try{
      const res=await fetch("/api/vouchers?view=balances",{cache:"no-store"});
      if(!res.ok)return;
      const data=await res.json();
      balances=data.balances||{};
      ledger=data.transactions||[];
      window.voucherBalances=balances;
      window.voucherTransactions=ledger;
      if(typeof render==="function")render();
      if(typeof renderBank==="function")renderBank();
      fillKidVoucherHistory();
    }catch(e){console.warn("Voucher balance could not be loaded",e)}
  };
  const oldUnlock=unlockAdmin;
  unlockAdmin=function(){
    const input=document.getElementById("pin")?.value?.trim()||"";
    oldUnlock();
    if(unlocked&&/^\d{4}$/.test(input))parentPin=input;
  };
  const oldKey=vaultKey;
  vaultKey=function(key){
    const id=gateChild;
    const digits=gateDigits;
    oldKey(key);
    if(/^\d$/.test(key)&&digits.length===3&&kidSession===id&&!parentSession){
      childPin=digits+key;kid=id;
    }
  };
  const oldLock=lockVault;
  lockVault=function(){childPin="";kid="";parentPin="";oldLock()};
  const oldParentEnter=parentEnterChild;
  parentEnterChild=function(id){childPin="";kid=id;oldParentEnter(id)};
  const oldRenderAdmin=renderAdmin;
  renderAdmin=function(){
    oldRenderAdmin();
    if(!unlocked)return;
    let admin=document.getElementById("voucherAdmin");
    if(!admin){
      admin=document.createElement("details");
      admin.id="voucherAdmin";
      admin.className="voucher-admin";
      admin.innerHTML='<summary>🎟️ שוברי קסם - יצירה, הדפסה ומעקב</summary><div class="voucher-admin-content">'+
        '<h3>🎁 יצירת שוברים</h3><div class="voucher-form">'+
        '<label>שם השובר<input id="voucherTitle" maxlength="80" value="שובר מתנה"></label>'+
        '<label>שווי בכוכבים<input id="voucherValue" type="number" min="1" max="10000" value="20"></label>'+
        '<label>כמות שוברים<input id="voucherQty" type="number" min="1" max="100" value="1"></label>'+
        '<label>מי רשאי לממש<select id="voucherAssignee"><option value="">כל הילדים</option>'+ids.map(x=>'<option value="'+x[0]+'">'+x[1]+'</option>').join("")+'</select></label>'+
        '<label>תוקף (רשות)<input id="voucherExpiry" type="date"></label>'+
        '<button class="btn primary" id="voucherCreateBtn" type="button">✨ יצירת שוברים</button></div>'+
        '<p class="voucher-msg" id="voucherAdminMessage" role="status"></p>'+
        '<div class="voucher-controls"><button class="btn" id="voucherRefreshBtn">🔄 רענון שוברים</button><button class="btn green" id="voucherPrintBtn" disabled>🖨️ הדפסת השוברים החדשים</button>'+
        '<input type="search" id="voucherSearch" placeholder="חיפוש קוד / ילד / שם"><select id="voucherFilter">'+
        '<option value="">כל הסטטוסים</option><option value="available">זמין</option><option value="redeemed">מומש</option><option value="cancelled">בוטל</option><option value="reversed">זיכוי בוטל</option></select></div>'+
        '<div class="voucher-table-scroll"><table class="voucher-table"><thead><tr><th>קוד</th><th>שם השובר</th><th>שווי</th><th>סטטוס</th><th>ילד</th><th>תאריך מימוש</th><th>פעולות</th></tr></thead><tbody id="voucherTableBody"></tbody></table></div>'+
        '<p class="voucher-caption">קודים בני שמונה ספרות, אקראיים וחד-פעמיים. כל מימוש מתועד בענן.</p></div>';
      document.getElementById("adminContents").prepend(admin);
      admin.querySelector("#voucherCreateBtn").onclick=createVouchers;
      admin.querySelector("#voucherRefreshBtn").onclick=loadVouchers;
      admin.querySelector("#voucherPrintBtn").onclick=()=>printVouchers(lastCodes);
      admin.querySelector("#voucherSearch").oninput=renderVoucherList;
      admin.querySelector("#voucherFilter").onchange=renderVoucherList;
      admin.addEventListener("toggle",()=>{if(admin.open)void loadVouchers()});
      panelReady=true;
    }
  };
  async function createVouchers(){
    if(!unlocked){alert("נדרשת כניסת הורים");return}
    const title=document.getElementById("voucherTitle").value.trim(),
      points=Number(document.getElementById("voucherValue").value),
      quantity=Number(document.getElementById("voucherQty").value),
      assignedChild=document.getElementById("voucherAssignee").value||null,
      expiresAt=document.getElementById("voucherExpiry").value||null;
    if(!Number.isInteger(points)||points<1||points>10000||!Number.isInteger(quantity)||quantity<1||quantity>100)return alert("יש להזין שווי וכמות תקינים");
    const btn=document.getElementById("voucherCreateBtn");btn.disabled=true;
    setAdminMessage("יוצר שוברים...",false);
    try{
      const result=await POST({action:"create",parentPin:parentPin||document.getElementById("pin")?.value,title,points,quantity,assignedChild,expiresAt});
      lastCodes=result.codes||[];
      document.getElementById("voucherPrintBtn").disabled=!lastCodes.length;
      setAdminMessage("✅ נוצרו "+lastCodes.length+" שוברים חדשים.",false);
      await loadVouchers();
    }catch(e){setAdminMessage(e.message,true)}
    finally{btn.disabled=false}
  }
  function setAdminMessage(msg,error){
    const p=document.getElementById("voucherAdminMessage");if(p){p.textContent=msg;p.style.color=error?"#b42345":"#167249"}
  }
  async function loadVouchers(){
    if(!unlocked)return;
    try{
      const res=await POST({action:"list",parentPin:parentPin||document.getElementById("pin")?.value});
      vouchers=res.vouchers||[];renderVoucherList();
    }catch(e){setAdminMessage(e.message,true)}
  }
  function renderVoucherList(){
    const tbody=document.getElementById("voucherTableBody");if(!tbody)return;
    const q=(document.getElementById("voucherSearch")?.value||"").trim().toLowerCase(),status=document.getElementById("voucherFilter")?.value||"";
    const names={available:"🟢 זמין",redeemed:"✅ מומש",cancelled:"⛔ בוטל",reversed:"↩️ זיכוי בוטל"};
    const list=vouchers.filter(v=>(!status||v.status===status)&&(!q||[v.code,v.title,childName(v.redeemed_by),childName(v.assigned_child)].join(" ").toLowerCase().includes(q)));
    tbody.innerHTML=list.map(v=>'<tr><td><strong>'+esc(v.code)+'</strong></td><td>'+esc(v.title)+'</td><td>⭐ '+v.points+'</td><td>'+names[v.status]+'</td><td>'+esc(v.redeemed_by?childName(v.redeemed_by):v.assigned_child?"מיועד: "+childName(v.assigned_child):"-")+'</td><td>'+fmt(v.redeemed_at)+'</td><td>'+
      (v.status==="available"?'<button class="btn" data-voucher-action="cancel" data-code="'+esc(v.code)+'">ביטול</button>':v.status==="redeemed"?'<button class="btn" data-voucher-action="reverse" data-code="'+esc(v.code)+'">ביטול זיכוי</button>':'-')+
      '</td></tr>').join("")||'<tr><td colspan="7">אין שוברים להצגה</td></tr>';
    tbody.querySelectorAll("button[data-voucher-action]").forEach(btn=>btn.onclick=async()=>{
      const action=btn.dataset.voucherAction,code=btn.dataset.code;
      if(!confirm(action==="cancel"?"לבטל שובר "+code+"?":"לבטל את זיכוי הכוכבים של שובר "+code+"? הפעולה תירשם בהיסטוריה."))return;
      btn.disabled=true;
      try{await POST({action,code,parentPin:parentPin||document.getElementById("pin")?.value});await loadVouchers();await balanceFetch();setAdminMessage("✅ הפעולה בוצעה",false)}
      catch(e){setAdminMessage(e.message,true);btn.disabled=false}
    });
  }
  function printVouchers(codes){
    const set=new Set(codes),items=vouchers.filter(v=>set.has(v.code));
    if(!items.length)return alert("בחרו תחילה שוברים להדפסה");
    const win=window.open("","_blank");
    if(!win)return alert("הדפדפן חסם את חלון ההדפסה");
    const body=items.map(v=>'<div class="coupon"><div class="ico">🎁 ⭐</div><h2>שוברי קסם - בית נוצץ</h2><h3>'+esc(v.title)+'</h3><p class="value">'+v.points+' ⭐</p><p class="code">'+v.code+'</p><small>חד-פעמי · '+(v.assigned_child?childName(v.assigned_child):"לכל הילדים")+'</small></div>').join("");
    win.document.write('<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>הדפסת שוברי קסם</title><style>@page{size:A4;margin:10mm}body{font-family:Arial,sans-serif;margin:0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.coupon{border:2px dashed #a891e4;border-radius:16px;text-align:center;padding:12px;height:58mm;break-inside:avoid}.ico{font-size:22px}h2{font-size:16px;color:#7445ba;margin:6px 0}h3{font-size:14px;margin:4px}.value{font-size:25px;font-weight:bold;margin:5px}.code{font-size:24px;letter-spacing:3px;font-weight:bold;margin:6px}small{font-size:11px;color:#555}@media print{button{display:none}}</style><div class="grid">'+body+'</div></html>');
    win.document.close();win.focus();setTimeout(()=>win.print(),400);
  }
  function ensureKidButton(){
    if(document.getElementById("voucherKidButton"))return;
    const button=document.createElement("button");button.id="voucherKidButton";button.className="btn primary";button.textContent="🎟️ יש לי שובר!";
    button.onclick=showKidVoucher;
    const target=document.getElementById("myAccountActions")||document.querySelector(".tabs");
    if(target)target.appendChild(button);
  }
  function showKidVoucher(){
    if(!kidSession&&!parentSession)return alert("יש להיכנס לכספת של הילד");
    kid=selected;
    let modal=document.getElementById("voucherKidModal");
    if(!modal){modal=document.createElement("div");modal.id="voucherKidModal";document.body.appendChild(modal)}
    const currentPin=childPin&&kid===selected?childPin:"";
    modal.innerHTML='<div class="voucher-kid-card" role="dialog" aria-modal="true"><button class="voucher-close" id="voucherClose" aria-label="סגירה">✕</button><div class="voucher-gift">🎁</div><h2>יש לי שובר!</h2><p>שלום '+esc(childName(selected))+'! הקלידו שמונה ספרות שקיבלתם מאמא או אבא.</p><input id="voucherCodeInput" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="00000000"><div class="voucher-keypad">'+["1","2","3","4","5","6","7","8","9","⌫","0","נקה"].map(n=>'<button type="button" class="voucher-number" data-num="'+n+'">'+n+'</button>').join("")+'</div>'+
    (!currentPin?'<label class="voucher-pin-label">קוד הכספת האישי שלך<input id="voucherChildPin" type="password" inputmode="numeric" maxlength="4" placeholder="4 ספרות"></label>':"")+
    '<button class="btn primary" id="voucherRedeemBtn" disabled>✨ קבלת הכוכבים!</button><p class="voucher-kid-message" id="voucherKidMessage" role="status"></p><div id="voucherKidHistory"></div></div>';
    modal.querySelector("#voucherClose").onclick=()=>modal.remove();
    modal.addEventListener("click",e=>{if(e.target===modal)modal.remove()});
    const input=modal.querySelector("#voucherCodeInput"),submit=modal.querySelector("#voucherRedeemBtn");
    const update=()=>{input.value=input.value.replace(/\D/g,"").slice(0,8);submit.disabled=input.value.length!==8};
    input.oninput=update;
    modal.querySelectorAll("[data-num]").forEach(btn=>btn.onclick=()=>{
      const n=btn.dataset.num;input.value=n==="⌫"?input.value.slice(0,-1):n==="נקה"?"":(input.value+n).slice(0,8);update();
    });
    submit.onclick=async()=>{
      const pin=currentPin||modal.querySelector("#voucherChildPin")?.value||"";
      const parentCode=(parentSession&&unlocked)?(parentPin||document.getElementById("pin")?.value||""):"";
      if(!/^\d{4}$/.test(pin)&&!/^\d{4}$/.test(parentCode))return setKidMessage("יש להזין קוד כספת או קוד הורים בן 4 ספרות",true);
      submit.disabled=true;setKidMessage("בודקים את השובר...",false);
      try{
        const r=await POST({action:"redeem",code:input.value,childId:selected,childPin:pin,parentPin:parentCode});
        if(/^\d{4}$/.test(pin))childPin=pin;kid=selected;
        setKidMessage("🎉 זכית ב-"+r.points+" כוכבים! איזה יופי!",false);
        input.value="";update();await balanceFetch();
      }catch(e){setKidMessage(e.message,true);update()}
    };
    input.focus();fillKidVoucherHistory();
  }
  function setKidMessage(message,error){const el=document.getElementById("voucherKidMessage");if(el){el.textContent=message;el.style.color=error?"#b42345":"#167249"}}
  function fillKidVoucherHistory(){
    const el=document.getElementById("voucherKidHistory");if(!el)return;
    const items=ledger.filter(x=>x.child_id===selected).slice(0,8);
    el.innerHTML=items.length?'<h3>השוברים האחרונים שלי</h3>'+items.map(x=>'<div class="voucher-history-row"><span>'+esc(x.title||"שובר מתנה")+' · '+fmt(x.created_at)+'</span><strong>'+((x.delta>0)?"+":"")+x.delta+' ⭐</strong></div>').join(""):"";
  }
  const style=document.createElement("style");style.textContent=
    '.voucher-admin{margin:14px 0;background:#f8f5ff;border:1px solid #dfd6ff;border-radius:18px;padding:14px}.voucher-admin>summary{font-size:19px;font-weight:bold;cursor:pointer;color:#593a9e}.voucher-form{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin:16px 0}.voucher-form label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:bold}.voucher-form input,.voucher-form select,.voucher-controls input,.voucher-controls select{padding:10px;border:1px solid #d1c8ee;border-radius:10px;min-width:110px;max-width:205px}.voucher-controls{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.voucher-table-scroll{overflow-x:auto}.voucher-table{width:100%;min-width:730px;border-collapse:collapse;text-align:right}.voucher-table th,.voucher-table td{padding:10px;border-bottom:1px solid #e8e1fa;font-size:13px}.voucher-table th{background:#ebe7fa}.voucher-msg{min-height:20px}.voucher-caption{font-size:12px;color:#777}#voucherKidModal{position:fixed;inset:0;z-index:9999;background:#272044ab;overflow-y:auto;display:grid;place-items:center;padding:16px}.voucher-kid-card{background:white;width:min(420px,100%);border-radius:28px;text-align:center;position:relative;padding:20px 24px;box-shadow:0 18px 70px #271c6570}.voucher-close{position:absolute;left:14px;top:12px;background:#eee5fa;border:0;border-radius:10px;padding:7px 12px;cursor:pointer}.voucher-gift{font-size:50px}.voucher-kid-card h2{color:#6644c4;margin:4px}.voucher-kid-card p{color:#6c6881}.voucher-kid-card #voucherCodeInput{width:100%;font-size:28px;text-align:center;letter-spacing:4px;border:2px solid #d2c5fa;border-radius:15px;padding:10px;direction:ltr}.voucher-keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px auto;max-width:280px}.voucher-number{height:48px;font-size:21px;font-weight:bold;border:0;background:#efe8ff;border-radius:12px;color:#5d42a1;cursor:pointer}.voucher-pin-label{display:flex;flex-direction:column;gap:5px;font-size:12px;align-items:center}.voucher-pin-label input{width:150px;text-align:center;border:1px solid #c8bce9;padding:9px;border-radius:10px}.voucher-kid-message{font-weight:bold;min-height:22px}.voucher-history-row{display:flex;justify-content:space-between;gap:10px;padding:8px;border-bottom:1px solid #eee;font-size:12px}';
  document.head.appendChild(style);
  ensureKidButton();
  const observer=new MutationObserver(()=>{if(!document.getElementById("voucherKidButton"))ensureKidButton()});
  observer.observe(document.querySelector("main")||document.body,{childList:true,subtree:true});
  void balanceFetch();
  setInterval(balanceFetch,45000);
})();
