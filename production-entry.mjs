import {firebaseConfig,allowedUids} from './production-config.mjs';
export async function prepare(options){
 if(firebaseConfig.projectId!=='quadro-dev-ebb4b'||!allowedUids.length||allowedUids.some(uid=>!uid||uid.includes('PREENCHER')))throw Error('UID de produção ainda não confirmado');
 const [App,A,F,{createAccountOwner},{createGoogleConnection},{createTransport}]=await Promise.all([
 import('./sdk/firebase-app.js'),import('./sdk/firebase-auth.js'),import('./sdk/firebase-firestore.js'),
 import('./account-session.mjs'),import('./google-connection.mjs'),import('./firebase-adapter.mjs')]);
 const app=App.initializeApp(firebaseConfig,'quadro-producao-v2');
 const auth=A.initializeAuth(app,{persistence:A.browserLocalPersistence,popupRedirectResolver:A.browserPopupRedirectResolver});
 const db=F.initializeFirestore(app,{localCache:F.memoryLocalCache()});
 const owner=createAccountOwner({project:firebaseConfig.projectId,documentId:'boards_v2:definitivo-v2',locks:navigator.locks,
 createSession:args=>QuadroSession.create({...args,storage:localStorage,onStatus:options.onSessionStatus,onReplace:options.onReplace})});
 const connection=createGoogleConnection({A,auth,owner,onStatus:options.onStatus,makeTransport:uid=>{
 if(!allowedUids.includes(uid))throw Error('Conta sem autorização');
 return createTransport({F,store:db,auth,uid,validate:QuadroAutoSync.validate,origin:crypto.randomUUID(),allowed:true});
 }});
 const authorizeDrive = async () => {
  const user = auth.currentUser;
  if (!user || !allowedUids.includes(user.uid)) throw Error('Entre com Google para usar os anexos.');
  const provider = new A.GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.file');
  provider.setCustomParameters({ login_hint: user.email || '' });
  let result;
  try {
   result = await A.reauthenticateWithPopup(user, provider);
  } catch (error) {
   if (error.code === 'auth/popup-closed-by-user') throw Error('Autorização do Drive cancelada.');
   if (error.code === 'auth/user-mismatch') throw Error('Escolha a mesma conta Google do quadro.');
   if (error.code === 'auth/popup-blocked') throw Error('Permita a janela de autorização do Drive neste site.');
   throw Error('Não foi possível autorizar o Google Drive. Tente novamente.');
  }
  const accessToken = A.GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!accessToken || auth.currentUser?.uid !== user.uid) throw Error('A autorização do Drive não foi concluída.');
  return accessToken;
 };
 window.QuadroDrive?.setAuthorizer(authorizeDrive);
 return {
  login:()=>connection.login(),
  idle:()=>connection.idle(),
  logout:()=>connection.logout(),
  async dispose(){
   window.QuadroDrive?.setAuthorizer(null);
   await connection.dispose();
   await F.disableNetwork(db);
  }
 };
}
