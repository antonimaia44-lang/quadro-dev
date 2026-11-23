(() => {
  'use strict';
  const drive = window.QuadroDrive;
  const board = window.QuadroAttachmentBoard;
  const $ = id => document.getElementById(id);
  let account;
  let unlock;
  let checkpoint;
  let pendingUpload;
  let running;
  let timer;
  let busy = false;

  function status(text) { $('driveStatus').textContent = text; }

  function refreshControls() {
    $('driveConnect').hidden = Boolean(account && drive.connected());
    $('driveConnect').textContent = account ? 'Reconectar Google Drive' : 'Conectar Google Drive';
    $('driveConnect').disabled = busy || Boolean(running);
    $('driveDisconnect').hidden = !account;
    $('driveSync').hidden = !account;
    $('driveBackup').hidden = !account;
    $('driveRestore').hidden = !account;
    for (const id of ['driveSync','driveDisconnect','driveBackup','driveRestore']) {
      $(id).disabled = busy || Boolean(running);
    }
  }

  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    return value;
  }

  async function digest(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  const syncKey = () => 'quadro-dev:drive-sync:hml-v3:' + account.permissionId;
  function remember(value) {
    localStorage.setItem(syncKey(), JSON.stringify(value));
    checkpoint = value;
  }

  async function reserveAccount(id) {
    if (!navigator.locks) throw Error('Abra a homologação em uma versão atual do Chrome.');
    let release;
    let granted;
    const acquired = new Promise(resolve => { granted = resolve; });
    const hold = new Promise(resolve => { release = resolve; });
    navigator.locks.request('quadro-anexos-hml:' + id, { ifAvailable: true }, async lock => {
      granted(Boolean(lock));
      if (lock) await hold;
    }).catch(() => granted(false));
    if (!await acquired) throw Error('Este quadro de teste já está aberto em outra aba.');
    return release;
  }

  async function connect(fromAttachment = false) {
    if (busy || running || (window.QuadroAttachments.busy() && !fromAttachment)) return false;
    const reconnecting = Boolean(account);
    busy = true;
    refreshControls();
    status('Aguardando autorização do Google…');
    try {
      const credential = await drive.authorize();
      const user = await drive.identify(credential);
      if (account && user.permissionId !== account.permissionId) {
        throw Error('Escolha a mesma conta Google conectada ou desconecte a conta atual primeiro.');
      }
      if (!account) {
        if (!board.canApply()) throw Error('Feche o cartão e conecte o Drive na tela inicial.');
        unlock = await reserveAccount(user.permissionId);
        board.openAccount(user.permissionId);
        account = user;
        const saved = localStorage.getItem(syncKey());
        checkpoint = saved ? JSON.parse(saved) : { head: 'root', hash: await digest(board.read()) };
        remember(checkpoint);
      }
      drive.use(credential);
      status('Drive conectado' + (account.emailAddress ? ' · ' + account.emailAddress : '') + '.');
      return true;
    } catch (error) {
      if (!reconnecting && unlock) {
        board.closeAccount();
        account = null;
        checkpoint = null;
        unlock();
        unlock = null;
      }
      status(error.message);
      if (fromAttachment) throw error;
      return false;
    } finally {
      busy = false;
      refreshControls();
      if (drive.connected()) schedule(0);
    }
  }

  function headOf(revisions) {
    const ids = new Set(revisions.map(rev => rev.id));
    if (checkpoint.head !== 'root' && !ids.has(checkpoint.head)) {
      throw Error('A versão que este aparelho usou não apareceu no Drive. Tente sincronizar novamente.');
    }
    for (const rev of revisions) {
      if (rev.parent !== 'root' && !ids.has(rev.parent)) throw Error('O histórico de teste está incompleto no Drive.');
    }
    if (!revisions.length) return 'root';
    const parents = new Set(revisions.map(rev => rev.parent));
    const heads = revisions.filter(rev => !parents.has(rev.id));
    if (heads.length !== 1) {
      throw Error('Foram encontradas versões diferentes no Drive. Exporte o backup antes de resolver o conflito.');
    }
    let cursor = heads[0].id;
    const history = new Map(revisions.map(rev => [rev.id, rev.parent]));
    for (let count = 0; cursor !== 'root' && count <= revisions.length; count++) {
      if (cursor === checkpoint.head) break;
      cursor = history.get(cursor);
    }
    if (cursor !== checkpoint.head) throw Error('O histórico do Drive divergiu deste aparelho.');
    return heads[0].id;
  }

  async function synchronize() {
    if (!drive.connected()) throw Error('Conecte o Google Drive para sincronizar.');
    if (!board.writable()) throw Error('Recarregue a página para sincronizar as alterações desta conta.');
    const revisions = await drive.revisions();
    const head = headOf(revisions);
    const local = board.read();
    const hash = await digest(local);
    if (head !== checkpoint.head) {
      const remote = board.validate(JSON.parse(await (await drive.download(head)).text()));
      const remoteHash = await digest(remote);
      const current = board.read();
      const currentHash = await digest(current);
      if (JSON.stringify(current) !== JSON.stringify(board.read())) {
        schedule();
        return;
      }
      if (remoteHash !== currentHash) {
        if (currentHash !== checkpoint.hash) {
          throw Error('Há alterações neste aparelho e no Drive. Exporte um backup antes de resolver o conflito.');
        }
        if (!board.canApply() || window.QuadroAttachments.busy()) {
          status('Há atualizações no Drive. Feche o cartão ou conclua a operação para recebê-las.');
          return;
        }
        board.replace(remote);
      }
      remember({ head, hash: remoteHash });
      pendingUpload = null;
    } else if (hash !== checkpoint.hash) {
      if (pendingUpload?.hash !== hash || pendingUpload.parent !== head) {
        const item = { blob: new Blob([JSON.stringify(local)], { type: 'application/json' }) };
        pendingUpload = { hash, parent: head, item };
      }
      const id = await drive.upload(pendingUpload.item, {
        name: 'Quadro Dev HML - versão ' + new Date().toISOString() + '.json',
        kind: 'board', parent: head
      });
      remember({ head: id, hash });
      pendingUpload = null;
    }
    status('Quadro sincronizado · ' + (account.emailAddress || 'Google Drive'));
  }

  function syncNow(manual = false) {
    if (running || busy || !account || window.QuadroAttachments.busy()) return running;
    if (!drive.connected()) {
      status('A autorização expirou. Conecte o Drive para sincronizar as alterações.');
      refreshControls();
      return;
    }
    if (manual) status('Sincronizando o quadro de teste…');
    running = synchronize().catch(error => status(error.message)).finally(() => {
      running = null;
      refreshControls();
    });
    refreshControls();
    return running;
  }

  function schedule(delay = 900) {
    clearTimeout(timer);
    if (account) timer = setTimeout(() => syncNow(), delay);
  }

  $('driveConnect').onclick = () => connect();
  $('driveSync').onclick = () => syncNow(true);
  $('driveDisconnect').onclick = () => {
    if (running || busy || window.QuadroAttachments.busy()) return;
    board.closeAccount();
    drive.disconnect();
    account = null;
    checkpoint = null;
    pendingUpload = null;
    unlock?.();
    unlock = null;
    clearTimeout(timer);
    refreshControls();
    status('Drive desconectado. Conecte sua conta para voltar aos cartões de teste sincronizados.');
  };
  window.addEventListener('quadro-local-change', () => schedule());
  window.addEventListener('online', () => schedule(0));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedule(0);
  });
  setInterval(() => { if (!document.hidden) syncNow(); }, 15000);

  window.QuadroDriveSync = { connect, schedule, refreshControls, status, account: () => account };
})();
