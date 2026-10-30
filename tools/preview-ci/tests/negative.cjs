const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),cases=path.join(root,'results','negative-'+Date.now());fs.mkdirSync(cases,{recursive:true});const results=[];
function test(name,mutate){const dir=path.join(cases,name);fs.mkdirSync(path.join(dir,'automation'),{recursive:true});fs.mkdirSync(path.join(dir,'site'));fs.copyFileSync(path.join(root,'automation/package-preview.cjs'),path.join(dir,'automation/package-preview.cjs'));fs.copyFileSync(path.join(root,'site/index.html'),path.join(dir,'site/index.html'));fs.copyFileSync(path.join(root,'source.json'),path.join(dir,'source.json'));mutate(dir);assert.throws(()=>require(path.join(dir,'automation/package-preview.cjs')).build(),{name:'AssertionError'},name);results.push({name,status:'rejected-as-expected'});}
const edit=(dir,fn)=>{const p=path.join(dir,'source.json'),s=JSON.parse(fs.readFileSync(p));fn(s);fs.writeFileSync(p,JSON.stringify(s));};
test('hash-alterado',dir=>fs.appendFileSync(path.join(dir,'site/index.html'),'alterado'));
test('ambiente-producao',dir=>edit(dir,s=>s.environment='production'));
test('commit-producao',dir=>edit(dir,s=>s.canonicalProductionCommit='a'.repeat(40)));
test('script-externo',dir=>{const p=path.join(dir,'site/index.html');fs.appendFileSync(p,'<script src="https://example.invalid/a.js"></script>');edit(dir,s=>s.sourceSha256=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));});
test('arquivo-extra-saida',dir=>{fs.mkdirSync(path.join(dir,'preview'));for(const f of ['index.html','manifest.json','credencial.txt'])fs.writeFileSync(path.join(dir,'preview',f),'nao-publicar');});
fs.writeFileSync(path.join(root,'results/negative.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
