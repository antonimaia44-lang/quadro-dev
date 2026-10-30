const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function build() {
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'source.json')));
  assert.equal(spec.environment, 'offline-synthetic');
  assert.equal(spec.canonicalProductionCommit, null);
  const source = path.join(root, 'site/index.html');
  assert(!fs.lstatSync(source).isSymbolicLink());
  const bytes = fs.readFileSync(source), html = bytes.toString('utf8');
  assert.equal(sha(bytes), spec.sourceSha256, 'Fonte mudou: exige revisão explícita');
  assert(html.includes("connect-src 'none'"));
  assert(html.includes('dados fictícios'));
  assert(!/<script[^>]+src\s*=|<link[^>]+href\s*=|<iframe|<base\b/i.test(html));
  assert(!/https?:\/\/|firebaseio|googleapis|AIza|BEGIN PRIVATE KEY/i.test(html));
  assert(html.includes('quadro-dev-local:previa-ideia-023'));
  const out = path.join(root, 'preview');
  if (fs.existsSync(out)) {
    assert(!fs.lstatSync(out).isSymbolicLink());
    assert.deepEqual(fs.readdirSync(out).sort(), ['index.html', 'manifest.json']);
    for (const name of fs.readdirSync(out)) assert(fs.lstatSync(path.join(out, name)).isFile());
  } else fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'index.html'), bytes);
  const manifest = {schema: 1, environment: spec.environment, source: spec.source, sourceSha256: spec.sourceSha256,
    canonicalProductionCommit: null, files: {'index.html': sha(bytes)}};
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (require.main === module) { build(); console.log('Prévia offline gerada e verificada.'); }
module.exports = {build, sha, root};
