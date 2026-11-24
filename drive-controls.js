(() => {
  'use strict';
  const drive = window.QuadroDrive;
  const persistence = window.QuadroPersistence;
  const $ = id => document.getElementById(id);
  const indicator = $('driveIndicator');
  const connect = $('driveConnect');
  const disconnect = $('driveDisconnect');
  const status = $('driveStatus');

  function refresh() {
    const connected = drive.connected();
    const synced = connected && persistence.session.status === 'synced';
    const busy = drive.busy() || window.QuadroAttachments.busy();
    const label = synced ? 'Drive conectado e quadro sincronizado'
      : connected ? 'Drive conectado, sincronização do quadro pendente'
      : 'Google Drive desconectado';

    indicator.classList.toggle('is-synced', synced);
    indicator.classList.toggle('is-pending', connected && !synced);
    indicator.title = label;
    indicator.setAttribute('aria-label', label);
    connect.hidden = connected;
    disconnect.hidden = !connected;
    connect.disabled = disconnect.disabled = $('driveBackup').disabled = busy;
    $('driveRestore').disabled = busy || !connected;
  }

  connect.onclick = async () => {
    status.textContent = 'Aguardando autorização do Google…';
    try {
      await drive.connect();
      status.textContent = 'Drive conectado para os anexos.';
    } catch (error) {
      status.textContent = error.message;
    }
  };
  disconnect.onclick = () => {
    drive.disconnect();
    status.textContent = 'Drive desconectado.';
  };
  window.addEventListener('quadro-drive-change', refresh);
  window.addEventListener('quadro-session-change', refresh);
  document.addEventListener('visibilitychange', refresh);
  setInterval(refresh, 15000);
  refresh();
})();
