/* Stage 1: transport-independent engine. No Firebase connection or production activation. */
(function(root){'use strict';
const copy=v=>JSON.parse(JSON.stringify(v)), equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function validate(board){
 if(!board||board.version!==1||!Array.isArray(board.projects))throw Error('Quadro incompatível');
 if(!board.projects.length){if(board.active!==null)throw Error('Projeto ativo inválido');return board}
 const projects=new Set();
 for(const p of board.projects){
  if(typeof p.id!=='string'||!p.id||projects.has(p.id)||typeof p.name!=='string'||!Array.isArray(p.cards)||!Array.isArray(p.archived))throw Error('Projeto inválido');
  projects.add(p.id);const ids=new Set();
  for(const c of [...p.cards,...p.archived]){if(!Number.isSafeInteger(c.id)||c.id<1||ids.has(c.id)||typeof c.title!=='string'||typeof c.desc!=='string'||!Number.isInteger(c.stage)||c.stage<0||c.stage>3)throw Error('Cartão inválido');ids.add(c.id)}
  if(!Number.isSafeInteger(p.nextId)||p.nextId<=Math.max(0,...ids))throw Error('Sequência de cartões inválida');
 }
 if(!projects.has(board.active))throw Error('Projeto ativo inválido');return board;
}
function create({storage,key,transport,read,replace,onStatus=()=>{},onDiagnostic=()=>{}}){
 if(!key||!transport)throw Error('Contexto de teste obrigatório');
 let state,stop=null,running=false,online=true,tail=Promise.resolve(),epoch=0,retry=null,delay=1000,listenerFailed=false;
 const transient=e=>['unavailable','deadline-exceeded','aborted','auth/network-request-failed'].includes(e?.code);
 function clearRetry(){if(retry!==null)clearTimeout(retry);retry=null}
 function schedule(){if(retry!==null||!running||!online)return;const session=epoch;retry=setTimeout(()=>{retry=null;if(running&&online&&session===epoch)queue(cycle).catch(()=>{})},delay);delay=Math.min(delay*2,30000)}
 function listen(){
  stop?.();stop=null;listenerFailed=false;const session=epoch;
  stop=transport.subscribe(()=>{if(running&&session===epoch)queue(cycle).catch(()=>{})},e=>{if(running&&session===epoch){listenerFailed=transient(e);diagnostic(e,'listener');report('blocked');if(transient(e))schedule()}});
 }
 const raw=storage.getItem(key);
 state=raw===null?{schema:1,base:null,pending:null,conflict:null}:JSON.parse(raw);
 function snapshot(s){if(!s||!Number.isSafeInteger(s.revision)||s.revision<0)throw Error('Revisão inválida');validate(s.board);return s}
 if(state.schema!==1)throw Error('Diário incompatível');
 if(state.base)snapshot(state.base);if(state.pending)validate(state.pending);if(state.conflict)snapshot(state.conflict);
 const persist=next=>{storage.setItem(key,JSON.stringify(next));state=next};
 const report=s=>onStatus(s,copy(state));
 const diagnostic=(e,operation)=>onDiagnostic({at:new Date().toISOString(),operation,code:String(e?.code||'local-error'),message:String(e?.message||e),online,running,epoch,baseRevision:state.base?.revision??null,pending:!!state.pending,conflictRevision:state.conflict?.revision??null});
 const queue=fn=>{const result=tail.then(fn);tail=result.catch(()=>{});return result};
 async function receive(remote,session){
  snapshot(remote);remote=copy(remote);
  if(state.conflict){
   if(remote.revision<state.conflict.revision)throw Error('Revisão remota regrediu');
   if(remote.revision===state.conflict.revision&&!equal(remote.board,state.conflict.board))throw Error('Revisão inconsistente');
   if(remote.revision>state.conflict.revision){
    storage.setItem(key+':conflict-history:'+Date.now(),JSON.stringify({schema:1,journal:copy(state),local:validate(copy(read()))}));
    persist({...state,conflict:remote});
   }
   report('conflict');return;
  }
  if(!state.base){
   if(!equal(read(),remote.board)){persist({...state,pending:validate(copy(read())),conflict:remote});report('conflict');return}
   persist({...state,base:remote,pending:null});report('synced');return;
  }
  if(remote.revision<state.base.revision)throw Error('Revisão remota regrediu');
  if(remote.revision===state.base.revision&&!equal(remote.board,state.base.board))throw Error('Revisão inconsistente');
  const local=validate(copy(read()));
  if(equal(local,remote.board)){persist({...state,base:remote,pending:null});report('synced');return}
  if(remote.revision!==state.base.revision){
   if(state.pending||!equal(local,state.base.board)){persist({...state,pending:local,conflict:remote});report('conflict');return}
   // Persist recovery information before applying a remote board.
   persist({...state,pending:local,conflict:remote});
   replace(copy(remote.board));
   persist({...state,base:remote,pending:null,conflict:null});report('synced');return;
  }
  // A crash can occur after the board write but before changed() journals it.
  // Recover that local edit before any network write, including after reload.
  if(!state.pending&&!equal(local,state.base.board))persist({...state,pending:local});
  if(state.pending&&online&&running){
   const sent=copy(state.pending);
   const result=await transport.compareAndSet(remote.revision,sent);
   if(!running||session!==epoch)return;
   snapshot(result);
   if(!equal(result.board,sent)||result.revision!==remote.revision+1)throw Error('Confirmação inválida');
   const current=validate(copy(read()));
   persist({...state,base:copy(result),pending:equal(current,sent)?null:current});report(state.pending?'pending':'synced');
  }
 }
 async function cycle(){if(!running||!online)return;const session=epoch;try{if(listenerFailed)listen();const remote=await transport.get();if(!running||!online||session!==epoch)return;await receive(remote,session);if(!running||session!==epoch)return;clearRetry();delay=1000;if(listenerFailed||state.pending&&!state.conflict)schedule()}catch(e){if(!running||session!==epoch)return;diagnostic(e,'cycle');
  // A rejected stale CAS is a conflict only after a fresh server read proves
  // an advanced revision. Permission denial alone never proves concurrency.
  if(online&&state.pending&&['permission-denied','aborted','revision-conflict'].includes(e.code)){
   try{const fresh=await transport.get();if(!running||session!==epoch)return;if(state.base&&fresh.revision>state.base.revision){await receive(fresh,session);return}}catch(probe){diagnostic(probe,'conflict-confirmation')}
  }
  report(online?'blocked':'offline');if(transient(e))schedule();throw e}}
 return {
  start(){if(running)return Promise.resolve();running=true;++epoch;try{listen()}catch(e){listenerFailed=true;if(transient(e))schedule();else{running=false;throw e}}return queue(cycle)},
  stop(){running=false;++epoch;clearRetry();stop?.();stop=null;return tail},
  changed(){if(!running)throw Error('session-ended');const board=validate(copy(read()));try{persist({...state,pending:board})}catch(e){diagnostic(e,'journal');report('blocked');throw e}report(online?'pending':'offline');return queue(cycle)},
  setOnline(value){online=!!value;clearRetry();delay=1000;if(!online){report('offline');return Promise.resolve()}return queue(cycle)},
  flush(){return queue(cycle)},
  exportRecovery(){return copy({schema:1,at:new Date().toISOString(),journal:state,local:validate(copy(read()))})},
  resolve(choice){return queue(async()=>{if(!running||!online||!state.conflict)throw Error('no-active-conflict');const session=epoch;const archive=this.exportRecovery();storage.setItem(key+':recovery:'+Date.now(),JSON.stringify(archive));const remote=snapshot(await transport.get());if(!running||!online||session!==epoch)throw Error('session-ended');if(remote.revision!==state.conflict.revision||!equal(remote.board,state.conflict.board))throw Error('remote-changed-export-again');if(choice==='remote'){replace(copy(remote.board));persist({schema:1,base:copy(remote),pending:null,conflict:null})}else if(choice==='local'){const local=validate(copy(read()));persist({schema:1,base:copy(remote),pending:local,conflict:null})}else throw Error('invalid-choice');report(choice==='local'?'pending':'synced');return archive})},
  inspect(){return copy(state)}
 
 };
}
const api=Object.freeze({create,validate});if(typeof module==='object'&&module.exports)module.exports=api;else root.QuadroAutoSync=api;
})(typeof window==='object'?window:globalThis);
