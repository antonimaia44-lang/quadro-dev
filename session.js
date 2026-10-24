(function(root){'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const EMPTY=()=>({version:1,active:null,projects:[]});
function create({storage,key,transport=null,onStatus=()=>{},onReplace=()=>{}}){
 const motor=typeof module==='object'&&module.exports?require('./auto-sync.js'):root.QuadroAutoSync;
 const raw=storage.getItem(key);let record=raw===null?{schema:1,board:EMPTY(),journal:{schema:1,base:{revision:0,board:EMPTY()},pending:null,conflict:null}}:JSON.parse(raw);
 if(record.schema!==1)throw Error('Registro local incompatível; preserve o arquivo');
 motor.validate(record.board);let board=clone(record.board),engine,stopped=false,status='offline';
 const durable={getItem:k=>k==='journal'?JSON.stringify(record.journal):storage.getItem(k),setItem:(k,v)=>{
  if(k!=='journal'){storage.setItem(key+':'+k,v);return}
  const next={schema:1,board:clone(board),journal:JSON.parse(v)};
  storage.setItem(key,JSON.stringify(next));record=next;
 }};
 engine=motor.create({storage:durable,key:'journal',transport:transport||{get:async()=>{throw Error('Prévia local')},subscribe:()=>()=>{}},read:()=>board,
  replace:value=>{board=clone(value);onReplace(clone(board))},onStatus:(s,j)=>{status=s;onStatus(s,j)}});
 // Preview cannot read or write any remote service. Its pending journal survives reload.
 if(!transport)engine.setOnline(false);
 return {
  get key(){return key},
  read:()=>clone(board),inspect:()=>engine.inspect(),get status(){return status},
  async start(){await engine.start()},
  edit(value){if(stopped||engine.inspect().conflict)throw Error('Edição bloqueada; preserve as versões');motor.validate(value);const previous=board;board=clone(value);
   // changed() persists synchronously before it queues any network work.
   try{const task=engine.changed();task.catch(()=>{});return task}catch(e){board=previous;throw e}},
  setOnline:value=>engine.setOnline(!!transport&&value),flush:()=>engine.flush(),
  recovery:()=>engine.exportRecovery(),resolve:choice=>engine.resolve(choice),
  async stop(){stopped=true;await engine.stop()}
 };
}
const api={create,empty:EMPTY};if(typeof module==='object'&&module.exports)module.exports=api;else root.QuadroSession=api;
})(typeof window==='object'?window:globalThis);
