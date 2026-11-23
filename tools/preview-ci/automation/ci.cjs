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
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'preview/manifest.json')));
  for (const name of Object.keys(manifest.files)) {
    if (!/\.(html|js)$/.test(name)) continue;
    const source = fs.readFileSync(path.join(root, 'preview', name), 'utf8');
    if (name.endsWith('.js')) {
      new vm.Script(source, {filename: name});
      continue;
    }
    const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
    assert(scripts.length > 0);
    scripts.forEach((script, i) => new vm.Script(script[1], {filename:`${name}:inline-${i}.js`}));
  }
});
check('saída reproduzível byte a byte', () => {
  const before = fs.readFileSync(path.join(root, 'preview/manifest.json'));
  build(); assert.deepEqual(fs.readFileSync(path.join(root, 'preview/manifest.json')), before);
});
check('cenários negativos executados', () => require('../tests/negative.cjs'));
fs.mkdirSync(path.join(root,'results'), {recursive:true});
fs.writeFileSync(path.join(root,'results/ci.json'), JSON.stringify({checks,limits:['Sem execução no GitHub Actions','Sem Firebase ou emuladores','Teste de navegador em comando separado']},null,2)+'\n');
console.log(JSON.stringify({checks:checks.length}));
