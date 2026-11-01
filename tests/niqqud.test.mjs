import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../functions/api/niqqud.js',import.meta.url),'utf8');
const {onRequest}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
function env(output){
 return {HOME_DB:{prepare(){return {first:async()=>({data:JSON.stringify({pin:'1234',taskEdits:{bed:{name:'לסדר את המיטה'}}})})}}},AI:{run:async()=>({response:output})}};
}
async function send(data,output){const request=new Request('https://site/api/niqqud',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const response=await onRequest({request,env:env(output)});return {status:response.status,data:await response.json()}}
test('returns vocalized text with identical original wording',async()=>{const r=await send({pin:'1234',taskId:'bed',text:'לסדר את המיטה'},'לְסַדֵּר אֶת הַמִּטָּה');assert.equal(r.status,200);assert.equal(r.data.text,'לְסַדֵּר אֶת הַמִּטָּה')});
test('rejects altered task wording',async()=>{const r=await send({pin:'1234',taskId:'bed',text:'לסדר את המיטה'},'לְסַדֵּר אֶת הַחֶדֶר');assert.equal(r.status,422)});
test('requires parent PIN',async()=>{const r=await send({pin:'wrong',taskId:'bed',text:'לסדר את המיטה'},'לְסַדֵּר אֶת הַמִּטָּה');assert.equal(r.status,403)});
