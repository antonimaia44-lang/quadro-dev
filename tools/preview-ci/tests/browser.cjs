const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true});const results=[];
try {for(const width of [390,1280]) {
 const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
 const external=[],errors=[];
 await ctx.route('**/*',route=>{const u=new URL(route.request().url());if(u.href==='http://127.0.0.1:40227/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'preview/index.html'))});external.push(u.href);return route.abort()});
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:40227/');await page.waitForFunction(()=>window.quadro);
 assert.equal(await page.locator('#syncLogin').isEnabled(),false);
 assert.match(await page.locator('body').innerText(),/dados fictícios/);
 const initial=await page.evaluate(()=>window.quadro.read());assert.equal(initial.projects.length,2);
 const text='Teste sintético <script>não executar</script> 🧪 ação';
 await page.locator('#idea').fill(text);const project=initial.active;await page.locator('[data-capture="'+project+'"]').click();
 const added=await page.evaluate(()=>window.quadro.read().projects[0].cards.at(-1));assert.equal(added.text,text);
 assert.equal(await page.locator('#idea').inputValue(),'');await page.reload();await page.waitForFunction(()=>window.quadro);
 assert.equal(await page.evaluate(()=>window.quadro.read().projects[0].cards.at(-1).text),text);
 if(width<850)await page.locator('#ideasToggle').click();
 await page.locator('[data-action="next"][data-id="'+added.id+'"]').click();
 assert.equal(await page.evaluate(()=>window.quadro.read().projects[0].cards.at(-1).stage),1);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(root,'results',width<850?'mobile.png':'desktop.png'),fullPage:true});
 // Demonstrate that a deliberate external request cannot reach a remote server.
 const blocked=await page.evaluate(async()=>{try{await fetch('https://example.invalid/probe');return false}catch{return true}});assert(blocked);
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 results.push({width,passed:['seed fictício','login desativado','captura literal','persistência','movimentação','layout','requisição externa bloqueada'],externalRequests:0,pageErrors:0});await ctx.close();
}}finally{await browser.close()}
fs.writeFileSync(path.join(root,'results/browser.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1});
