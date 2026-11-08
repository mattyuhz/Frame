'use strict';

// State and cancellation checks against the shipped marked-frame module.
// Real pixels and responsive layout are covered by marks-browser.cjs.
const assert = require('node:assert/strict');
const test = require('node:test');
const { boot } = require('./crop.test.cjs');

const exposure = `
  window.__marksTest = {
    markFlow, state, sceneNav, prepareScenes, buildSceneRanges, paintSceneCards,
    setSections, selectScene, setFrameUI, toggleMark, paintMarks, loadFile,
    setSeek(fn){ runSeek=fn; },
    setGoToFrame(fn){ goToFrame=fn; }
  };
`;
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function setup() {
  const revoked = [], created = [];
  class LocalURL extends URL {}
  LocalURL.createObjectURL = value => { const url='blob:mark-'+created.length;created.push({url,value});return url; };
  LocalURL.revokeObjectURL = value => revoked.push(value);
  const f=boot({exposure, globals:{URL:LocalURL}});
  f.m=f.window.__marksTest;f.flow=f.m.markFlow;
  Object.assign(f.api.state,{ready:true,fps:30,total:3600,frame:0,url:'blob:source',base:'source',marks:[]});
  f.video.duration=120;
  f.m.sceneNav.duration=120;f.m.sceneNav.items=f.m.buildSceneRanges(120,[]);
  f.seeks=[];
  f.m.setSeek(n=>{f.seeks.push(n);f.api.state.seeking=false;f.video.currentTime=(n+.5)/30;return Promise.resolve('seeked');});
  f.flow.reset();f.flow.paint();
  return {...f,revoked,created};
}

function mode(f,value) {
  const select=f.ids.get('markworkflow');select.value=value;f.dispatch(select,'change');
}
async function mark(f,frame) {
  f.m.setFrameUI(frame);f.flow.toggle();await flush();
}

test('empty marking UI stays out of the editor and one mark has a visible marked state',async()=>{
  const f=setup();
  assert.equal(f.ids.get('markedentry').hidden,true);
  assert.equal(f.ids.get('markstrip').hidden,true);
  await mark(f,300);
  assert.deepEqual(plain(f.api.state.marks),[300]);
  assert.equal(f.ids.get('bmark').getAttribute('aria-pressed'),'true');
  assert.equal(f.ids.get('markedentry').hidden,false);
  f.m.setFrameUI(301);
  assert.equal(f.ids.get('bmark').getAttribute('aria-pressed'),'false');
});

test('workflow changes preserve the same marks and save selection',async()=>{
  const f=setup();
  await mark(f,100);await mark(f,200);await mark(f,300);
  f.flow.state.selected=[100,300];
  for(const value of ['filmstrip','review','drawer']){
    mode(f,value);
    assert.equal(f.flow.state.mode,value);
    assert.deepEqual(plain(f.api.state.marks),[100,200,300]);
    assert.deepEqual(plain(f.flow.state.selected),[100,300]);
  }
});

test('mark removal and undo restore the removed source position and its selected state',async()=>{
  const f=setup();await mark(f,100);await mark(f,200);
  f.flow.state.selected=[100];f.m.setFrameUI(100);f.flow.remove(100);await flush();
  assert.deepEqual(plain(f.api.state.marks),[200]);
  assert.deepEqual(plain(f.flow.state.selected),[]);
  f.ids.get('markundo').click();await flush();
  assert.deepEqual(plain(f.api.state.marks),[100,200]);
  assert.deepEqual(plain(f.flow.state.selected),[100]);
});

test('the marked collection retains more than the previous twenty-frame comparison limit',async()=>{
  const f=setup();
  for(let i=0;i<24;i++)await mark(f,i*30);
  assert.equal(f.api.state.marks.length,24);
  assert.deepEqual(plain(f.api.state.marks),Array.from({length:24},(_,i)=>i*30));
  mode(f,'drawer');await f.flow.open();await flush();
  assert.equal(f.ids.get('markgrid').children.length,24);
});

test('closing review returns to the exact source frame and active section',async()=>{
  const f=setup();await mark(f,100);await mark(f,2000);
  f.m.sceneNav.enabled=true;f.m.sceneNav.active=1;f.m.paintSceneCards();f.m.setFrameUI(950);
  await f.flow.open();await flush();
  f.m.setFrameUI(2000);
  await f.flow.close();await flush();
  assert.equal(f.api.state.frame,950);
  assert.equal(f.m.sceneNav.active,1);
  assert.equal(f.flow.state.open,false);
});

