'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { boot } = require('./crop.test.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for(let i=0;i<20;i++)await Promise.resolve(); };

function setup(frames=[30,120,240,360]) {
  let url=0;
  class LocalURL extends URL {}
  LocalURL.createObjectURL=()=> 'blob:thumb-'+(++url);
  LocalURL.revokeObjectURL=()=>{};
  const f=boot({globals:{URL:LocalURL},exposure:`window.mobileMarks={markFlow,state,sceneNav,setFrameUI,
    setSeek(fn){runSeek=fn;},setListSave(fn){saveFrameList=fn;}};`});
  f.x=f.window.mobileMarks;f.flow=f.x.markFlow;
  Object.assign(f.api.state,{ready:true,fps:30,total:900,frame:0,url:'blob:source',marks:frames.slice()});
  f.x.setSeek(n=>{f.api.state.seeking=false;f.video.seeking=false;f.video.currentTime=(n+.5)/30;return Promise.resolve('seeked');});
  f.flow.paint();return f;
}
async function start(f,keeper=120,candidate=30) {
  await f.flow.open();await f.flow.inspect(keeper);f.flow.pin();await f.flow.inspect(candidate);await f.flow.compare();await flush();
}

test('board opens a marked-only grid and hides the decoder after previews are available',async()=>{
  const f=setup();assert.equal(f.flow.state.mode,'board');await f.flow.open();
  assert.equal(f.flow.state.view,'grid');assert.equal(f.ids.get('markgrid').children.length,4);
  assert.equal(f.ids.get('markviewer').hidden,true);
  assert.equal(f.ids.get('markfilters').hidden,true);
  f.flow.select(120);f.flow.setFilter('selected');
  assert.equal(f.ids.get('markgrid').children.length,1);
  assert.equal(f.ids.get('markfilterselected').getAttribute('aria-pressed'),'true');
  f.flow.select(120);
  assert.equal(f.flow.state.filter,'all');assert.equal(f.ids.get('markgrid').children.length,4);
});

test('pinning a keeper does not select or discard any candidate',async()=>{
  const f=setup();f.flow.state.selected=[30,360];await f.flow.open();await f.flow.inspect(120);f.flow.pin();
  assert.equal(f.flow.state.keeper,120);assert.deepEqual(plain(f.flow.state.selected),[30,360]);
  assert.deepEqual(plain(f.api.state.marks),[30,120,240,360]);
  f.flow.pin();assert.equal(f.flow.state.keeper,null);await f.flow.undo();assert.equal(f.flow.state.keeper,120);
});

test('Promote B uses the challenger while A is displayed, then Undo restores both identities and zoom',async()=>{
  const f=setup();f.flow.state.selected=[30,360];await start(f);
  assert.deepEqual(plain(f.flow.state.pair),[120,30]);await f.flow.decide('a');
  assert.deepEqual(plain(f.flow.state.pair),[120,240]);await f.flow.showSide('a');
  f.flow.state.zoom={z:2,x:20,y:15};f.flow.layout();const zoom=plain(f.flow.state.zoom);
  await f.flow.decide('b');
  assert.equal(f.flow.state.keeper,240);assert.deepEqual(plain(f.flow.state.pair),[240,360]);
  await f.flow.undo();
  assert.equal(f.flow.state.keeper,120);assert.deepEqual(plain(f.flow.state.pair),[120,240]);
  assert.equal(f.flow.state.current,120);assert.equal(f.flow.state.candidateAt,1);
  assert.deepEqual(plain(f.flow.state.zoom),zoom);
  assert.deepEqual(plain(f.flow.state.selected),[30,360]);
  assert.deepEqual(plain(f.api.state.marks),[30,120,240,360]);
});

test('candidate progression stops without wrapping and Next leaves the keeper unchanged',async()=>{
  const f=setup();await start(f);await f.flow.nextCandidate();
  assert.equal(f.flow.state.keeper,120);assert.deepEqual(plain(f.flow.state.pair),[120,240]);
  await f.flow.decide('b');await f.flow.decide('a');
  assert.equal(f.flow.state.view,'inspect');assert.equal(f.flow.state.current,240);assert.equal(f.flow.state.keeper,240);
  assert.match(f.flow.state.message,/End of candidates/);
  assert.deepEqual(plain(f.api.state.marks),[30,120,240,360]);
  await f.flow.undo();assert.equal(f.flow.state.view,'compare');assert.deepEqual(plain(f.flow.state.pair),[240,360]);
});

