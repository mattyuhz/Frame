'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../tools/pwa-update-client.js'),'utf8');
class Channel{
  constructor(){this.port1={close(){}};this.port2={close(){}};this.port1.postMessage=data=>queueMicrotask(()=>this.port2.onmessage?.({data}));this.port2.postMessage=data=>queueMicrotask(()=>this.port1.onmessage?.({data}));}
}
async function settle(){for(let i=0;i<12;i++)await Promise.resolve();}
function boot(options={}){
  const events={sw:{},window:{},document:{}},requests=[],timers=new Map();let ready=true,reloads=0,updates=0,time=100000,nextTimer=0;
  const on=target=>(type,fn)=>{(events[target][type]??=[]).push(fn);};
  const emit=(target,type,event={})=>(events[target][type]||[]).forEach(fn=>fn(event));
  const current={scriptURL:'https://example.test/Frame/sw.js',postMessage(data,ports){ports[0].postMessage({build:options.controllerBuild||'old'});}};
  const waiting={scriptURL:current.scriptURL,postMessage:data=>requests.push(data)};
  const registration={waiting:options.waiting===false?null:waiting,installing:null,addEventListener(){},update:async()=>{updates++;}};
  const document={hidden:false,activeElement:null,addEventListener:on('document')};
  const location={protocol:'https:',href:'https://example.test/Frame/',reload:()=>reloads++};
  const window={getSelection:()=>({isCollapsed:true}),addEventListener:on('window')};window.self=window;window.top=window;
  const navigator={onLine:true,serviceWorker:{controller:options.noController?null:current,addEventListener:on('sw'),register:async(url,config)=>{assert.equal(config.updateViaCache,'none');return registration;}}};
  const context={window,document,navigator,location,URL,MessageChannel:Channel,Date:{now:()=>time},setInterval:fn=>events.interval=fn,setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(source,context);context.startFrameUpdates({build:options.build||'old',safeToReload:()=>ready});
  async function prepare(build='new',token='test'){
    let answer;emit('sw','message',{source:waiting,data:{type:'FRAME_PREPARE',build,token},ports:[{postMessage:data=>answer=data,close(){}}]});await settle();return answer;
  }
  return {emit,prepare,window,document,navigator,registration,requests,timers,get reloads(){return reloads;},get updates(){return updates;},set ready(value){ready=value;},advance:ms=>time+=ms};
}
test('startup, foreground and online check updates with a one-minute network throttle',async()=>{
  const f=boot();await settle();assert.equal(f.updates,1);assert.ok(f.requests.length>0);f.emit('window','online');await settle();assert.equal(f.updates,1);f.advance(60001);f.emit('document','visibilitychange');await settle();assert.equal(f.updates,2);
});
test('first install controller claim does not reload the page',async()=>{
  const f=boot({noController:true,waiting:false});await settle();f.emit('sw','controllerchange');await settle();assert.equal(f.reloads,0);
});
test('an initially installed worker is not sent an update handshake before first control',async()=>{
  const f=boot({noController:true});await settle();assert.equal(f.requests.length,0);
});
test('dirty work or selected text refuses readiness without locking controls',async()=>{
  const f=boot();await settle();f.ready=false;assert.equal((await f.prepare()).ready,false);f.ready=true;f.window.getSelection=()=>({isCollapsed:false});assert.equal((await f.prepare()).ready,false);
});
test('a readiness probe answers without blocking input or scheduling a reload',async()=>{
  const f=boot();await settle();let ready,blocked=false;
  f.emit('sw','message',{source:{scriptURL:'https://example.test/Frame/sw.js'},data:{type:'FRAME_PROBE',build:'new',token:'probe'},ports:[{postMessage:data=>ready=data.ready,close(){}}]});
  f.emit('document','click',{cancelable:true,preventDefault(){blocked=true;},stopImmediatePropagation(){}});
  assert.equal(ready,true);assert.equal(blocked,false);f.emit('sw','controllerchange');await settle();assert.equal(f.reloads,0);
});
test('a readiness lock blocks new work, and cancellation restores input',async()=>{
  const f=boot();await settle();assert.equal((await f.prepare()).ready,true);let blocked=0;const click={cancelable:true,preventDefault(){blocked++;},stopImmediatePropagation(){}};f.emit('document','click',click);assert.equal(blocked,1);
  f.emit('sw','message',{source:{scriptURL:'https://example.test/Frame/sw.js'},data:{type:'FRAME_CANCEL',token:'test'},ports:[]});f.emit('document','click',click);assert.equal(blocked,1);
});
test('matching prepared new controller reloads once, with a fresh dirty-work check',async()=>{
  const f=boot({controllerBuild:'new'});await settle();await f.prepare();f.emit('sw','controllerchange');await settle();f.emit('sw','controllerchange');await settle();assert.equal(f.reloads,1);
  const dirty=boot({controllerBuild:'new'});await settle();await dirty.prepare();dirty.ready=false;dirty.emit('sw','controllerchange');await settle();assert.equal(dirty.reloads,0);
});
test('same-build or unprepared controller changes never reload',async()=>{
  const f=boot({build:'new',controllerBuild:'new'});await settle();await f.prepare();f.emit('sw','controllerchange');await settle();assert.equal(f.reloads,0);
  const unprepared=boot({controllerBuild:'new'});await settle();unprepared.emit('sw','controllerchange');await settle();assert.equal(unprepared.reloads,0);
});
test('an old controller cannot trigger rollback reload before waiting worker activation',async()=>{
  const f=boot({controllerBuild:'old'});await settle();await f.prepare();f.emit('sw','controllerchange');await settle();assert.equal(f.reloads,0);
});
