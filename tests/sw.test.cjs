'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const script=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
const scope='https://mattyuhz.github.io/Frame/';
const bytes={'index.html':'frame release one','compose.html':'compose release one'};
const release={id:'test-release',files:Object.fromEntries(Object.entries(bytes).map(([name,value])=>[name,createHash('sha256').update(value).digest('hex')]))};
const prefix='frame:'+scope+':release:',cacheName=prefix+release.id;
class Channel{
  constructor(){
    this.port1={close(){}};this.port2={close(){}};
    this.port1.postMessage=data=>queueMicrotask(()=>this.port2.onmessage?.({data}));
    this.port2.postMessage=data=>queueMicrotask(()=>this.port1.onmessage?.({data}));
  }
}
function client(id,ready=true,url=scope,extra={}){
  const messages=[];
  return {id,url,messages,postMessage(data,ports){messages.push(data);if((data.type==='FRAME_PREPARE'||data.type==='FRAME_PROBE')&&ready!==null)ports[0].postMessage({ready});},...extra};
}
function boot(options={}){
  const handlers={},puts=[],deleted=[],fetched=[],opened=[],stored=new Map();let skipped=0,claimed=0,listed=0;
  const cache={put:async(key,response)=>{if(options.beforePut)await options.beforePut();puts.push(key);stored.set(key,response);},match:async key=>options.hit||stored.get(key)};
  const ctx={URL,Request,Response,Uint8Array,crypto:webcrypto,MessageChannel:Channel,Date,Promise,
    setTimeout:fn=>setTimeout(fn,15),clearTimeout,
    caches:{open:async name=>{opened.push(name);return cache;},keys:async()=>options.keys||[],delete:async key=>{deleted.push(key);}},
    fetch:async request=>{fetched.push(request);if(options.fetch)return options.fetch(request);const name=new URL(request.url).pathname.split('/').pop();return new Response(bytes[name]||'',{status:200});},
    self:{registration:{scope:options.scope||scope},addEventListener:(name,fn)=>handlers[name]=fn,
      skipWaiting:async()=>{skipped++;},clients:{claim:async()=>{claimed++;},matchAll:async()=>{listed++;return options.list?options.list(listed):options.clients||[];}}}};
  vm.runInNewContext(script.replace(/\/\* FRAME_RELEASE_BEGIN \*\/[\s\S]*?\/\* FRAME_RELEASE_END \*\//,'var RELEASE = '+JSON.stringify(release)+';'),ctx);
  function lifecycle(name){let pending;handlers[name]({waitUntil:p=>pending=p});return pending;}
  function request(url=scope,init={}){let pending;handlers.fetch({request:new Request(url,init),respondWith:p=>pending=p});return pending;}
  function check(source=client('sender')){let pending;handlers.message({data:{type:'FRAME_CHECK'},source,ports:[],waitUntil:p=>pending=p});return pending;}
  function buildQuery(port){handlers.message({data:{type:'FRAME_BUILD'},ports:[port]});}
  return {lifecycle,request,check,buildQuery,puts,deleted,fetched,opened,stored,get skipped(){return skipped;},get claimed(){return claimed;}};
}
test('install verifies both exact release files and waits for writes without forcing activation',async()=>{
  let finish;const blocked=new Promise(resolve=>finish=resolve);const f=boot({beforePut:()=>blocked});let done=false;
  const install=f.lifecycle('install').then(()=>done=true);
  await new Promise(resolve=>setTimeout(resolve,15));assert.equal(done,false);finish();await install;
  assert.deepEqual(f.puts,[scope+'index.html',scope+'compose.html']);assert.equal(f.skipped,0);
  assert.ok(f.fetched.every(request=>request.cache==='reload'));
});
test('a partially published or stale shell rejects installation without any cache writes',async()=>{
  const f=boot({fetch:request=>new Response(request.url.endsWith('compose.html')?'old compose':bytes['index.html'])});
  await assert.rejects(f.lifecycle('install'),/still publishing/);assert.equal(f.puts.length,0);assert.deepEqual(f.deleted,[cacheName]);
});
test('activation deletes only this scope old releases and the exact production legacy cache',async()=>{
  const other='frame:https://mattyuhz.github.io/Frame/previews/marks/:release:old';
  const f=boot({keys:[cacheName,prefix+'old','frame-v15',other,'another-app','frame-v14']});await f.lifecycle('activate');
  assert.deepEqual(f.deleted,[prefix+'old','frame-v15']);assert.equal(f.claimed,1);
  const preview=boot({scope:scope+'previews/marks/',keys:['frame-v15']});await preview.lifecycle('activate');assert.deepEqual(preview.deleted,[]);
});
test('requests outside the exact two-page shell, media ranges and mutations are untouched',()=>{
  const f=boot();for(const url of [scope+'sw.js',scope+'previews/marks/index.html',scope+'photo.png','https://other.test/Frame/index.html'])assert.equal(f.request(url),undefined,url);
  assert.equal(f.request(scope,{method:'POST'}),undefined);assert.equal(f.request(scope,{headers:{Range:'bytes=0-10'}}),undefined);
});
test('root/index/query aliases read one immutable entry and do not fetch in background',async()=>{
  const hit=new Response('known release');const f=boot({hit});assert.equal(await f.request(scope+'?launch=home'),hit);assert.equal(await f.request(scope+'index.html?x=1'),hit);assert.equal(f.fetched.length,0);
});
test('missing shell entry is verified and cache write completes before response',async()=>{
  const f=boot();assert.equal(await (await f.request()).text(),bytes['index.html']);assert.deepEqual(f.puts,[scope+'index.html']);
});
test('if an evicted old release is gone, online latest HTML is served without poisoning old cache',async()=>{
  const f=boot({fetch:()=>new Response('new release')});assert.equal(await (await f.request()).text(),'new release');assert.equal(f.puts.length,0);
});
test('both Frame and Compose must approve, while preview clients are excluded',async()=>{
  const a=client('frame'),b=client('compose',true,scope+'compose.html'),preview=client('preview',false,scope+'previews/marks/');
  const f=boot({clients:[a,b,preview]});await f.check();assert.equal(f.skipped,1);assert.equal(preview.messages.length,0);
});
test('one dirty client prevents activation without locking idle clients',async()=>{
  const a=client('frame'),b=client('compose',false,scope+'compose.html');const f=boot({clients:[a,b]});await f.check();assert.equal(f.skipped,0);assert.deepEqual(a.messages.map(item=>item.type),['FRAME_PROBE']);assert.deepEqual(b.messages.map(item=>item.type),['FRAME_PROBE']);
});
test('legacy/unresponsive pages are unsafe and never force reloaded',async()=>{
  const a=client('legacy',null);const f=boot({clients:[a]});await f.check();assert.equal(f.skipped,0);assert.equal(a.messages.at(-1).type,'FRAME_PROBE');
});
test('work starting after the probe cancels prepared peers and prevents activation',async()=>{
  const a=client('a'),b=client('b',true,scope+'compose.html',{postMessage(data,ports){if(ports)ports[0].postMessage({ready:data.type==='FRAME_PROBE'});}});
  const f=boot({clients:[a,b]});await f.check();assert.equal(f.skipped,0);assert.equal(a.messages.at(-1).type,'FRAME_CANCEL');
});
test('a new app client appearing during the handshake cancels activation',async()=>{
  const a=client('a'),b=client('b');const f=boot({list:count=>count===1?[a]:[a,b]});await f.check();assert.equal(f.skipped,0);assert.equal(a.messages.at(-1).type,'FRAME_CANCEL');
});
test('a build query closes its transferred message port so the active worker can retire',()=>{
  const f=boot(),events=[];f.buildQuery({postMessage:data=>events.push(data.build),close:()=>events.push('closed')});assert.deepEqual(events,[release.id,'closed']);
});