test('two selected frames form an optional pair without starting a tournament over other marks',async()=>{
  const f=setup();f.flow.state.selected=[30,240];await f.flow.open();await f.flow.compare();
  assert.deepEqual(plain(f.flow.state.pair),[30,240]);assert.deepEqual(plain(f.flow.state.candidates),[240]);
  await f.flow.decide('b');
  assert.equal(f.flow.state.keeper,240);assert.equal(f.flow.state.view,'inspect');
  assert.deepEqual(plain(f.flow.state.selected),[30,240]);assert.equal(f.api.state.marks.length,4);
});

test('failed candidate decoding cannot become a valid Promote B just by displaying A',async()=>{
  const f=setup();await f.flow.open();await f.flow.inspect(120);f.flow.pin();await f.flow.inspect(30);
  f.x.setSeek(n=>{f.api.state.seeking=false;return Promise.resolve(n===30?'timeout':'seeked');});
  await f.flow.compare();assert.equal(f.flow.state.candidateReady,false);
  await f.flow.showSide('a');assert.equal(f.flow.state.frameReady,true);
  assert.equal(f.ids.get('markacceptb').disabled,true);assert.equal(f.ids.get('markaccepta').disabled,true);
  await f.flow.decide('b');assert.equal(f.flow.state.keeper,120);assert.equal(f.flow.state.candidateAt,0);
  await f.flow.nextCandidate();assert.equal(f.flow.state.candidateAt,1,'failed candidates can be skipped');
});

test('removing the keeper unpins it and undo restores keeper plus save-selection membership',async()=>{
  const f=setup();await f.flow.open();await f.flow.inspect(120);f.flow.pin();f.flow.select(120);
  f.flow.remove(120);await flush();assert.equal(f.flow.state.keeper,null);
  await f.flow.undo();assert.equal(f.flow.state.keeper,120);assert.deepEqual(plain(f.flow.state.selected),[120]);
  assert.deepEqual(plain(f.api.state.marks),[30,120,240,360]);
});

test('Save keeper exports the pinned source frame while preserving the displayed candidate and selection',async()=>{
  const f=setup();f.flow.state.selected=[30,360];await start(f);let received;
  f.x.setListSave((frames,options)=>{received={frames:plain(frames),restoreFrame:options.restoreFrame,visible:!f.ids.get('markviewer').hidden};options.onBusy(true);options.onBusy(false);return Promise.resolve({status:'downloaded',count:1});});
  const result=await f.flow.saveKeeper();assert.equal(result.count,1);
  assert.deepEqual(received,{frames:[120],restoreFrame:30,visible:true});
  assert.equal(f.flow.state.current,30);assert.deepEqual(plain(f.flow.state.selected),[30,360]);
  assert.equal(f.flow.state.open,true);assert.equal(f.flow.state.busy,false);
});

test('returning to the board preserves scroll and does not clamp comparison pan against a hidden viewer',async()=>{
  const f=setup();await f.flow.open();f.ids.get('markreviewbody').scrollTop=500;await f.flow.inspect(120);f.flow.pin();
  f.flow.state.zoom={z:3,x:80,y:50};f.flow.layout();const zoom=plain(f.flow.state.zoom);
  await f.flow.back();assert.equal(f.ids.get('markreviewbody').scrollTop,500);
  assert.equal(f.ids.get('markviewer').hidden,true);f.flow.layout();assert.deepEqual(plain(f.flow.state.zoom),zoom);
});

test('pinching or accumulating a drag never triggers the tap-to-flip action',async()=>{
  const f=setup();await start(f);const viewer=f.ids.get('markviewer'),before=f.flow.state.current;
  for(const [type,id,x,y] of [['pointerdown',1,100,100],['pointerdown',2,200,100],['pointermove',2,230,100],['pointerup',2,230,100],['pointerup',1,100,100]])f.dispatch(viewer,type,{pointerId:id,clientX:x,clientY:y});
  await flush();assert.equal(f.flow.state.current,before);
  f.dispatch(viewer,'pointerdown',{pointerId:3,clientX:100,clientY:100});
  for(let x=101;x<=110;x++)f.dispatch(viewer,'pointermove',{pointerId:3,clientX:x,clientY:100});
  f.dispatch(viewer,'pointerup',{pointerId:3,clientX:110,clientY:100});await flush();
  assert.equal(f.flow.state.current,before);
});

