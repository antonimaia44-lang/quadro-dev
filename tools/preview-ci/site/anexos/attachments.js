(() => {
  'use strict';
  const drive = window.QuadroDrive;
  const board = window.QuadroAttachmentBoard;
  const $ = id => document.getElementById(id);
  const types = new Set(['image/jpeg','image/png','image/webp']);
  const maxImage = 5 * 1024 * 1024;
  const maxBackup = 64 * 1024 * 1024;
  const maxCount = 3;
  const draft = [];
  let editQueue = [];
  let editTarget;
  let editing = false;
  let working = false;
  let connectingPanel = false;
  let viewer;
  let imageUrl;
  let restoring;
  let pendingRemoval;
  const previewUrls = { capture: [], detail: [], view: [] };
  const previewGeneration = { capture: 0, detail: 0, view: 0 };
  function clearPreviews(which) {
    previewGeneration[which]++;
    for (const url of previewUrls[which]) URL.revokeObjectURL(url);
    previewUrls[which] = [];
  }
  const feedbackTimers = {};
  function setFeedback(which, state) {
    const control = $(which === 'capture' ? 'captureAddImages' : 'detailAddImages');
    clearTimeout(feedbackTimers[which]);
    control.classList.remove('is-uploading','is-success','is-error');
    if (!state) return;
    control.classList.add('is-' + state);
    if (state !== 'uploading') feedbackTimers[which] = setTimeout(() => {
      control.classList.remove('is-success','is-error');
    }, 2500);
  }

  function confirmRemoval(item, action) {
    if (working || $('attachmentRemoveConfirm').open) return;
    pendingRemoval = { action, target: editTarget };
    $('attachmentRemoveName').textContent = item.name;
    $('attachmentRemoveConfirm').showModal();
  }

  $('cancelAttachmentRemove').onclick = () => $('attachmentRemoveConfirm').close();
  $('confirmAttachmentRemove').onclick = () => {
    const pending = pendingRemoval;
    $('attachmentRemoveConfirm').close();
    if (pending && editing && pending.target === editTarget && !working) pending.action();
  };
  $('attachmentRemoveConfirm').addEventListener('close', () => { pendingRemoval = null; });

  function report(id, message = '') {
    $(id).textContent = message;
    $(id).hidden = !message;
  }

  function button(label, action) {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = label;
    control.onclick = action;
    return control;
  }

  function listItem(container, ...children) {
    const li = document.createElement('li');
    li.append(...children);
    container.append(li);
  }

  function shortName(name) {
    return name.replace(/\.(?:png|jpe?g|webp)$/i, '') || name;
  }

  function resizeAttachments(wrapper, list) {
    const field = wrapper.querySelector('textarea');
    field.style.paddingBottom = '';
    wrapper.style.removeProperty('--attachment-extra');
  }

  function makeChip(item, removeAction, which) {
    const li = document.createElement('li');
    li.className = 'attachment-preview';
    const img = document.createElement('img');
    img.alt = item.name;
    const generation = previewGeneration[which];
    const attach = blob => {
      if (generation !== previewGeneration[which]) return;
      const url = URL.createObjectURL(blob);
      previewUrls[which].push(url);
      img.src = url;
    };
    if (!$((which === 'capture' ? 'capture' : 'detail') + 'AttachmentPanel').hidden) {
      if (item.blob) attach(item.blob);
      else imageBlob(item).then(attach).catch(() => { li.classList.add('preview-unavailable'); });
    }
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-label', 'Visualizar ' + item.name);
    const open = () => {
      const items = which === 'capture' ? [...draft] : [...(editTarget?.attachments ?? []), ...editQueue];
      const index = items.indexOf(item);
      if (index >= 0) showImage(item, items, index);
    };
    img.onclick = open;
    img.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } };
    const label = document.createElement('span');
    label.textContent = shortName(item.name);
    label.title = item.name;
    const remove = button('×', removeAction);
    remove.setAttribute('aria-label', 'Remover ' + item.name);
    li.append(img, label, remove);
    return li;
  }

  function renderDraft() {
    const list = $('captureImageList');
    clearPreviews('capture');
    list.replaceChildren();
    draft.forEach((item, index) => {
      list.append(makeChip(item, () => {
        if (working) return;
        draft.splice(index, 1);
        renderDraft();
        report('captureImageStatus');
      }, 'capture'));
    });
    list.hidden = !draft.length;
    $('captureAttachmentPanel').dataset.slots = Math.min(maxCount, draft.length + 1);
    resizeAttachments($('captureInputWrap'), list);
    $('captureAddImages').disabled = working;
    $('captureChooseImage').disabled = working || draft.length >= maxCount;
    $('captureChooseImage').hidden = draft.length >= maxCount;
    $('captureAttachmentCount').textContent = String(draft.length);
    $('captureAttachmentCount').hidden = !draft.length;
  }

  function fileItems(files, available) {
    if (files.length > available) throw Error('O cartão pode ter até três imagens.');
    return files.map(file => {
      if (!types.has(file.type) || !file.size || file.size > maxImage) {
        throw Error('Escolha imagens PNG, JPEG ou WebP de até 5 MB cada.');
      }
      return { name: file.name.slice(0, 180), blob: file };
    });
  }

  async function uploadItems(items) {
    const refs = [];
    for (const item of items) {
      if (!item.checked) {
        const bitmap = await createImageBitmap(item.blob).catch(() => null);
        if (!bitmap) throw Error('A imagem ' + item.name + ' não pôde ser lida.');
        bitmap.close();
        item.checked = true;
      }
      const id = await drive.upload(item, { name: 'Quadro Dev HML - ' + item.name, kind: 'image' });
      refs.push({ id, name: item.name, type: item.blob.type, size: item.blob.size });
    }
    return refs;
  }

  async function operate(statusId, message, operation) {
    if (working) return;
    working = true;
    $('driveBackup').disabled = $('driveRestore').disabled = true;
    $('captureAddImages').disabled = $('detailAddImages').disabled = true;
    $('captureChooseImage').disabled = $('detailChooseImage').disabled = true;
    report(statusId, message);
    try {
      return await operation();
    } catch (error) {
      report(statusId, (error instanceof TypeError ? 'Verifique a conexão e tente novamente.' : error.message));
    } finally {
      working = false;
      renderDraft();
      window.QuadroDriveSync.refreshControls();
      window.QuadroDriveSync.schedule();
    }
  }

  function localAttachmentOwner() {
    if (window.QuadroDriveSync.account()) return undefined;
    return [...refsIn(board.read()).values()].find(ref => ref.owner)?.owner;
  }

  function attachmentsConnected(owner) {
    return drive.connected() && (!owner || window.QuadroDriveSync.attachmentAccountId() === owner);
  }

  async function connectIfNeeded(owner = localAttachmentOwner()) {
    if (!attachmentsConnected(owner) && !await window.QuadroDriveSync.connectAttachments(owner)) {
      throw Error('A autorização do Google não foi concluída. Tente novamente.');
    }
  }

  function openFilePicker(input) {
    // The chooser must be opened from the click, before any network request.
    if (!working) $(input).click();
  }

  async function toggleAttachmentPanel(which) {
    if (working || connectingPanel) return;
    const panel = $(which + 'AttachmentPanel');
    const control = $(which === 'capture' ? 'captureAddImages' : 'detailAddImages');
    const card = which === 'detail' ? editTarget : null;
    const statusId = which === 'capture' ? 'captureImageStatus' : 'detailImageStatus';
    if (!panel.hidden) {
      panel.hidden = true;
      control.setAttribute('aria-expanded','false');
      clearPreviews(which);
      return;
    }
    if (which === 'detail' && !board.canEditDetail(card)) {
      report(statusId, 'O cartão mudou. Feche e abra a nota novamente.');
      return;
    }
    const sync = window.QuadroDriveSync;
    const owner = which === 'detail' ? localAttachmentOwner() : undefined;
    const ready = which === 'detail' ? attachmentsConnected(owner) : Boolean(sync.account() && drive.connected());
    if (!ready) {
      const draftText = which === 'capture' ? $('idea').value : '';
      connectingPanel = true;
      try {
        if (which === 'detail') await connectIfNeeded(owner);
        else if (!await sync.connect()) {
          report(statusId, 'Autorização não concluída. Tente novamente.');
          return;
        }
        if (which === 'capture' && draftText && !$('idea').value) {
          $('idea').value = draftText;
          $('idea').dispatchEvent(new Event('input', { bubbles:true }));
        } else if (which === 'capture' && draftText && $('idea').value !== draftText) {
          report('captureImageStatus', 'A conta já tinha outro rascunho. O texto anterior foi preservado no quadro local.');
        }
      } catch (error) {
        if (which === 'capture' || (editing && editTarget === card && $('cardDetail').open)) {
          report(statusId, error.message);
        }
        return;
      } finally {
        connectingPanel = false;
      }
    }
    if (which === 'detail' && (!editing || editTarget !== card || !board.canEditDetail(card))) return;
    panel.hidden = false;
    report(statusId);
    control.setAttribute('aria-expanded','true');
    if (which === 'capture') renderDraft();
    else renderDetail(board.detailCard(), true);
  }
  $('captureAddImages').onclick = () => void toggleAttachmentPanel('capture');
  $('captureChooseImage').onclick = () => openFilePicker('captureImages');
  $('captureImages').onchange = event => {
    const files = Array.from(event.target.files);
    event.target.value = '';
    if (!files.length || working) return;
    try {
      draft.push(...fileItems(files, maxCount - draft.length));
      renderDraft();
      report('captureImageStatus');
    } catch (error) { report('captureImageStatus', error.message); }
  };

  function renderDetail(card, edit) {
    if (card !== editTarget) {
      editQueue = [];
      editTarget = card;
      report('detailImageStatus');
    }
    editing = edit;
    const refs = card?.attachments ?? [];
    const host = $('detailImageList');
    clearPreviews('view');
    host.replaceChildren();
    $('detailAttachments').hidden = !card || !refs.length || edit;
    $('detailAddImages').hidden = !edit;
    $('detailAddImages').disabled = working;
    $('detailChooseImage').disabled = working || refs.length + editQueue.length >= maxCount;
    $('detailChooseImage').hidden = refs.length + editQueue.length >= maxCount;
    $('detailRetryImages').hidden = !editQueue.length;
    $('detailRetryImages').disabled = working;
    $('detailAttachmentCount').textContent = String(refs.length + editQueue.length);
    $('detailAttachmentCount').hidden = !(refs.length + editQueue.length);
    $('detailAttachmentPanel').dataset.slots = Math.min(maxCount, refs.length + editQueue.length + 1);
    const editList = $('detailEditList');
    clearPreviews('detail');
    editList.replaceChildren();
    editList.hidden = !edit || !(refs.length || editQueue.length);
    if (edit) {
      refs.forEach((ref, index) => editList.append(makeChip(ref, () => {
        confirmRemoval(ref, () => {
        try {
          board.saveAttachments(card, refs.filter((_, i) => i !== index));
          renderDetail(board.detailCard(), true);
          report('detailImageStatus', 'Anexo removido do cartão. A imagem continua no Drive.');
        } catch (error) { report('detailImageStatus', error.message); }
        });
      }, 'detail')));
      editQueue.forEach((item, index) => editList.append(makeChip(item, () => {
        confirmRemoval(item, () => {
        editQueue.splice(index, 1);
        renderDetail(board.detailCard(), true);
        });
      }, 'detail')));
      requestAnimationFrame(() => resizeAttachments($('detailEditorWrap'), editList));
      return;
    }
    if (!refs.length) return;
    const count = document.createElement('span');
    count.className = 'attachment-count';
    count.textContent = 'Anexos';
    host.append(count);
    for (const [index, ref] of refs.entries()) {
      const open = button(shortName(ref.name), () => showImage(ref, refs, index));
      open.title = ref.name;
      open.setAttribute('aria-label', 'Abrir ' + ref.name);
      open.classList.add('attachment-note-thumbnail');
      const image = document.createElement('img');
      image.alt = '';
      image.hidden = true;
      const generation = previewGeneration.view;
      if (attachmentsConnected(ref.owner)) imageBlob(ref).then(blob => {
        if (generation !== previewGeneration.view) return;
        const url = URL.createObjectURL(blob);
        previewUrls.view.push(url);
        image.src = url;
        image.hidden = false;
      }).catch(() => {});
      open.prepend(image);
      host.append(open);
    }
  }

  async function uploadEdit() {
    const card = editTarget;
    if (!card || working) return;
    setFeedback('detail', 'uploading');
    const uploaded = await operate('detailImageStatus', 'Enviando imagens…', async () => {
      await connectIfNeeded();
      if (!board.canEditDetail(card)) throw Error('O cartão mudou. Feche e abra a nota novamente.');
      const refs = await uploadItems(editQueue);
      if (!window.QuadroDriveSync.account()) {
        const owner = window.QuadroDriveSync.attachmentAccountId();
        for (const ref of refs) ref.owner = owner;
      }
      board.saveAttachments(card, [...(card.attachments ?? []), ...refs]);
      editQueue = [];
      report('detailImageStatus');
      return true;
    });
    setFeedback('detail', uploaded ? 'success' : 'error');
    renderDetail(board.detailCard(), editing);
  }

  $('detailAddImages').onclick = () => void toggleAttachmentPanel('detail');
  $('detailChooseImage').onclick = () => openFilePicker('detailImages');
  $('detailRetryImages').onclick = () => void uploadEdit();
  document.addEventListener('pointerdown', event => {
    if ($('attachmentRemoveConfirm').contains(event.target)) return;
    for (const which of ['capture','detail']) {
      const panel = $(which + 'AttachmentPanel');
      const control = $(which === 'capture' ? 'captureAddImages' : 'detailAddImages');
      if (!panel.hidden && !panel.contains(event.target) && !control.contains(event.target)) {
        panel.hidden = true;
        control.setAttribute('aria-expanded','false');
        clearPreviews(which);
      }
    }
  });
  $('detailImages').onchange = event => {
    const files = Array.from(event.target.files);
    event.target.value = '';
    if (!files.length || working || !editTarget) return;
    try {
      editQueue = fileItems(files, maxCount - (editTarget.attachments?.length ?? 0));
      renderDetail(editTarget, true);
      void uploadEdit();
    } catch (error) { report('detailImageStatus', error.message); }
  };

  function closeViewerImage() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
    $('attachmentImage').removeAttribute('src');
    $('attachmentViewport').hidden = true;
    $('attachmentZoom').hidden = true;
    $('attachmentViewport').classList.remove('is-zoomed');
    $('attachmentZoom').textContent = 'Ampliar imagem';
    $('attachmentZoom').setAttribute('aria-pressed','false');
  }

  async function imageBlob(ref) {
    if (!attachmentsConnected(ref.owner)) throw Error('Conecte o Google Drive para visualizar a imagem.');
    const blob = await drive.download(ref.id);
    if (blob.size !== ref.size || (blob.type !== ref.type && blob.type !== 'application/octet-stream')) {
      throw Error('A imagem no Drive foi alterada desde que foi anexada.');
    }
    return blob.type === ref.type ? blob : new Blob([blob], { type: ref.type });
  }

  async function loadViewerImage(current) {
    const dialog = $('attachmentViewer');
    report('attachmentStatus', 'Buscando imagem no Drive…');
    $('attachmentConnect').hidden = true;
    try {
      const blob = current.ref.blob || await imageBlob(current.ref);
      if (viewer !== current || !dialog.open) return;
      const img = $('attachmentImage');
      closeViewerImage();
      imageUrl = URL.createObjectURL(blob);
      img.alt = current.ref.name;
      img.src = imageUrl;
      await img.decode();
      if (viewer !== current || !dialog.open) return;
      $('attachmentViewport').style.setProperty('--image-width', img.naturalWidth + 'px');
      $('attachmentViewport').hidden = false;
      $('attachmentZoom').hidden = false;
      report('attachmentStatus');
    } catch (error) {
      if (viewer !== current || !dialog.open) return;
      report('attachmentStatus', error instanceof TypeError ? 'Verifique a conexão e abra o anexo novamente.' : error.message);
      $('attachmentConnect').hidden = attachmentsConnected(current.ref.owner);
    }
  }

  function selectViewerImage(items, index) {
    const ref = items[index];
    viewer = { ref, items, index };
    $('attachmentTitle').textContent = ref.name;
    $('attachmentNavigation').hidden = items.length < 2;
    $('attachmentPrevious').disabled = index === 0;
    $('attachmentNext').disabled = index === items.length - 1;
    $('attachmentPosition').textContent = (index + 1) + ' / ' + items.length;
    closeViewerImage();
    void loadViewerImage(viewer);
  }

  function showImage(ref, items = [ref], index = 0) {
    if (!$('attachmentViewer').open) $('attachmentViewer').showModal();
    selectViewerImage(items, index);
  }
  $('attachmentPrevious').onclick = () => { if (viewer && viewer.index > 0) selectViewerImage(viewer.items, viewer.index - 1); };
  $('attachmentNext').onclick = () => { if (viewer && viewer.index < viewer.items.length - 1) selectViewerImage(viewer.items, viewer.index + 1); };

  $('attachmentConnect').onclick = async () => {
    const current = viewer;
    if (!current) return;
    try {
      await connectIfNeeded(current.ref.owner);
      if (viewer !== current || !$('attachmentViewer').open) return;
      if (!editing && $('cardDetail').open) renderDetail(board.detailCard(), false);
      await loadViewerImage(current);
    } catch (error) { if (viewer === current) report('attachmentStatus', error.message); }
  };

  $('attachmentClose').onclick = () => $('attachmentViewer').close();
  $('attachmentViewer').addEventListener('close', () => { viewer = null; closeViewerImage(); });
  $('attachmentZoom').onclick = () => {
    const zoomed = $('attachmentViewport').classList.toggle('is-zoomed');
    $('attachmentZoom').textContent = zoomed ? 'Ajustar à tela' : 'Ampliar imagem';
    $('attachmentZoom').setAttribute('aria-pressed', String(zoomed));
  };

  const cards = value => value.projects.flatMap(project => project.cards);
  function validateBoard(value) {
    for (const card of cards(value)) {
      const refs = card.attachments;
      if (refs === undefined) continue;
      if (!Array.isArray(refs) || refs.length > maxCount || refs.some(ref =>
        !ref || !drive.isId(ref.id) || typeof ref.name !== 'string' || !ref.name || ref.name.length > 180 ||
        !types.has(ref.type) || !Number.isSafeInteger(ref.size) || ref.size < 1 || ref.size > maxImage ||
        (ref.owner !== undefined && !drive.isId(ref.owner))
      ) || new Set(refs.map(ref => ref.id)).size !== refs.length) throw Error('Há referências de anexos inválidas no quadro.');
    }
  }

  const refsIn = value => new Map(cards(value).flatMap(card => card.attachments ?? []).map(ref => [ref.id,ref]));
  function encode(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(Error('Não foi possível preparar a imagem para o backup.'));
      reader.readAsDataURL(blob);
    });
  }

  async function backup() {
    await operate('driveStatus', 'Preparando o backup com imagens…', async () => {
      const snapshot = board.validate(board.read());
      const refs = [...refsIn(snapshot).values()];
      if (refs.length) await connectIfNeeded();
      if (refs.reduce((sum, ref) => sum + ref.size, 0) > 0.7 * maxBackup) {
        throw Error('As imagens ultrapassam o limite de 64 MB deste backup de teste.');
      }
      const images = [];
      for (const ref of refs) images.push({ id: ref.id, data: await encode(await imageBlob(ref)) });
      const value = { format: 'quadro-dev-hml-anexos', version: 1, board: snapshot, images };
      if (new Blob([JSON.stringify(value, null, 2)]).size > maxBackup) throw Error('O backup ultrapassa 64 MB.');
      board.download(value, 'Quadro_Dev_HML_com_imagens.json');
      report('driveStatus', 'Backup exportado com ' + images.length + ' imagem(ns).');
    });
  }

  async function parseBackup(file) {
    if (file.size > maxBackup) throw Error('O arquivo de backup ultrapassa 64 MB.');
    const data = JSON.parse(await file.text());
    if (data?.format !== 'quadro-dev-hml-anexos' || data.version !== 1 || !Array.isArray(data.images)) {
      throw Error('Escolha um backup de homologação com imagens.');
    }
    board.validate(data.board);
    const refs = refsIn(data.board);
    const files = new Map();
    for (const image of data.images) {
      const ref = refs.get(image?.id);
      if (!ref || files.has(ref.id) || typeof image.data !== 'string' ||
          image.data.length !== 4 * Math.ceil(ref.size / 3)) throw Error('O backup tem imagens inválidas.');
      const bytes = Uint8Array.from(atob(image.data), char => char.charCodeAt(0));
      if (bytes.byteLength !== ref.size) throw Error('O tamanho da imagem no backup não confere.');
      files.set(ref.id, { name: ref.name, blob: new Blob([bytes], { type: ref.type }) });
    }
    if (files.size !== refs.size) throw Error('Faltam imagens nesse backup.');
    return { name: file.name, size: file.size, modified: file.lastModified, data, files };
  }

  $('driveBackup').onclick = backup;
  $('driveRestore').onclick = () => openFilePicker('driveBackupFile');
  $('driveBackupFile').onchange = async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file || working) return;
    await operate('driveStatus', 'Verificando o backup…', async () => {
      if (!window.QuadroDriveSync.account() || !drive.connected()) throw Error('Conecte o quadro da conta Google antes de restaurar o backup.');
      if (!board.canApply()) throw Error('Feche a edição antes de restaurar o backup.');
      if (!restoring || restoring.name !== file.name || restoring.size !== file.size || restoring.modified !== file.lastModified) {
        restoring = await parseBackup(file);
      }
      if (!confirm('Substituir os cartões de teste desta conta e enviar cópias das imagens do backup ao Drive?')) return;
      const original = JSON.stringify(board.read());
      const target = structuredClone(restoring.data.board);
      const updated = new Map();
      report('driveStatus', 'Restaurando as imagens de teste…');
      for (const [id, item] of restoring.files) {
        const [ref] = await uploadItems([item]);
        updated.set(id, ref);
      }
      if (JSON.stringify(board.read()) !== original || !board.canApply()) {
        throw Error('O quadro mudou durante a restauração. Selecione o backup novamente para tentar.');
      }
      for (const card of cards(target)) {
        if (card.attachments) card.attachments = card.attachments.map(ref => updated.get(ref.id));
      }
      localStorage.setItem(window.QuadroPersistence.key + ':antes-restaurar', original);
      board.replace(target);
      restoring = null;
      report('driveStatus', 'Backup restaurado. A sincronização foi agendada.');
    });
  };

  function renderReadOnly(host, card) {
    host.replaceChildren();
    const refs = card.attachments ?? [];
    if (!refs.length) return;
    const list = document.createElement('ul');
    for (const ref of refs) listItem(list, button(ref.name, () => showImage(ref)));
    host.append(list);
  }

  window.QuadroAttachments = {
    renderReadOnly, validateBoard, renderDetail, backup, setFeedback, busy: () => working,
    hasDraftImages: () => draft.length > 0,
    captureStatus: message => report('captureImageStatus', message),
    uploadDraft: () => operate('captureImageStatus', 'Preparando o envio…', async () => {
      if (!window.QuadroDriveSync.account()) {
        throw Error('A autorização do Google não foi concluída. Toque no clipe para tentar novamente.');
      }
      if (!drive.connected()) {
        report('captureImageStatus', 'Autorize o Google Drive para continuar salvando…');
        await connectIfNeeded();
      }
      report('captureImageStatus', 'Enviando imagens…');
      try {
        return await uploadItems(draft);
      } catch (error) {
        if (!drive.connected()) {
          throw Error('A autorização expirou durante o envio. Toque no mesmo projeto para renovar e tentar de novo.');
        }
        throw error;
      }
    }),
    clearDraft: () => {
      draft.length = 0;
      $('captureAttachmentPanel').hidden = true;
      $('captureAddImages').setAttribute('aria-expanded','false');
      renderDraft();
      report('captureImageStatus');
    }
  };
  window.addEventListener('quadro-session-change', () => {
    // Selected files stay in the draft, but a Drive file ID belongs to its account.
    for (const item of draft) delete item.id;
    restoring = null;
  });
  window.addEventListener('resize', () => {
    resizeAttachments($('captureInputWrap'), $('captureImageList'));
    if (editing) resizeAttachments($('detailEditorWrap'), $('detailEditList'));
  });
  $('cardDetail').addEventListener('close', () => {
    if ($('attachmentRemoveConfirm').open) $('attachmentRemoveConfirm').close();
    $('detailAttachmentPanel').hidden = true;
    $('detailAddImages').setAttribute('aria-expanded','false');
    clearPreviews('detail');
    renderDetail(null, false);
  });
})();

