// SDK is injected; importing this module never connects to Firebase.
export function createGoogleConnection({A,auth,owner,makeTransport,onStatus=()=>{}}){
 let generation=0,disposed=false,tail=Promise.resolve(),retry=null,delay=1000;
 const transient=e=>['unavailable','deadline-exceeded','aborted','auth/network-request-failed'].includes(e?.code);
 const clearRetry=()=>{if(retry!==null)clearTimeout(retry);retry=null};
 const transition=user=>{
  clearRetry();
  const request=++generation;
  // Invalidate the previous transport synchronously, before asynchronous cleanup.
  activeTransport?.stop();activeTransport=null;
  const task=tail.then(async()=>{
   await owner.deactivate();if(disposed||request!==generation)return;
   if(!user){onStatus('signed-out');return}
   const result=await user.getIdTokenResult(false);
   if(disposed||request!==generation||auth.currentUser?.uid!==user.uid)return;
   if(result.claims?.firebase?.sign_in_provider!=='google.com'){onStatus('google-required');await A.signOut(auth);return}
   const transport=makeTransport(user.uid);activeTransport=transport;
   try{const session=await owner.activate({uid:user.uid,transport});if(disposed||request!==generation){await owner.deactivate();return}onStatus('ready',session,{email:user.email||null})}
   catch(e){transport.stop();throw e}
  });
  tail=task.then(()=>{delay=1000},e=>{if(request!==generation||disposed)return;
   if(user&&auth.currentUser?.uid===user.uid&&transient(e)){
    onStatus('reconnecting');retry=setTimeout(()=>{retry=null;if(!disposed&&request===generation&&auth.currentUser?.uid===user.uid)transition(auth.currentUser)},delay);delay=Math.min(delay*2,30000);
   }else onStatus(e.message==='another-tab-active'?'another-tab-active':'blocked');
  });return tail;
 };
 let activeTransport=null;
 const unsubscribe=A.onAuthStateChanged(auth,transition,()=>onStatus('blocked'));
 return {
  async login(){if(disposed)throw Error('session-ended');const provider=new A.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});return A.signInWithPopup(auth,provider)},
  async logout(){++generation;clearRetry();activeTransport?.stop();activeTransport=null;await owner.deactivate();await A.signOut(auth);await tail},
  async idle(){await tail},
  async dispose(){disposed=true;++generation;clearRetry();unsubscribe();activeTransport?.stop();activeTransport=null;await owner.close();await tail}
 };
}
