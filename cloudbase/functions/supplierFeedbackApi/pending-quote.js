'use strict';
const crypto=require('node:crypto');
const RECORDS='supplier_feedback_records',RECEIPTS='categorylab_pmo_quote_receipts';
const clone=x=>JSON.parse(JSON.stringify(x));
function canonical(x){return Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;}
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
function reject(){throw Error('报价请求被拒绝：授权、精确记录或待处理快照不匹配。');}
function keys(x,allowed){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!allowed.includes(k)))reject();}
function tokenMatches(actual,expected){return typeof actual==='string'&&typeof expected==='string'&&expected.length>=16&&Buffer.byteLength(actual)===Buffer.byteLength(expected)&&crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));}
function assertWorker(event,env){const headers=event.headers||{};if(!env.CATEGORYLAB_PMO_QUOTE_TOKEN||env.CATEGORYLAB_PMO_QUOTE_TOKEN===env.CATEGORYLAB_ADMIN_CODE||!tokenMatches(headers.authorization||headers.Authorization,'Bearer '+env.CATEGORYLAB_PMO_QUOTE_TOKEN))reject();}
function identity(input){keys(input,['id','productName','supplierName','version','spec','testCategory','campaignYear','campaign']);for(const k of ['id','productName','supplierName','version','spec'])if(typeof input[k]!=='string'||!input[k].trim()||input[k].length>256)reject();for(const k of ['testCategory','campaignYear','campaign'])if(!Object.hasOwn(input,k)||!(input[k]===null||typeof input[k]==='string'&&input[k].length<=256))reject();return clone(input);}
function snapshot(record,expected){if(!record||record.status!=='待处理')reject();const actual={id:record._id||record.id,productName:record.product_name,supplierName:record.supplier_name,version:record.version_label,spec:record.finished_spec,testCategory:record.test_category??null,campaignYear:record.campaign_year??null,campaign:record.campaign??null};if(expected&&hash(actual)!==hash(expected))reject();return {identity:actual,quote:record.quote_rmb??null,status:record.status,updatedAt:record.updated_at??null};}
async function read(db,body){
 let i=null,id;
 if(Object.hasOwn(body,'id')){keys(body,['action','id']);if(typeof body.id!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(body.id))reject();id=body.id;}
 else {keys(body,['action','identity']);i=identity(body.identity);id=i.id;}
 const result=await db.collection(RECORDS).doc(id).get(),record=result.data?.[0];
 return {record:snapshot(record,i),beforeHash:hash(record)};
}
async function save(db,body){
 keys(body,['action','identity','beforeHash','oldQuote','newQuote','taskId','source']);const i=identity(body.identity);
 if(!/^[a-f0-9]{64}$/.test(body.beforeHash)||!/^pm-[a-f0-9]{40}$/.test(body.taskId)||!(body.oldQuote===null||typeof body.oldQuote==='number'&&Number.isFinite(body.oldQuote)&&body.oldQuote>=0)||typeof body.newQuote!=='number'||!Number.isFinite(body.newQuote)||body.newQuote<0||body.newQuote>1000000)reject();
 keys(body.source,['mailbox','messageId','threadId']);for(const k of ['mailbox','messageId','threadId'])if(typeof body.source[k]!=='string'||!body.source[k].trim()||body.source[k].length>512)reject();
 const requestHash=hash(body);
 return db.runTransaction(async tx=>{
  const receiptDoc=tx.collection(RECEIPTS).doc(body.taskId),prior=(await receiptDoc.get()).data?.[0];
  if(prior){if(prior.requestHash!==requestHash)reject();return prior.receipt;}
  const doc=tx.collection(RECORDS).doc(i.id),record=(await doc.get()).data?.[0],before=snapshot(record,i);
  if(hash(record)!==body.beforeHash||before.quote!==body.oldQuote)reject();
  const at=new Date().toISOString(),patch={quote_rmb:body.newQuote,updated_at:at};
  // Never write status: transaction detects concurrent confirmation or edits.
  await doc.update(patch);
  const receipt={taskId:body.taskId,status:'saved',at,record:snapshot({...record,...patch},i),source:clone(body.source),beforeHash:body.beforeHash,afterHash:hash({...record,...patch}),oldQuote:body.oldQuote,newQuote:body.newQuote};
  await receiptDoc.set({requestHash,receipt});return receipt;
 });
}
module.exports={assertWorker,read,save,tokenMatches};
