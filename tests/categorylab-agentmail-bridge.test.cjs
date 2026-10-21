const test=require('node:test'),assert=require('node:assert/strict');
let bridge={};try{bridge=require('../cloudbase/functions/supplierFeedbackApi/agentmail-bridge');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
const env={CATEGORYLAB_AGENTMAIL_ENABLED:'1',CATEGORYLAB_AGENTMAIL_KEY:'test-smtp-secret-only',CATEGORYLAB_AGENTMAIL_SIGNING_KEY:'s'.repeat(64)};
const record={id:'record-1',product_name:'测试产品',supplier_name:'供应商A',version_label:'V2',finished_spec:'33',test_category:"Peet's档期测试",status:'已确认',round_conclusion:'继续调整',tasting_feedback:'需降低甜度',next_step_direction:'再送V3',updated_at:'2026-10-21T01:00:00Z',edit_token_hash:'DO_NOT_LEAK',image_paths:[{url:'SIGNED_URL'}]};
function memoryDb(){
 const collections=new Map();let tail=Promise.resolve();
 function col(name,tx=false){
  if(!collections.has(name))collections.set(name,new Map());const map=collections.get(name);
  return {doc(id){return {
   async get(){return {data:tx?(map.get(id)||null):(map.has(id)?[map.get(id)]:[])};},
   async set(v){map.set(id,structuredClone(v));},
   async update(v){map.set(id,{...map.get(id),...structuredClone(v)});}
  };}};
 }
 return {collection:n=>col(n),runTransaction(fn){const p=tail.then(()=>fn({collection:n=>col(n,true)}));tail=p.catch(()=>{});return p;}};
}
const accepted=async message=>({messageId:message.messageId,accepted:['louise-assistant@agentmail.to'],rejected:[],response:'250 accepted'});
test('bridge exports the status-event channel',()=>assert.equal(typeof bridge.publish,'function'));
test('projection distinguishes submission confirmation from tasting result and strips secrets',()=>{const e=bridge.makeEvent('updated',[record]);assert.equal(e.records[0].status,'已确认');assert.equal(e.records[0].round_conclusion,'继续调整');assert.ok(!JSON.stringify(e).includes('DO_NOT_LEAK'));assert.ok(!JSON.stringify(e).includes('SIGNED_URL'));assert.equal(e.records[0].record_id,'record-1');});
test('signature detects tampering and rejects a different signing key',()=>{const e=bridge.makeEvent('snapshot',[record]),signed=bridge.sign(e,env.CATEGORYLAB_AGENTMAIL_SIGNING_KEY);assert.deepEqual(bridge.verify(signed,env.CATEGORYLAB_AGENTMAIL_SIGNING_KEY),e);assert.throws(()=>bridge.verify({...signed,payload:signed.payload.replace('V2','V3')},env.CATEGORYLAB_AGENTMAIL_SIGNING_KEY));assert.throws(()=>bridge.verify(signed,'x'.repeat(64)));});
test('fixed internal routing and machine-readable attachment',()=>{const m=bridge.messageFor(bridge.makeEvent('snapshot',[record]),env);assert.equal(m.to,'louise-assistant@agentmail.to');assert.equal(m.from.address,'peetsfood.pmo@agentmail.to');assert.equal(m.envelope.to.length,1);assert.equal(m.attachments.length,1);assert.ok(!m.text.includes('已通过'));assert.equal(m.disableUrlAccess,true);});
test('same event concurrent publication submits once and reads durable receipt',async()=>{const db=memoryDb();let sends=0;const e=bridge.makeEvent('updated',[record]);const results=await Promise.all(Array.from({length:4},()=>bridge.publish(db,e,{env,send:async m=>{sends++;return accepted(m);}})));assert.equal(sends,1);assert.equal((await bridge.receipt(db,e.event_id)).status,'submitted');assert.ok(results.every(x=>x.eventId===e.event_id));});
test('unknown SMTP result is not retried',async()=>{const db=memoryDb(),e=bridge.makeEvent('updated',[record]);let sends=0;const opts={env,send:async()=>{sends++;throw Error('secret response');}};assert.equal((await bridge.publish(db,e,opts)).status,'unknown');assert.equal((await bridge.publish(db,e,opts)).status,'unknown');assert.equal(sends,1);assert.ok(!JSON.stringify(await bridge.receipt(db,e.event_id)).includes('secret response'));});
test('partial or extra recipients do not count as successful submission',async()=>{for(const addresses of [[],['other@example.invalid'],['louise-assistant@agentmail.to','extra@example.invalid']]){const result=await bridge.publish(memoryDb(),bridge.makeEvent('updated',[record]),{env,send:async m=>({...await accepted(m),accepted:addresses})});assert.equal(result.status,'unknown');}});
test('disabled bridge has no send or database side effects',async()=>{const result=await bridge.publish(null,null,{env:{},send:()=>{throw Error('must not send');}});assert.equal(result.status,'disabled');});
test('snapshot order is deterministic, changed version yields a new event, malformed IDs fail',()=>{const b={...record,id:'record-2'};assert.equal(bridge.makeEvent('snapshot',[record,b]).event_id,bridge.makeEvent('snapshot',[b,record]).event_id);assert.notEqual(bridge.makeEvent('updated',[record]).event_id,bridge.makeEvent('updated',[{...record,version_label:'V3'}]).event_id);assert.throws(()=>bridge.makeEvent('updated',[{...record,id:''}]));assert.throws(()=>bridge.makeEvent('snapshot',[record,record]));});
test('business no-op detection ignores notification metadata and updated timestamps',()=>{assert.equal(bridge.changed(record,{...record,notification_status:'sent',updated_at:'2026-10-22T00:00:00Z'}),false);assert.equal(bridge.changed(record,{...record,round_conclusion:'通过'}),true);});
