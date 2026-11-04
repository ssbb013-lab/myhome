// Helpers for the upcoming pilot-only API. This module does NOT establish a login or session.
export class Forbidden extends Error { constructor(){super('Forbidden');this.status=403;} }
export async function requireMembership(db, userId, familyId) {
 if(typeof userId!=='string'||!userId||typeof familyId!=='string'||!familyId)throw new Forbidden();
 const row=await db.prepare(
   "SELECT m.family_id, m.role FROM pilot_memberships m JOIN pilot_families f ON f.id=m.family_id WHERE m.user_id=? AND m.family_id=? AND f.status='active'"
 ).bind(userId,familyId).first();
 if(!row)throw new Forbidden();
 return {familyId:row.family_id,role:row.role};
}
export async function getFamilyState(db, context) {
 const row=await db.prepare("SELECT data,revision FROM pilot_family_state WHERE family_id=?").bind(context.familyId).first();
 return {state:JSON.parse(row?.data||'{}'),revision:row?.revision||1};
}
export async function putFamilyState(db, context, expectedRevision, state){
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||!state||typeof state!=='object'||Array.isArray(state))throw new TypeError('Invalid state');
 const payload=JSON.stringify(state);
 if(payload.length>1500000)throw new RangeError('Too large');
 const result=await db.prepare(
  "UPDATE pilot_family_state SET data=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE family_id=? AND revision=?"
 ).bind(payload,context.familyId,expectedRevision).run();
 return result.meta.changes===1;
}
