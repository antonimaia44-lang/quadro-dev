// Owns one account/document at a time. No SDK initialization or network here.
export function createAccountOwner({project,documentId,locks,createSession}){
 if(!project||!documentId||!locks?.request)throw Error('exclusive-lock-required');
 let generation=0,current=null,tail=Promise.resolve(),closed=false;
 const serial=fn=>{const task=tail.then(fn);tail=task.catch(()=>{});return task};
 async function releaseCurrent(){const old=current;current=null;if(!old)return;try{await old.session.stop()}finally{old.transport.stop?.();old.release();await old.lockTask}}
 return {
  activate({uid,transport}){
   if(closed)return Promise.reject(Error('session-ended'));const requested=++generation;
   return serial(async()=>{await releaseCurrent();if(requested!==generation||closed){transport.stop?.();throw Error('session-ended')}
    const key=JSON.stringify(['quadro-dev',2,project,uid,documentId]);
    let release,accept,reject;const held=new Promise(r=>release=r),acquired=new Promise((r,j)=>{accept=r;reject=j});
    const lockTask=locks.request(key,{ifAvailable:true},async lock=>{
     if(!lock){reject(Error('another-tab-active'));return}
     if(requested!==generation||closed){reject(Error('session-ended'));return}
     try{const session=createSession({key,transport});current={session,transport,release,lockTask:null};accept(session);await held}catch(e){reject(e)}
    });
    lockTask.catch(reject);
    let session;try{session=await acquired;if(current)current.lockTask=lockTask;
     try{await session.start()}catch(e){
      // Keep the durable account session on a transient initial network failure.
      // The existing online/visibility handlers retry it; permission/data errors still block.
      if(!['unavailable','deadline-exceeded','auth/network-request-failed'].includes(e.code))throw e;
     }
     if(requested!==generation||closed)throw Error('session-ended');return session}
    catch(e){if(current&&current.session===session)await releaseCurrent();else{release();await lockTask.catch(()=>{});transport.stop?.()}throw e}
   });
  },
  deactivate(){++generation;return serial(releaseCurrent)},
  close(){closed=true;++generation;return serial(releaseCurrent)},
  get session(){return current?.session??null}
 };
}
