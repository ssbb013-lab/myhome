(() => {
"use strict";
const $=id=>document.getElementById(id);
const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let account=null, activeFamily=null, selectedFamily=null;
async function api(payload){
 const options=payload?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)}:{method:"GET"};
 const res=await fetch("/api/pilot",options); const raw=await res.text(); let data; try{data=JSON.parse(raw)}catch{throw Error("השרת החזיר תשובה לא תקינה (HTTP "+res.status+"). בדוק את חיבור סביבת הפיילוט.")}
 if(!res.ok)throw Error(data.error||"הפעולה נכשלה");
 return data;
}
function message(s,error=false){
 $("message").innerHTML=s?'<div class="'+(error?"error":"good")+'">'+safe(s)+'</div>':"";
 if(s)window.scrollTo({top:0,behavior:"smooth"});
}
function switchTo(panel){
 for(const id of ["loginPanel","registerPanel","dashboard"])$(id).hidden=id!==panel;
 $("logout").hidden=panel!=="dashboard";
}
async function session(){
 try{account=await api();if(!account.authenticated){switchTo(location.hash==="#register"?"registerPanel":"loginPanel");return}
  switchTo("dashboard");$("welcome").textContent="שלום! 👋";$("accountLine").textContent=account.email;
  $("adminPanel").hidden=!account.superadmin;
  renderFamilies();
  if(account.superadmin)await listAdmin();
  if(activeFamily&&account.families.some(f=>f.id===activeFamily))await openFamily(activeFamily);
  else {$("familyPanel").hidden=true;activeFamily=null}
 }catch(e){message(e.message,true)}
}
function renderFamilies(){
 const items=account?.families||[];
 $("familyList").innerHTML=items.map(f=>'<div class="card"><h3>🏠 '+safe(f.name)+'</h3><p class="muted">הרשאה: '+(f.role==="owner"?"בעל/ת הבית":"הורה")+'</p><span class="tag">'+(f.status==="active"?"פעילה":"מושהית")+'</span><p><button type="button" data-family="'+safe(f.id)+'">כניסה לבית</button></p></div>').join("")||'<p class="muted">עדיין לא שויכת למשפחה. מנהל המערכת יכול להזמין אותך.</p>';
 $("familyList").querySelectorAll("[data-family]").forEach(btn=>btn.onclick=()=>openFamily(btn.dataset.family));
}
async function listAdmin(){
 try{
  const d=await api({action:"listAllFamilies"});
  $("adminFamilies").innerHTML=d.families.map(f=>'<div class="item"><div><strong>🏠 '+safe(f.name)+'</strong><p class="small muted">מזהה: '+safe(f.slug)+' · '+f.children+' ילדים · '+f.parents+' הורים</p></div><span class="tag">'+(f.status==="active"?"פעילה":"מושהית")+'</span></div>').join("")||'<p class="muted">אין משפחות בפיילוט עדיין</p>';
 }catch(e){message(e.message,true)}
}
function showInvite(container,invite,expiresAt){
 const link=location.origin+"/#register";container.hidden=false;
 container.innerHTML='<div class="notice"><strong>קוד הזמנה חד-פעמי (תקף ל-7 ימים)</strong><code class="copy">'+safe(invite)+'</code><p class="muted">שלחו להורה את הקישור ואת הקוד בנפרד:</p><code class="copy">'+safe(link)+'</code><p class="small">העתיקו ושמרו כעת. הקוד לא יוצג שוב אחרי סגירת המסך.</p><button class="alt" type="button" id="copyInviteButton">📋 העתקת פרטי הזמנה</button></div>';
 container.querySelector("#copyInviteButton").onclick=()=>navigator.clipboard.writeText("בית נוצץ - הזמנה לפיילוט\n"+link+"\nקוד: "+invite).then(()=>message("פרטי ההזמנה הועתקו")).catch(()=>message("בחרו והעתיקו את הקוד ידנית",true));
}
async function openFamily(id){
 const f=account.families.find(x=>x.id===id);if(!f)return message("אין הרשאה למשפחה זו",true);
 try{
  const d=await fetch("/api/pilot?family="+encodeURIComponent(id),{cache:"no-store"});
  const data=await d.json();if(!d.ok)throw Error(data.error||"לא ניתן להיכנס לבית");
  activeFamily=id;selectedFamily=data;
  $("familyPanel").hidden=false;$("familyTitle").textContent="🏠 "+f.name;
  $("childCount").textContent=data.children.length;$("taskCount").textContent=data.tasks.length;
  const names=Object.fromEntries(data.children.map(c=>[c.id,c.display_name]));
  $("children").innerHTML=data.children.map(c=>'<div class="item"><strong>'+safe(c.display_name)+'</strong><span>'+c.age+' שנים</span></div>').join("")||'<p class="muted">הוסיפו את הילדים שלכם</p>';
  $("taskChild").innerHTML='<option value="">כל הילדים</option>'+data.children.map(c=>'<option value="'+safe(c.id)+'">'+safe(c.display_name)+'</option>').join("");
  $("tasks").innerHTML=data.tasks.map(t=>'<div class="item"><strong>'+safe(t.title)+'</strong><div>⭐ '+t.points+' <span class="muted small">· '+safe(t.assigned_child?names[t.assigned_child]||"ילד":"כל הילדים")+'</span></div></div>').join("")||'<p class="muted">אין עדיין משימות</p>';
  $("familyInvite").hidden=true;$("familyPanel").scrollIntoView({behavior:"smooth",block:"start"});
 }catch(e){message(e.message,true)}
}
$("switchRegister").onclick=()=>{location.hash="register";switchTo("registerPanel")};
$("switchLogin").onclick=()=>{location.hash="";switchTo("loginPanel")};
$("refresh").onclick=session;
$("logout").onclick=async()=>{try{await api({action:"logout"});account=null;activeFamily=null;switchTo("loginPanel");message("התנתקת בהצלחה")}catch(e){message(e.message,true)}};
$("loginForm").onsubmit=async e=>{e.preventDefault();try{await api({action:"login",email:$("loginEmail").value,password:$("loginPassword").value});$("loginPassword").value="";message("");await session()}catch(err){message(err.message,true)}};
$("registerForm").onsubmit=async e=>{e.preventDefault();try{await api({action:"register",invite:$("regInvite").value,email:$("regEmail").value,password:$("regPassword").value});$("regPassword").value="";location.hash="";message("החשבון נפתח בהצלחה!");await session()}catch(err){message(err.message,true)}};
$("familyForm").onsubmit=async e=>{e.preventDefault();try{const d=await api({action:"createFamily",name:$("familyName").value,slug:$("familySlug").value});showInvite($("lastInvite"),d.invite,d.expiresAt);$("familyForm").reset();await listAdmin()}catch(err){message(err.message,true)}};
$("inviteParent").onclick=async()=>{try{const d=await api({action:"inviteParent",familyId:activeFamily});showInvite($("familyInvite"),d.invite,d.expiresAt)}catch(e){message(e.message,true)}};
$("childForm").onsubmit=async e=>{e.preventDefault();try{await api({action:"addChild",familyId:activeFamily,name:$("childName").value,age:Number($("childAge").value)});$("childForm").reset();await openFamily(activeFamily)}catch(err){message(err.message,true)}};
$("taskForm").onsubmit=async e=>{e.preventDefault();try{await api({action:"addTask",familyId:activeFamily,title:$("taskTitle").value,points:Number($("taskPoints").value),childId:$("taskChild").value||null});$("taskForm").reset();await openFamily(activeFamily)}catch(err){message(err.message,true)}};
void session();
})();