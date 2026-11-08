'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const test=require('node:test');
const root=path.join(__dirname,'..');
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'frame-release-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'tools'));
  for(const file of ['sw.js','tools/prepare-release.py','tools/pwa-update-client.js'])fs.copyFileSync(path.join(root,file),path.join(dir,file));
  for(const file of ['index.html','compose.html'])fs.writeFileSync(path.join(dir,file),'<html>'+file+'<script>/* FRAME_UPDATE_CLIENT_BEGIN *//* FRAME_UPDATE_CLIENT_END */\nstartFrameUpdates({build: /* FRAME_RELEASE_ID */ \'pending\',safeToReload:function(){return true;}});</script></html>');
  const run=(...args)=>spawnSync('python3',[path.join(dir,'tools/prepare-release.py'),...args],{encoding:'utf8'});
  const read=file=>fs.readFileSync(path.join(dir,file),'utf8');
  return {dir,run,read,edit:(file,edit)=>fs.writeFileSync(path.join(dir,file),edit(read(file))),id:()=>read('sw.js').match(/"id":"([a-f0-9]+)"/)[1]};
}
test('release generation is reproducible and verifies actual final page bytes',t=>{
  const f=fixture(t);assert.equal(f.run().status,0);const first=f.read('sw.js'),id=f.id();assert.equal(f.run('--check').status,0);assert.equal(f.run().status,0);assert.equal(f.id(),id);assert.equal(f.read('sw.js'),first);
  const {createHash}=require('node:crypto'),release=JSON.parse(first.match(/var RELEASE = (.*);/)[1]);
  for(const name of ['index.html','compose.html'])assert.equal(release.files[name],createHash('sha256').update(f.read(name)).digest('hex'));
});
test('editing either page invalidates metadata and changes the shared release ID',t=>{
  const f=fixture(t);f.run();const old=f.id();f.edit('compose.html',text=>text.replace('<html>','<html>new UI'));assert.notEqual(f.run('--check').status,0);assert.equal(f.run().status,0);assert.notEqual(f.id(),old);assert.match(f.read('index.html'),new RegExp(f.id()));
});
test('worker logic and canonical updater changes each produce a new release',t=>{
  const f=fixture(t);f.run();const old=f.id();f.edit('sw.js',text=>text+'\n/* changed behavior */\n');assert.notEqual(f.run('--check').status,0);f.run();assert.notEqual(f.id(),old);const next=f.id();f.edit('tools/pwa-update-client.js',text=>text+'\n/* changed updater */\n');assert.notEqual(f.run('--check').status,0);f.run();assert.notEqual(f.id(),next);assert.match(f.read('index.html'),/changed updater/);
});
