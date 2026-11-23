(() => {
  'use strict';

  const clientId = '113837472975-t4gojq9p9rm7jd3hlb08fss6f75c9vnt.apps.googleusercontent.com';
  const scope = 'https://www.googleapis.com/auth/drive.file';
  const api = 'https://www.googleapis.com/drive/v3';
  const uploadApi = 'https://www.googleapis.com/upload/drive/v3';
  const lab = 'quadro-dev-anexos-hml-v3';
  const isId = value => typeof value === 'string' && /^[\w-]{1,200}$/.test(value);
  let credential;
  let connecting;

  function authorize() {
    if (connecting) return connecting;
    const oauth = window.google?.accounts?.oauth2;
    if (!oauth) return Promise.reject(Error('A autorização do Google ainda não carregou. Recarregue a página.'));
    connecting = new Promise((resolve, reject) => {
      const client = oauth.initTokenClient({
        client_id: clientId,
        scope,
        include_granted_scopes: false,
        callback: result => {
          if (!result.access_token || !oauth.hasGrantedAllScopes(result, scope)) {
            reject(Error('O acesso aos arquivos de teste não foi concedido.'));
            return;
          }
          const token = { value: result.access_token, expires: Date.now() + Number(result.expires_in) * 1000 };
          resolve(token);
        },
        error_callback: () => reject(Error('A janela de autorização foi fechada ou bloqueada.'))
      });
      client.requestAccessToken({ prompt: 'select_account' });
    }).finally(() => { connecting = null; });
    return connecting;
  }

  function connected() {
    return Boolean(credential && Date.now() < credential.expires - 5000);
  }

  async function request(url, options = {}, token = credential) {
    if (!token || Date.now() >= token.expires - 5000) throw Error('Conecte o Google Drive para continuar.');
    const response = await fetch(url, {
      ...options,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: { ...options.headers, Authorization: 'Bearer ' + token.value }
    });
    if (response.status === 401) {
      if (credential === token) credential = null;
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
    const { user } = await (await request(api + '/about?fields=user(permissionId,emailAddress)', {}, token)).json();
    if (!isId(user?.permissionId)) throw Error('Não foi possível identificar a conta do Drive.');
    return user;
  }

  async function newId() {
    const { ids } = await (await request(api + '/files/generateIds?count=1&space=drive')).json();
    if (!isId(ids?.[0])) throw Error('Não foi possível reservar um arquivo no Drive.');
    return ids[0];
  }

  const fileUrl = id => {
    if (!isId(id)) throw Error('Referência de arquivo inválida.');
    return api + '/files/' + encodeURIComponent(id);
  };

  async function upload(item, { name, kind, parent = 'root' }) {
    if (!item.id) item.id = await newId();
    const boundary = 'quadro_' + crypto.randomUUID();
    const metadata = {
      id: item.id, name, mimeType: item.blob.type,
      appProperties: { quadro: lab, kind, parent }
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
      });
    } catch (error) {
      if (error.status !== 409) throw error;
      const existing = await (await request(fileUrl(item.id) + '?fields=id,trashed,appProperties,size,mimeType')).json();
      if (existing.trashed || existing.appProperties?.quadro !== lab ||
          existing.appProperties.kind !== kind || existing.appProperties.parent !== parent ||
          Number(existing.size) !== item.blob.size || existing.mimeType !== item.blob.type) throw error;
    }
    return item.id;
  }

  async function revisions() {
    const files = [];
    let pageToken;
    do {
      const params = new URLSearchParams({
        q: "trashed = false and 'me' in owners and appProperties has { key='quadro' and value='" +
          lab + "' } and appProperties has { key='kind' and value='board' }",
        fields: 'nextPageToken,incompleteSearch,files(id,appProperties)',
        spaces: 'drive',
        pageSize: '100'
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await (await request(api + '/files?' + params)).json();
      if (page.incompleteSearch) throw Error('O Drive não retornou todas as versões. Tente sincronizar novamente.');
      for (const file of page.files ?? []) {
        if (!isId(file.id) || !isId(file.appProperties?.parent)) throw Error('O quadro no Drive tem uma revisão inválida.');
        files.push({ id: file.id, parent: file.appProperties.parent });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  window.QuadroDrive = Object.freeze({
    isId, authorize, identify, connected, upload, revisions, newId,
    use: token => { credential = token; },
    disconnect: () => { credential = null; },
    download: async id => (await request(fileUrl(id) + '?alt=media')).blob()
  });
})();
