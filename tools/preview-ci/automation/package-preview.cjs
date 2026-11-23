const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const attachmentFiles = [
  '_headers',
  'anexos/attachments.css',
  'anexos/attachments.js',
  'anexos/drive-sync.js',
  'anexos/drive.js',
  'anexos/index.html',
];

function filesIn(directory, prefix = '') {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const name = prefix + entry.name;
    if (entry.isDirectory()) return filesIn(path.join(directory, entry.name), name + '/');
    assert(entry.isFile(), 'Somente arquivos regulares podem ser publicados');
    return name;
  }).sort();
}

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
  assert.equal(spec.attachments?.environment, 'drive-homologation');
  assert.deepEqual(Object.keys(spec.attachments.files).sort(), attachmentFiles);
  const files = {'index.html': sha(bytes)};
  const payload = new Map([['index.html', bytes]]);
  for (const name of attachmentFiles) {
    const file = path.join(root, 'site', name);
    assert(fs.lstatSync(file).isFile());
    const data = fs.readFileSync(file);
    files[name] = sha(data);
    assert.equal(files[name], spec.attachments.files[name], 'Arquivo de homologação alterado: ' + name);
    assert(!/quadro-dev-ebb4b|github\.io|firebaseio|BEGIN (?:RSA |EC )?PRIVATE KEY|client_secret/i.test(data.toString()));
    payload.set(name, data);
  }
  const drivePage = payload.get('anexos/index.html').toString('utf8');
  assert(drivePage.includes('Homologação de anexos'));
  assert(drivePage.includes("connect-src https://www.googleapis.com https://accounts.google.com/gsi/;"));
  assert.deepEqual(
    Array.from(drivePage.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi), match => match[1]).sort(),
    ['attachments.js', 'drive-sync.js', 'drive.js', 'https://accounts.google.com/gsi/client']
  );
  assert.match(payload.get('anexos/drive.js').toString(), /113837472975-[a-z0-9]+\.apps\.googleusercontent\.com/);
  assert(payload.get('anexos/drive.js').includes('quadro-dev-anexos-hml-v3'));
  const out = path.join(root, 'preview');
  const outputFiles = [...payload.keys(), 'manifest.json'].sort();
  if (fs.existsSync(out)) {
    assert(!fs.lstatSync(out).isSymbolicLink());
    const existing = filesIn(out);
    assert(existing.every(name => outputFiles.includes(name)), 'A saída contém arquivos não autorizados');
  } else fs.mkdirSync(out);
  fs.mkdirSync(path.join(out, 'anexos'), {recursive: true});
  for (const [name, data] of payload) fs.writeFileSync(path.join(out, name), data);
  const manifest = {schema: 2, environment: spec.environment, source: spec.source, sourceSha256: spec.sourceSha256,
    canonicalProductionCommit: null, attachmentsEnvironment: spec.attachments.environment, files};
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (require.main === module) { build(); console.log('Prévia offline gerada e verificada.'); }
module.exports = {build, sha, root};
