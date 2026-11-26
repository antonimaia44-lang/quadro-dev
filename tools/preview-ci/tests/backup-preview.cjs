const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const url = 'http://127.0.0.1:40227/teste-backup/';
const html = fs.readFileSync(path.join(root, 'preview/teste-backup/index.html'));
const now = Date.UTC(2026, 10, 26, 15);
const active = {
  id:'teste', name:'Projeto de teste', next:4, priorityRank:1, projectCreatedAt:now, cards:[
    {id:1, text:'Ideia com caracteres especiais <em>🧪</em>', ideaTitle:'Título', stage:0, attachments:[{id:'referencia-do-oficial'}]},
    {id:2, text:'Nota concluída', stage:0, completedAt:now},
    {id:3, text:'Nota arquivada', stage:0, archived:true}
  ]
};
const fixture = {version:2, active:'teste', projects:[
  active,
  {id:'concluido', name:'Projeto concluído de teste', next:1, cards:[], projectCompleted:true, projectCompletedAt:now},
  {id:'arquivado', name:'Projeto arquivado de teste', next:1, cards:[], projectArchived:true}
]};

async function importBackup(page, backup, options = {}) {
  await page.locator('#desktopTools summary').click();
  const chooserEvent = page.waitForEvent('filechooser');
  await page.locator('#importBackup').click();
  const chooser = await chooserEvent;
  if (options.dialog) {
    page.once('dialog', async dialog => {
      assert.match(dialog.message(), /desta prévia/);
      if (options.dialog === 'cancel') await dialog.dismiss();
      else await dialog.accept();
    });
  }
  await chooser.setFiles({
    name:'backup-teste.json', mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(backup))
  });
}

