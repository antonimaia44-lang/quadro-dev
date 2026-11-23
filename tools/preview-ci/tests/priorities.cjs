const { chromium } = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport:{width:390,height:820}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://localhost:5118') return route.abort();
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      return route.fulfill({path:path.resolve(__dirname,'../preview/anexos',name),
        contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8'});
    });
    await page.goto('http://localhost:5118/');
    await page.locator('#ideasToggle').click();
    await page.locator('#manageProjectsFromIdeas').click();
    await page.locator('[data-priority-select="demo"]').click();
    await page.locator('[data-priority-select="demo-outro"]').click();
    const first = await page.locator('[data-priority-grip="demo"]').boundingBox();
    const second = await page.locator('[data-priority-grip="demo-outro"]').boundingBox();
    await page.mouse.move(first.x+first.width/2,first.y+first.height/2);
    await page.mouse.down();
    await page.mouse.move(second.x+second.width/2,second.y+second.height/2,{steps:8});
    await page.mouse.up();
    assert.equal(await page.evaluate(()=>window.quadro.read().projects.find(p=>p.id==='demo').priorityRank),2);
    await page.locator('#manageDialogActions #manageProjects').click();
    if (await page.locator('#ideasDialog').evaluate(e=>e.open)) await page.locator('#closeIdeasDialog').click();
    await page.reload();
    assert.equal(await page.evaluate(()=>window.quadro.read().projects.find(p=>p.id==='demo-outro').priorityRank),1);
    for (const name of ['Recente A','Recente B']) {
      await page.locator('#newProject').click();
      await page.locator('#projectName').fill(name);
      await page.locator('#createProject').click();
    }
    const positions = () => page.locator('#captureButtons [data-capture]').evaluateAll(buttons=>buttons.map(button=>({name:button.textContent,column:button.parentElement.style.gridColumn,row:button.parentElement.style.gridRow})));
    let items = await positions();
    assert.deepEqual(items.filter(item=>item.column==='2').map(item=>item.name),['Recente B','Recente A']);
    await page.locator('#idea').fill('Ideia fictícia');
    await page.getByRole('button',{name:'Recente A',exact:true}).click();
    items = await positions();
    assert.equal(items.find(item=>item.name==='Recente A').row,'1');
    assert.deepEqual(errors,[]);
    console.log('OK: prioridades, arrasto, persistência e projetos recentes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
