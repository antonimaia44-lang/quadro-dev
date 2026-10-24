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
 return {login:()=>connection.login(),idle:()=>connection.idle(),logout:()=>connection.logout(),async dispose(){await connection.dispose();await F.disableNetwork(db)}};
}
