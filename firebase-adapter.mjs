// Prepared source only. This module is not loaded by the local preview.
export const REMOTE_ENABLED=true;
export const DOCUMENT_ID='definitivo-v2';
const empty=()=>({version:1,active:null,projects:[]});
const fail=code=>Object.assign(Error(code),{code});
export function createTransport({F,store,auth,uid,validate,origin,allowed}){
 if(!allowed||!uid||auth.currentUser?.uid!==uid)throw fail('remote-disabled');
 const ref=F.doc(store,'boards_v2',uid,'boards',DOCUMENT_ID);
 let ended=false;
 const guard=()=>{if(ended||auth.currentUser?.uid!==uid)throw fail('session-ended')};
 function unpack(s){if(!s.exists())return {revision:0,board:empty()};const d=s.data();
  if(Object.keys(d).sort().join(',')!=='origin,ownerUid,payload,revision,schema'||d.ownerUid!==uid||d.schema!==2||!Number.isSafeInteger(d.revision)||d.revision<1||typeof d.origin!=='string'||!d.origin||d.origin.length>64||typeof d.payload!=='string'||new TextEncoder().encode(d.payload).length>20000)throw fail('envelope-invalid');
  return {revision:d.revision,board:validate(JSON.parse(d.payload))};
 }
 return {
  async get(){guard();const s=await F.getDocFromServer(ref);guard();return unpack(s)},
  subscribe(next,error){guard();return F.onSnapshot(ref,{includeMetadataChanges:true},s=>{if(ended||auth.currentUser?.uid!==uid||s.metadata.fromCache||s.metadata.hasPendingWrites)return;try{unpack(s);next()}catch(e){error(e)}},error)},
  async compareAndSet(expected,board){guard();validate(board);const payload=JSON.stringify(board);if(new TextEncoder().encode(payload).length>20000)throw fail('payload-too-large');
   return F.runTransaction(store,async tx=>{guard();const current=unpack(await tx.get(ref));guard();if(current.revision!==expected)throw fail('revision-conflict');
    const revision=expected+1;if(!Number.isSafeInteger(revision))throw fail('revision-overflow');
    tx.set(ref,{schema:2,ownerUid:uid,revision,payload,origin});return {revision,board:JSON.parse(payload)};
   },{maxAttempts:1});
  },stop(){ended=true}
 };
}