test('source replacement clears keeper, queue, filters and undo and rejects a late comparison result',async()=>{
  const f=setup();await start(f);let resolve;
  f.x.setSeek(()=>new Promise(done=>{resolve=done;}));
  const pending=f.flow.decide('b');f.flow.reset();f.api.state.url='blob:new';resolve('seeked');await pending;
  assert.equal(f.flow.state.keeper,null);assert.deepEqual(plain(f.flow.state.candidates),[]);
  assert.equal(f.flow.state.filter,'all');assert.equal(f.flow.state.undo,null);assert.equal(f.flow.state.message,'');assert.equal(f.flow.state.open,false);
});

test('opening a selected pair keeps an unrelated pinned keeper until an explicit decision',async()=>{
  const f=setup();await f.flow.open();await f.flow.inspect(120);f.flow.pin();await f.flow.back();
  f.flow.state.selected=[30,240];await f.flow.compare();
  assert.equal(f.flow.state.keeper,120);assert.deepEqual(plain(f.flow.state.pair),[30,240]);
  assert.equal(f.ids.get('markshowa').textContent,'A · Candidate');assert.equal(f.ids.get('marksavekeeper').hidden,true);
  await f.flow.back();assert.equal(f.flow.state.keeper,120);
  await f.flow.compare();await f.flow.decide('b');assert.equal(f.flow.state.keeper,240);
  await f.flow.undo();assert.equal(f.flow.state.keeper,120);assert.deepEqual(plain(f.flow.state.pair),[30,240]);
});

test('a selected pair keeps an existing keeper as A regardless of selection order',async()=>{
  const f=setup();await f.flow.open();await f.flow.inspect(120);f.flow.pin();await f.flow.back();
  f.flow.state.selected=[240,120];await f.flow.compare();
  assert.deepEqual(plain(f.flow.state.pair),[120,240]);assert.equal(f.ids.get('markshowa').textContent,'A · Keeper');
  assert.equal(f.ids.get('marksavekeeper').hidden,false);
});

test('skipping a provisional pair without a keeper returns to the board without pinning anything',async()=>{
  const f=setup();f.flow.state.selected=[30,240];await f.flow.open();await f.flow.compare();await f.flow.nextCandidate();
  assert.equal(f.flow.state.keeper,null);assert.equal(f.flow.state.view,'grid');assert.deepEqual(plain(f.flow.state.pair),[]);
  await f.flow.undo();assert.equal(f.flow.state.view,'compare');assert.deepEqual(plain(f.flow.state.pair),[30,240]);
});

test('interrupting thumbnail generation clears progress and scroll hides its temporary decoder',async()=>{
  const f=setup();await f.flow.open();f.flow.queueThumbs();
  assert.equal(f.flow.state.queueRunning,true);assert.equal(f.ids.get('markviewer').hidden,false);
  const card=f.ids.get('markgrid').children[0];f.dispatch(f.document,'pointerdown',{pointerId:1,clientX:10,clientY:10});
  assert.equal(f.flow.state.queueRunning,false);assert.equal(f.flow.state.message,'');
  assert.equal(f.ids.get('markgrid').children[0],card,'a pointerdown does not replace the tapped button');
  f.ids.get('markreviewbody').scrollTop=10;f.dispatch(f.ids.get('markreviewbody'),'scroll');
  assert.equal(f.ids.get('markviewer').hidden,true);await flush();assert.equal(f.flow.state.queueRunning,false);
});

 test('marking the same source frame twice preserves the mark and reports Already marked',async()=>{const f=setup();f.api.state.frame=30;const before=plain(f.api.state.marks);f.flow.toggle();assert.deepEqual(plain(f.api.state.marks),before);assert.match(f.ids.get('savetoast').textContent,/Already marked/);});
