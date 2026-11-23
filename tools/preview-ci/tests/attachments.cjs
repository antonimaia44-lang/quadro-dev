const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwWXIfAALHAbiOQNYnAAAAAElFTkSuQmCC','base64');
const assets = path.resolve(__dirname, '../preview/anexos');
const output = path.resolve(__dirname, '../results');
const files = new Map();
let sequence = 0;
let failImage = false;
let expire = false;

async function mock(context) {
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === 'http://localhost:5118') {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      return route.fulfill({path: path.join(assets,name),
        contentType: name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8'});
    }
    if (url.origin === 'https://accounts.google.com') {
      return route.fulfill({contentType:'application/javascript', body:
        "window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:o=>({requestAccessToken:()=>o.callback({access_token:'local-test',expires_in:3600})})}}};"});
    }
    if (url.origin !== 'https://www.googleapis.com') return route.abort();
    assert.match(req.headers().authorization, /^Bearer local-test$/);
    if (url.pathname.endsWith('/about')) return route.fulfill({json:{user:{permissionId:'lab-test-account',emailAddress:'teste@example.test'}}});
    if (url.pathname.endsWith('/generateIds')) return route.fulfill({json:{ids:['file-' + ++sequence]}});
    if (url.pathname.startsWith('/upload/')) {
      const body = req.postDataBuffer();
      const header = Buffer.from('\r\n\r\n');
      const metaStart = body.indexOf(header) + 4;
      const metaEnd = body.indexOf('\r\n--quadro_', metaStart);
      const metadata = JSON.parse(body.subarray(metaStart,metaEnd));
      const start = body.indexOf(header,metaEnd) + 4;
      const end = body.lastIndexOf('\r\n--quadro_');
      if (files.has(metadata.id)) return route.fulfill({status:409});
      if (metadata.appProperties.kind === 'image' && failImage) return route.fulfill({status:503});
      files.set(metadata.id,{metadata, data:body.subarray(start,end)});
      return route.fulfill({json:{id:metadata.id}});
    }
    if (expire && url.pathname.endsWith('/files')) { expire = false; return route.fulfill({status:401}); }
    if (url.pathname.endsWith('/files')) return route.fulfill({json:{
      files:[...files.values()].filter(f=>f.metadata.appProperties.kind==='board').map(f=>f.metadata)
    }});
    const id = url.pathname.split('/').pop();
    const file = files.get(id);
    if (!file) return route.fulfill({status:404});
    if (url.searchParams.get('alt') === 'media') {
      return route.fulfill({body:file.data,contentType:file.metadata.mimeType});
    }
    return route.fulfill({json:{ ...file.metadata,size:file.data.length }});
  });
}