async function run() {
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({viewport:{width, height:900}, reducedMotion:'reduce', serviceWorkers:'block'});
      const unexpectedRequests = [];
      await context.route('**/*', route => {
        if (route.request().url() === url) return route.fulfill({contentType:'text/html', body:html});
        unexpectedRequests.push(route.request().url());
        return route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(9000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url);
      await page.waitForFunction(() => window.quadro);
      const read = () => page.evaluate(() => window.quadro.read());
      assert.deepEqual((await read()).projects, []);
      await page.evaluate(() => localStorage.setItem('quadro-dev-local:production-v2', 'marcador de teste'));

      await importBackup(page, fixture, {dialog:'accept'});
      await page.locator('#toast').getByText('Backup importado para esta prévia.').waitFor();
      const copies = (await read()).projects;
      assert.equal(copies.length, 3);
      assert.deepEqual(copies[0], {...active, cards:active.cards.map(({attachments, ...card}) => card)});
      assert.equal(copies[1].projectCompletedAt, now);
      assert.equal(copies[2].projectArchived, true);
      await page.reload();
      assert.deepEqual((await read()).projects, copies);
      assert.equal(await page.locator('#syncPanel, #drivePanel').count(), 0);

      if (width >= 850) {
        await page.locator('#desktopNoteViews [data-note-view="completed"]').click();
        await page.locator('#stages').getByText('Nota concluída', {exact:true}).waitFor();
        await page.locator('#desktopNoteViews [data-note-view="archived"]').click();
        await page.locator('#stages').getByText('Nota arquivada', {exact:true}).waitFor();
        await page.locator('#manageProjects').click();
        await page.locator('#completedProjectsToggle').click();
        await page.locator('#projectCollectionDialog').getByText('Projeto concluído de teste', {exact:false}).waitFor();
        await page.keyboard.press('Escape');
        await page.locator('#projectCollectionDialog').waitFor({state:'hidden'});
        await page.locator('#archiveToggle').click();
        await page.locator('#projectCollectionDialog').getByText('Projeto arquivado de teste', {exact:false}).waitFor();
        await page.keyboard.press('Escape');
        await page.locator('#projectCollectionDialog').waitFor({state:'hidden'});
        await page.keyboard.press('Escape');
        await page.locator('#manageProjectDialog').waitFor({state:'hidden'});
        await page.locator('#captureToggle').click();
      }
      await page.locator('#idea').fill('Nota de teste com imagem local');
      await page.locator('#captureAddImages').click();
      await page.locator('#captureImages').setInputFiles({
        name:'teste.png', mimeType:'image/png',
        buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwWXIfAALHAbiOQNYnAAAAAElFTkSuQmCC', 'base64')
      });
      await page.locator(width >= 850 ? '[data-capture-target="teste"]' : '[data-capture="teste"]').click();
      await page.waitForFunction(() => window.quadro.read().projects[0].cards.some(card => card.attachments?.length));
      const uploaded = (await read()).projects[0].cards.find(card => card.attachments?.length);
      await page.reload();
      assert.equal(await page.evaluate(async id => (await window.QuadroDrive.download(id)).type, uploaded.attachments[0].id), 'image/png');

      if (width >= 850) {
        const card = page.locator('[data-description="' + uploaded.id + '"]');
        await card.click();
        await page.locator('#cardDescription').click();
        await page.locator('#detailAddImages').click();
        await page.locator('#detailEditList').getByRole('button', {name:'Remover teste.png'}).click();
        await page.locator('#confirmAttachmentRemove').click();
        await page.waitForFunction(id => !window.quadro.read().projects[0].cards.find(card => card.id === id)?.attachments, uploaded.id);
        assert(await page.evaluate(async id => {
          try { await window.QuadroDrive.download(id); return false; } catch { return true; }
        }, uploaded.attachments[0].id));
        await page.reload();
      }
      const previous = await read();
      await importBackup(page, {version:2, active:'ausente', projects:[]});
      await page.locator('#toast').getByText(/Backup inválido/).waitFor();
      assert.deepEqual(await read(), previous);
      await page.locator('#desktopTools summary').click();
      const legacy = {version:1, active:'antigo', projects:[{
        id:'antigo', name:'Projeto anterior', nextId:3,
        cards:[{id:1, title:'Título anterior', desc:'Descrição anterior', stage:1}],
        archived:[{id:2, title:'Arquivada', desc:'', stage:0, attachments:[{id:'imagem-antiga'}]}]
      }]};
      await importBackup(page, legacy, {dialog:'cancel'});
      assert.deepEqual(await read(), previous);
      await page.locator('#desktopTools summary').click();
      await importBackup(page, {format:'quadro-dev-anexos', version:1, board:legacy, images:[{data:'ignorar'}]}, {dialog:'accept'});
      await page.locator('#toast').getByText('Backup importado para esta prévia.').waitFor();
      const [project] = (await read()).projects;
      assert.deepEqual(project.cards, [
        {id:1, text:'Título anterior\nDescrição anterior', stage:1, archived:false},
        {id:2, text:'Arquivada', stage:0, archived:true}
      ]);
      const recoveryFile = {
        schema:1, scope:'teste', recovery:{
          schema:1,
          journal:{schema:1, base:{revision:2, board:{version:1, active:null, projects:[]}}, pending:null, conflict:null},
          local:{...legacy, projects:[{...legacy.projects[0], name:'Cópia local de recuperação'}]}
        }
      };
      await importBackup(page, recoveryFile, {dialog:'accept'});
      await page.waitForFunction(() => window.quadro.read().projects[0]?.name === 'Cópia local de recuperação');
      await page.reload();
      const [recovered] = (await read()).projects;
      assert.equal(recovered.name, 'Cópia local de recuperação');
      assert.deepEqual(recovered.cards, project.cards);
      assert.equal(await page.evaluate(() => localStorage.getItem('quadro-dev-local:production-v2')), 'marcador de teste');
      const canConnect = await page.evaluate(async () => {
        try { await fetch('https://example.invalid/check'); return true; } catch { return false; }
      });
      assert.equal(canConnect, false);
      assert.deepEqual(unexpectedRequests, []);
      assert.deepEqual(errors, []);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({path:path.join(root, 'results', 'backup-' + width + '.png'), fullPage:true});
      results.push(width);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log('Prévia de backup verificada em ' + results.join(' e ') + ' px.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
