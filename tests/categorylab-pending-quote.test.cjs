const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../cloudbase/functions/supplierFeedbackApi/index');
const copy=x=>JSON.parse(JSON.stringify(x));
const env={CATEGORYLAB_PMO_QUOTE_TOKEN:'worker-only-synthetic-secret',CATEGORYLAB_ADMIN_CODE:'human-only-synthetic-secret'};
const identity={id:'r1',productName:'Synthetic',supplierName:'Supplier',version:'V3',spec:'33g',testCategory:'Ora档期测试',campaignYear:'2027',campaign:'01月'};
function setup(){
 const state={supplier_feedback_records:{r1:{_id:'r1',product_name:'Synthetic',supplier_name:'Supplier',version_label:'V3',finished_spec:'33g',test_category:'Ora档期测试',campaign_year:'2027',campaign:'01月',status:'待处理',quote_rmb:null,updated_at:'before'}},categorylab_pmo_quote_receipts:{}};
 const collection=(s,name,transaction=false)=>({doc:id=>({get:async()=>({data:transaction?(s[name]?.[id]?copy(s[name][id]):null):(s[name]?.[id]?[copy(s[name][id])]:[])}),update:async patch=>{Object.assign(s[name][id],patch);},set:async data=>{(s[name]??={})[id]=copy(data);}})});
 let beforeCommit=null;
 const db={collection:name=>collection(state,name),runTransaction:async fn=>{for(let n=0;n<2;n++){const before=JSON.stringify(state),draft=copy(state);const result=await fn({collection:name=>collection(draft,name,true)});if(beforeCommit){const f=beforeCommit;beforeCommit=null;f();}if(JSON.stringify(state)!==before)continue;Object.assign(state,draft);return result;}throw Error('conflict');}};
 const call=async(body,token=env.CATEGORYLAB_PMO_QUOTE_TOKEN,customEnv=env)=>{const r=await api.main({httpMethod:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify(body)},{app:{database:()=>db},env:customEnv});return JSON.parse(r.body);};
 return {state,call,race:f=>beforeCommit=f};
}
async function proposal(call){const read=await call({action:'readPendingQuote',identity});assert.equal(read.ok,true);return {action:'savePendingQuote',identity:copy(identity),beforeHash:read.data.beforeHash,oldQuote:null,newQuote:4,taskId:'pm-'+'a'.repeat(40),source:{mailbox:'a@example.invalid',messageId:'<a@example.invalid>',threadId:'t1'}};}
test('worker disabled/missing/wrong auth rejects; human admin credential is separate',async()=>{const {call}=setup();for(const token of ['',env.CATEGORYLAB_ADMIN_CODE,'wrong'])assert.equal((await call({action:'readPendingQuote',identity},token)).ok,false);assert.equal((await call({action:'readPendingQuote',identity},env.CATEGORYLAB_PMO_QUOTE_TOKEN,{})).ok,false);assert.equal((await call({action:'adminLogin',adminCode:'wrong'})).ok,false);assert.equal((await call({action:'adminLogin',adminCode:env.CATEGORYLAB_ADMIN_CODE})).ok,true);});
test('pending quote saves atomically with source receipt; exact replay is stable; mismatched replay fails',async()=>{const {call,state}=setup();const body=await proposal(call);const result=await call(body);assert.equal(result.ok,true);assert.equal(result.data.record.status,'待处理');assert.equal(result.data.record.quote,4);assert.deepEqual(result.data.source,body.source);assert.deepEqual(await call(body),result);assert.equal((await call({...body,newQuote:5})).ok,false);assert.equal(Object.keys(state.categorylab_pmo_quote_receipts).length,1);});
test('reject injection and changed/nonpending records',async()=>{for(const mutate of [b=>b.status='已确认',b=>b.payload={status:'已确认'},b=>b.identity.spec='40g',b=>b.newQuote=-1]){const {call}=setup();const b=await proposal(call);mutate(b);assert.equal((await call(b)).ok,false);}for(const patch of [{status:'已确认'},{finished_spec:'39g'},{updated_at:'new'}]){const {call,state}=setup();const b=await proposal(call);Object.assign(state.supplier_feedback_records.r1,patch);assert.equal((await call(b)).ok,false);assert.equal(state.supplier_feedback_records.r1.quote_rmb,null);}});
test('human confirmation racing transaction wins without worker overwriting it',async()=>{const {call,state,race}=setup();const b=await proposal(call);race(()=>state.supplier_feedback_records.r1.status='已确认');assert.equal((await call(b)).ok,false);assert.equal(state.supplier_feedback_records.r1.status,'已确认');assert.equal(state.supplier_feedback_records.r1.quote_rmb,null);});
test('human UI validates stored code at boot and prompts login without it',()=>{const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../decks/category-lab/supplier-submissions-admin.html'),'utf8');const boot=html.slice(html.indexOf('async function boot('),html.indexOf('function detailValue'));assert.match(boot,/adminLogin/);assert.match(boot,/showLoginForm/);assert.doesNotMatch(boot,/profile = \{ display_name: "Louise", role: "owner" \}/);});

test('worker cannot use admin mutations; history never substitutes for current pending read',async()=>{const {call,state}=setup();for(const action of ['adminUpdate','adminDelete','adminSetProductGroup'])assert.equal((await call({action,id:'r1',payload:{status:'已确认'}})).ok,false);const b=await proposal(call);const saved=await call(b);assert.equal(saved.ok,true);state.supplier_feedback_records.r1.status='已确认';assert.deepEqual(await call(b),saved);assert.equal((await call({action:'readPendingQuote',identity})).ok,false);});
test('worker can inspect exact pending record ID without learning unrelated fields',async()=>{const {call,state}=setup();state.supplier_feedback_records.r1.private_note='private';const r=await call({action:'readPendingQuote',id:'r1'});assert.equal(r.ok,true);assert.equal(r.data.record.identity.spec,'33g');assert.equal(r.data.record.private_note,undefined);assert.equal((await call({action:'readPendingQuote',id:'missing'})).ok,false);});

test('installed CloudBase SDK transaction get returns object/null, ordinary get returns array',async()=>{
 const {Db,DocumentReference}=require('../cloudbase/functions/supplierFeedbackApi/node_modules/@cloudbase/database');
 const original=Db.reqClass;let rows=[{_id:'r1',status:'待处理'}];
 Db.reqClass=class {async send(){return {data:{list:rows.map(JSON.stringify)},requestId:'synthetic'};}};
 try {
  const db=new Db({});
  assert.deepEqual((await new DocumentReference(db,'records',{},'r1').get()).data,rows);
  assert.deepEqual((await new DocumentReference(db,'records',{},'r1','synthetic-tx').get()).data,rows[0]);
  rows=[];
  assert.equal((await new DocumentReference(db,'records',{},'r1','synthetic-tx').get()).data,null);
 } finally {Db.reqClass=original;}
});