async function waitFor(p,selector) { await p.locator(selector).waitFor({timeout:8000}); }
async function status(p, label) { await p.waitForFunction(label => document.querySelector('#driveStatus').textContent.includes(label),label,{timeout:8000}); }
async function connect(p) {
  await p.goto('http://localhost:5118/');
  await p.waitForFunction(()=>window.google && window.QuadroDriveSync);
  await p.locator('#drivePanel summary').click();
  await p.locator('#driveConnect').click();
  await status(p,'Quadro sincronizado');
}
function image(name){return {name,mimeType:'image/png',buffer:png};}
function cardsOn(p) { return p.evaluate(()=>window.quadro.read().projects.flatMap(project=>project.cards)); }
(async () => {
  const browser = await chromium.launch();
  try {
    const desktop = await browser.newContext({viewport:{width:1280,height:820},acceptDownloads:true});
    const phone = await browser.newContext({viewport:{width:390,height:820},isMobile:true,hasTouch:true});
    await mock(desktop);await mock(phone);
    const d = await desktop.newPage(), p = await phone.newPage();
    const errors = []; d.setDefaultTimeout(10000); p.setDefaultTimeout(10000);
    for(const page of [d,p])page.on('pageerror',error=>errors.push(error.message));
    await Promise.all([connect(d),connect(p)]);
    await p.locator('#ideasToggle').click();
    await p.locator('#manageProjectsFromIdeas').click();
    await p.locator('[data-priority-select="demo"]').click();
    await p.locator('[data-priority-select="demo-outro"]').click();
    await p.locator('#manageDialogActions #manageProjects').click();
    if(await p.locator('#ideasDialog').evaluate(e=>e.open)) await p.locator('#closeIdeasDialog').click();
    await p.waitForTimeout(1600);
    await d.locator('#driveSync').click();
    await d.waitForFunction(()=>window.quadro.read().projects.some(x=>x.id==='demo'&&x.priorityRank===1));

    await p.locator('#idea').fill('Ideia digitada no celular');
    await p.locator('[data-capture="demo"]').tap();
    await p.waitForFunction(()=>window.quadro.read().projects[0].cards.some(c=>c.text==='Ideia digitada no celular'));
    await p.waitForTimeout(1300);
    await d.locator('#driveSync').click();
    await d.waitForFunction(()=>window.quadro.read().projects[0].cards.some(c=>c.text==='Ideia digitada no celular'));
    await d.locator('#idea').fill('Cartão fictício com três imagens');
    await d.locator('#captureAddImages').click();
    await d.locator('#captureImages').setInputFiles([image('a.png'),image('b.png'),image('c.png'),image('d.png')]);
    await d.waitForFunction(()=>document.querySelector('#captureImageStatus').textContent.includes('até três'));
    await d.locator('#captureImages').setInputFiles([image('a.png'),image('b.png')]);
    assert.equal(await d.locator('#captureInputWrap #captureImageList li').count(),2);
    await d.getByRole('button',{name:'Remover b.png'}).click();
    assert.equal(await d.locator('#captureImageList li').count(),1);
    await d.locator('#captureImages').setInputFiles(image('b.png'));
    failImage=true;
    await d.locator('[data-capture="demo"]').click();
    await d.waitForFunction(()=>document.querySelector('#captureImageStatus').textContent.includes('HTTP 503')).catch(async e=>{console.log(await d.locator('#captureImageStatus').textContent(),errors);throw e});
    assert.equal((await cardsOn(d)).filter(c=>c.text.startsWith('Cartão fictício')).length,0);
    assert(await d.locator('#captureAddImages').evaluate(e=>e.classList.contains('is-error')));
    failImage=false;
    expire=true;
    await d.locator('#driveSync').click();
    await d.getByRole('button',{name:'Reconectar Google Drive'}).waitFor();
    assert.equal(await d.locator('#idea').inputValue(),'Cartão fictício com três imagens');
    assert.equal(await d.locator('#captureImageList li').count(),2);
    await d.locator('[data-capture="demo"]').click();
    await d.waitForFunction(()=>document.querySelector('#captureAddImages').classList.contains('is-success'));
    await d.waitForFunction(()=>window.quadro.read().projects[0].cards.some(c=>c.attachments?.length===2));
    await d.waitForTimeout(1600);
    await p.locator('#driveSync').click();
    await p.waitForFunction(()=>window.quadro.read().projects[0].cards.some(c=>c.attachments?.length===2));
    await p.locator('#ideasToggle').click();
    await p.locator('#tabs [data-view="demo"]').click();
    await p.getByText('Cartão fictício com três imagens',{exact:true}).click();
    assert.equal(await p.locator('#detailImageList button').count(),2);
    await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedForTest=value}}}));
    await p.locator('#copyDetail').click();
    await p.waitForFunction(()=>window.copiedForTest?.includes('a.png')&&window.copiedForTest?.includes('b.png'));

    assert.equal(await p.locator('#detailImageList button').first().innerText(),'a');
    await p.getByRole('button',{name:'Abrir a.png',exact:true}).click();
    await waitFor(p,'#attachmentViewport:not([hidden])');
    assert.equal(await p.locator('#attachmentImage').evaluate(img=>img.naturalWidth),1);
    await p.locator('#attachmentZoom').click();
    assert.equal(await p.locator('#attachmentZoom').getAttribute('aria-pressed'),'true');
    await p.screenshot({path:path.join(output,'quadro-anexos-mobile.png')});
    await p.locator('#attachmentClose').click();
    await p.locator('#editDescription').click();
    await p.locator('#detailAddImages').click();
    await p.locator('#detailImages').setInputFiles(image('c.png'));
    await p.waitForFunction(()=>window.quadro.read().projects[0].cards.some(c=>c.attachments?.length===3));
    await p.waitForFunction(()=>document.querySelectorAll('#detailEditList li').length===3);
    await p.waitForFunction(()=>document.querySelector('#detailAddImages').classList.contains('is-success'));
    const positions=await p.locator('#detailEditList li').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().top));
    assert(positions.every(y=>Math.abs(y-positions[0])<1));
    await p.getByRole('button',{name:'Remover c.png'}).click();
    await p.locator('#cancelAttachmentRemove').click();
    assert((await cardsOn(p)).some(c=>c.attachments?.length===3));
    await p.getByRole('button',{name:'Remover c.png'}).click();
    await p.locator('#confirmAttachmentRemove').click();
    await p.waitForFunction(()=>window.quadro.read().projects[0].cards.some(c=>c.attachments?.length===2));
    await p.locator('#detailImages').setInputFiles(image('c.png'));
    await p.waitForFunction(()=>window.quadro.read().projects[0].cards.some(c=>c.attachments?.length===3));
    await p.locator('#closeDescription').click();
    await p.waitForTimeout(1600);
    await d.locator('#driveSync').click();
    await d.waitForFunction(()=>window.quadro.read().projects[0].cards.some(c=>c.attachments?.length===3));
    const download = d.waitForEvent('download');
    await d.locator('#driveBackup').click();
    const saved = await (await download).path();
    const backup = JSON.parse(fs.readFileSync(saved,'utf8'));
    assert.equal(backup.images.length,3);
    assert(backup.board.projects.some(x=>x.id==='demo'&&x.priorityRank===1));
    assert(backup.images.every(img=>Buffer.from(img.data,'base64').equals(png)));
    d.once('dialog',dialog=>dialog.accept());
    await d.locator('#driveBackupFile').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await d.waitForFunction(ids=>window.quadro.read().projects[0].cards.some(c=>c.attachments?.length===3 &&
      c.attachments.every(ref=>!ids.includes(ref.id))),backup.images.map(i=>i.id));
    assert((await d.evaluate(()=>window.quadro.read())).projects.some(x=>x.id==='demo'&&x.priorityRank===1));
    await d.screenshot({path:path.join(output,'quadro-anexos-desktop.png')});
    assert.deepEqual(errors,[]);
    console.log('OK: toque no celular, autorização expirada, renovação ao salvar, anexos nos dois navegadores, backup e restauração.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
