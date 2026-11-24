(() => {
  'use strict';

  const api = 'https://www.googleapis.com/drive/v3';
  const uploadApi = 'https://www.googleapis.com/upload/drive/v3';
  const appTag = 'quadro-dev-anexos-v3';
  const isId = value => typeof value === 'string' && /^[\w-]{1,200}$/.test(value);
  let credential;
  let authorizer;
  let connecting;

  function changed() {
    window.dispatchEvent(new Event('quadro-drive-change'));
  }

  function disconnect() {
    credential = null;
    changed();
  }

  function connected() {
    return Boolean(credential && credential.key === window.QuadroPersistence.key &&
      Date.now() < credential.expires);
  }

  function connect(owner) {
    if (connecting) return connecting;
    if (!authorizer || !window.QuadroPersistence.remote) {
      return Promise.reject(Error('Entre com Google no painel Sincronização Google para usar os anexos.'));
    }
    const key = window.QuadroPersistence.key;
    const authorize = authorizer;
    connecting = authorize().then(async value => {
      const token = { value, key, expires: Date.now() + 50 * 60 * 1000 };
      const user = await identify(token);
      if (key !== window.QuadroPersistence.key || authorize !== authorizer) {
        throw Error('O quadro mudou durante a autorização. Tente novamente.');
      }
      if (owner && user.permissionId !== owner) {
        throw Error('Use a conta Google que salvou as imagens deste quadro.');
      }
      credential = { ...token, owner: user.permissionId };
      return true;
    }).finally(() => { connecting = null; changed(); });
    changed();
    return connecting;
  }

  async function request(url, options = {}, token = credential) {
    if (!token || Date.now() >= token.expires || token.key !== window.QuadroPersistence.key) throw Error('Conecte o Google Drive para continuar.');
    const response = await fetch(url, {
      ...options,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: { ...options.headers, Authorization: 'Bearer ' + token.value }
    });
    if (response.status === 401) {
      if (credential === token) disconnect();
      throw Error('A autorização expirou. Conecte o Google Drive novamente.');
    }
    if (!response.ok) {
      const reason = {
        403: 'O Drive recusou o acesso. Confira a conta e as permissões.',
        404: 'O arquivo não está disponível nesta conta do Drive.',
        429: 'O Drive recebeu muitas solicitações. Tente novamente em instantes.'
      }[response.status] || 'O Drive não concluiu a solicitação (HTTP ' + response.status + ').';
      throw Object.assign(Error(reason), { status: response.status });
    }
    return response;
  }

  async function identify(token) {
    const { user } = await (await request(api + '/about?fields=user(permissionId)', {}, token)).json();
    if (!isId(user?.permissionId)) throw Error('Não foi possível identificar a conta do Drive.');
    return user;
  }

  async function newId(token) {
    const { ids } = await (await request(api + '/files/generateIds?count=1&space=drive', {}, token)).json();
    if (!isId(ids?.[0])) throw Error('Não foi possível reservar um arquivo no Drive.');
    return ids[0];
  }

  const fileUrl = id => {
    if (!isId(id)) throw Error('Referência de arquivo inválida.');
    return api + '/files/' + encodeURIComponent(id);
  };

  async function upload(item, name) {
    const token = credential;
    if (!connected()) throw Error('Conecte o Google Drive para continuar.');
    if (item.uploadOwner !== token.owner) {
      item.id = undefined;
      item.uploadOwner = token.owner;
    }
    if (!item.id) item.id = await newId(token);
    const boundary = 'quadro_' + crypto.randomUUID();
    const metadata = {
      id: item.id, name, mimeType: item.blob.type,
      appProperties: { quadro: appTag, kind: 'image' }
    };
    const body = new Blob([
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      '\r\n--' + boundary + '\r\nContent-Type: ' + item.blob.type + '\r\n\r\n',
      item.blob, '\r\n--' + boundary + '--\r\n'
    ]);
    try {
      await request(uploadApi + '/files?uploadType=multipart&fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
        body
      }, token);
    } catch (error) {
      if (error.status !== 409) throw error;
      const existing = await (await request(fileUrl(item.id) + '?fields=id,trashed,appProperties,size,mimeType', {}, token)).json();
      if (existing.trashed || existing.appProperties?.quadro !== appTag ||
          existing.appProperties.kind !== 'image' ||
          Number(existing.size) !== item.blob.size || existing.mimeType !== item.blob.type) throw error;
    }
    return item.id;
  }

  window.addEventListener('quadro-session-change', () => {
    if (credential && credential.key !== window.QuadroPersistence.key) disconnect();
  });

  window.QuadroDrive = Object.freeze({
    isId, connected, connect, disconnect, upload,
    owner: () => connected() ? credential.owner : undefined,
    busy: () => Boolean(connecting),
    setAuthorizer(next) { authorizer = next; disconnect(); },
    download: async id => (await request(fileUrl(id) + '?alt=media')).blob()
  });
})();
