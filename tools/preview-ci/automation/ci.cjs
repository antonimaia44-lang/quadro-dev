const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {build, root, sha} = require('./package-preview.cjs');
const checks = [];
function check(name, fn) { fn(); checks.push({name, status:'passed'}); }
check('fonte sintética validada e pacote gerado', () => build());
check('JavaScript inline compila sem executar aplicação', () => {
  const vm = require('node:vm');
  const html = fs.readFileSync(path.join(root, 'preview/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert(scripts.length > 0);
  scripts.forEach((s, i) => new vm.Script(s[1], {filename:`inline-${i}.js`}));
});
check('saída reproduzível byte a byte', () => {
  const before = fs.readFileSync(path.join(root, 'preview/manifest.json'));
  build(); assert.deepEqual(fs.readFileSync(path.join(root, 'preview/manifest.json')), before);
});
check('cinco cenários negativos executados', () => require('../tests/negative.cjs'));
fs.mkdirSync(path.join(root,'results'), {recursive:true});
fs.writeFileSync(path.join(root,'results/ci.json'), JSON.stringify({checks,limits:['Sem execução no GitHub Actions','Sem Firebase ou emuladores','Teste de navegador em comando separado']},null,2)+'\n');
console.log(JSON.stringify({checks:checks.length}));