test('source reset clears selections, review state, and cached thumbnail URLs',async()=>{
  const f=setup();await mark(f,100);await mark(f,200);
  f.flow.state.selected=[100];await f.flow.open();await flush();
  const before=f.created.map(item=>item.url);
  f.flow.reset();f.api.state.marks=[];f.flow.paint();await flush();
  assert.deepEqual(plain(f.flow.state.selected),[]);
  assert.equal(f.flow.state.open,false);
  assert.equal(f.ids.get('markedentry').hidden,true);
  assert.ok(before.every(url=>f.revoked.includes(url)), 'reset releases thumbnail object URLs');
});


test('review comparison preserves keepers outside the pair being compared',async()=>{
  const f=setup();for(const frame of [100,200,300,500])await mark(f,frame);
  f.flow.state.selected=[100,300,500];mode(f,'review');
  await f.flow.open();await f.flow.inspect(200,'review');await flush();
  await f.flow.compare();await flush();
  assert.deepEqual(plain(f.flow.state.pair),[500,200]);
  f.flow.resolvePair('current');await flush();
  assert.deepEqual(plain(f.flow.state.selected).sort((a,b)=>a-b),[100,200,300]);
});

test('review navigation follows remaining marks after removal and Skip retains the candidate',async()=>{
  const f=setup();for(const frame of [100,200,300])await mark(f,frame);
  mode(f,'review');await f.flow.open();await f.flow.inspect(200,'review');await flush();
  f.flow.remove(200);await flush();
  assert.deepEqual(plain(f.api.state.marks),[100,300]);
  await f.flow.move(-1);await flush();
  assert.equal(f.flow.state.current,100);
  f.flow.state.selected=[100];f.flow.skip();await flush();
  assert.deepEqual(plain(f.api.state.marks),[100,300]);
  assert.deepEqual(plain(f.flow.state.selected),[]);
  assert.equal(f.flow.state.current,300);
});

test('failed inspector seeks disable visual keep/skip decisions until a real frame is ready',async()=>{
  const f=setup();await mark(f,100);await mark(f,200);mode(f,'review');
  await f.flow.open();await flush();
  f.m.setSeek(()=>Promise.resolve('timeout'));
  await f.flow.inspect(100,'review');await flush();
  assert.equal(f.flow.state.frameReady,false);
  assert.equal(f.ids.get('markkeep').disabled,true);
  assert.equal(f.ids.get('markskip').disabled,true);
  f.flow.keep();assert.deepEqual(plain(f.flow.state.selected),[]);
  assert.equal(f.ids.get('markclose').disabled,false,'a failed frame never traps the review');
});

test('a late thumbnail callback cannot populate a replacement source',async()=>{
  const f=setup(),create=f.document.createElement;let finish;
  f.document.createElement=tag=>{const element=create(tag);if(tag==='canvas')element.toBlob=callback=>{finish=callback;};return element;};
  f.m.setFrameUI(100);f.flow.toggle();await flush();
  assert.equal(typeof finish,'function');
  f.flow.reset();f.api.state.url='blob:replacement';f.api.state.frame=0;
  finish(new Blob(['old thumbnail'],{type:'image/jpeg'}));await flush();
  assert.deepEqual(plain(f.flow.state.thumbs),{});
  assert.deepEqual(plain(f.api.state.marks),[]);
  assert.equal(f.created.length,0,'stale callback does not allocate a new object URL');
});

test('a stale presented-frame callback cannot finish a new seek before decoder readiness',async()=>{
  const f=boot();let presented,settled=false;
  f.video.seeking=true;f.video.readyState=1;
  f.video.requestVideoFrameCallback=callback=>{presented=callback;};
  const seeking=f.api.runSeek(30).then(result=>{settled=true;return result;});
  presented(0,{mediaTime:0});await flush();
  assert.equal(settled,false,'an old compositor callback is ignored while the new seek is active');
  assert.equal(f.api.state.seeking,true);
  f.video.seeking=false;f.video.readyState=4;f.dispatch(f.video,'seeked');
  [...f.timers.values()].at(-1)();
  assert.equal(await seeking,'seeked');
  assert.equal(f.api.state.seeking,false);
});

test('a seek that never becomes ready still times out and ignores a late presentation callback',async()=>{
  const f=boot(),before=new Set(f.timers.keys());let presented,cancelled=[];
  f.video.seeking=true;f.video.readyState=1;
  f.video.requestVideoFrameCallback=callback=>{presented=callback;return 42;};
  f.video.cancelVideoFrameCallback=id=>cancelled.push(id);
  const seeking=f.api.runSeek(30);presented();await flush();
  const timer=[...f.timers].find(([id])=>!before.has(id));assert.ok(timer);
  timer[1]();assert.equal(await seeking,'timeout');
  assert.equal(f.api.state.seeking,false);assert.deepEqual(cancelled,[42]);
  f.video.seeking=false;f.video.readyState=4;presented();await flush();
  assert.equal(f.api.state.seeking,false);
});
