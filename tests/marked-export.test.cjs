'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { boot } = require('./crop.test.cjs');

function setup(navigator = {}) {
  const shares = [], downloads = [], captures = [], events = [];
  const f = boot({ navigator: {
    canShare: () => true,
    share: data => { shares.push(data); return Promise.resolve(); },
    ...navigator
  }, exposure: `window.__markedExport={saveFrameList,sceneNav,setFrameUI,
    invalidate(){saveToken++;preparedSave=null;finishSave();}};` });
  Object.assign(f.api.state, { base: 'marked', frame: 42, total: 3000, fps: 30, url: 'blob:source', marks: [12, 3] });
  f.export = f.window.__markedExport;
  Object.assign(f.export.sceneNav, { enabled: true, active: 1, items: [{ start: 0, end: 1, kind: 'Section' }, { start: 1, end: 100, kind: 'Section' }] });
  f.api.stubExport({
    goToFrame: frame => { events.push(['seek', frame]); f.api.state.frame = frame; f.api.state.seeking = false; return Promise.resolve('seeked'); },
    currentBlob: snapshot => { events.push(['capture', f.api.state.frame]); captures.push(snapshot); return Promise.resolve(new Blob(['pixels'], { type: 'image/png' })); },
    verifyImage: () => { events.push(['verify', f.api.state.frame]); return Promise.resolve({ w: 1920, h: 1080 }); },
    downloadBlob: (blob, name) => { events.push(['download', name]); downloads.push({ blob, name }); }
  });
  return Object.assign(f, { shares, downloads, captures, events, toast: () => f.ids.get('savetoasttext').textContent });
}

test('selected exports verify all files, deduplicate source frames and restore review context before sharing', async () => {
  const f = setup(), busy = [], progress = [];
  f.ids.get('cmp').className = 'sheet on';
  const result = await f.export.saveFrameList([12, 3, 12, -1, 3000, NaN], {
    onBusy: value => busy.push(value), onProgress: value => progress.push(value)
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 'shared', count: 2, total: 2 });
  assert.equal(f.captures.length, 2);
  assert.equal(f.events.filter(e => e[0] === 'verify').length, 2);
  assert.deepEqual(Array.from(f.shares[0].files, file => file.name), ['marked_00-00-00-03.png', 'marked_00-00-00-12.png']);
  assert.equal(f.api.state.frame, 42);
  assert.equal(f.export.sceneNav.active, 1);
  assert.equal(f.ids.get('cmp').className, 'sheet on');
  assert.equal(f.api.saving, false);
  assert.equal(busy[0], true);assert.equal(busy.at(-1), false);
  assert.deepEqual(progress, ['Preparing 1 of 2', 'Preparing 2 of 2']);
  assert.deepEqual([...f.api.state.marks], [12, 3], 'export does not clear candidates');
});

test('download fallback verifies and releases one image before capturing the next', async () => {
  const f = setup({ canShare: () => false });
  const result = await f.export.saveFrameList([3, 12, 21]);
  assert.equal(result.status, 'downloaded');assert.equal(result.count, 3);
  assert.equal(f.shares.length, 0);assert.equal(f.downloads.length, 3);
  assert.deepEqual(f.events.slice(0, 8).map(e => e[0]), ['seek', 'capture', 'verify', 'download', 'seek', 'capture', 'verify', 'download']);
  assert.equal(f.api.state.frame, 42);
  assert.equal(f.toast(), 'Downloads started for 3 frames.');
});

test('batch export freezes crop, rotation, metadata and names for the entire selected set', async () => {
  const f = setup();
  f.api.setCropToRect({ sx: 100, sy: 200, w: 800, h: 600 });
  f.api.state.rot = 90;
  f.api.setCropToRect({ sx: 100, sy: 200, w: 800, h: 600 });
  f.api.state.meta = { model: 'Capture camera' };f.api.state.metaCount = 1;
  const snapshots = [];
  f.api.stubExport({
    currentBlob: snapshot => {
      snapshots.push(snapshot);f.api.state.base = 'changed';f.api.state.rot = 0;f.api.state.meta = {};
      return Promise.resolve(new Blob(['pixels'], { type: 'image/png' }));
    },
    verifyImage: () => Promise.resolve({ w: 600, h: 800 })
  });
  await f.export.saveFrameList([3, 12]);
  assert.equal(snapshots.length, 2);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.rot, 90);assert.equal(snapshot.crop.w, 800);assert.equal(snapshot.crop.h, 600);
    assert.equal(snapshot.meta.model, 'Capture camera');
  }
  assert.deepEqual(Array.from(f.shares[0].files, file => file.name), ['marked_00-00-00-03.png', 'marked_00-00-00-12.png']);
});

test('failed, timed-out and superseded seeks cannot export stale marked pixels', async () => {
  for (const status of ['failed', 'timeout', 'superseded', undefined]) {
    const f = setup();
    f.api.stubExport({ goToFrame: frame => { f.api.state.frame = frame; return Promise.resolve(frame === 42 ? 'seeked' : status); } });
    const result = await f.export.saveFrameList([3]);
    assert.equal(result.status, 'error', String(status));
    assert.equal(f.captures.length, 0);assert.equal(f.shares.length, 0);assert.equal(f.downloads.length, 0);
    assert.equal(f.api.state.frame, 42);assert.equal(f.api.saving, false);
    assert.match(f.toast(), /not ready/);
  }
});

test('partial download failures report only exports actually started', async () => {
  const f = setup({ canShare: () => false });
  let verified = 0;
  f.api.stubExport({ verifyImage: () => Promise.resolve(++verified === 1 ? { w: 1920, h: 1080 } : { w: 100, h: 100 }) });
  const result = await f.export.saveFrameList([3, 12]);
  assert.equal(result.status, 'error');assert.equal(result.count, 1);
  assert.equal(f.downloads.length, 1);assert.equal(f.api.state.frame, 42);
  assert.match(f.toast(), /^Started 1 of 2 exports\. Could not verify/);
});

test('native batches retain all selected frames and require explicit continuation after eight', async () => {
  const f = setup(), frames = Array.from({ length: 10 }, (_, i) => i * 3);
  const first = await f.export.saveFrameList(frames);
  assert.equal(first.status, 'prepared');assert.equal(first.count, 8);assert.equal(first.total, 10);
  assert.equal(f.shares.length, 1);assert.equal(f.shares[0].files.length, 8);
  assert.equal(f.captures.length, 8);
  assert.equal(f.ids.get('bsavemenu').textContent, 'Save next batch');
  assert.equal(f.api.state.frame, 42);assert.equal(f.api.saving, false);
  const continuation = f.api.preparedSave;
  const last = await f.api.sharePrepared(continuation);
  assert.equal(last.status, 'shared');assert.equal(last.count, 10);
  assert.equal(f.shares.length, 2);assert.equal(f.shares[1].files.length, 2);
  const names = f.shares.flatMap(share => share.files.map(file => file.name));
  assert.equal(new Set(names).size, 10);assert.equal(f.captures.length, 10);
  assert.equal(f.api.preparedSave, null);assert.equal(f.toast(), 'Shared 10 frames.');
});

test('large native images split batches without omitting the overflow image', async () => {
  const f = setup();
  f.api.stubExport({ currentBlob: () => {
    const blob = new Blob(['pixels'], { type: 'image/png' });
    Object.defineProperty(blob, 'size', { value: 40 * 1024 * 1024 });
    return Promise.resolve(blob);
  } });
  let result = await f.export.saveFrameList([3, 12, 21]);
  assert.equal(result.status, 'prepared');assert.equal(result.count, 1);
  while (f.api.preparedSave) result = await f.api.sharePrepared(f.api.preparedSave);
  assert.equal(result.status, 'shared');assert.equal(result.count, 3);
  assert.deepEqual(f.shares.map(share => share.files.length), [1, 1, 1]);
  assert.equal(new Set(f.shares.flatMap(share => share.files.map(file => file.name))).size, 3);
});

test('native continuation restores the current editor context after review closes or moves', async () => {
  const f = setup();
  await f.export.saveFrameList(Array.from({ length: 9 }, (_, i) => i * 3));
  assert.equal(f.api.state.frame, 42);assert.equal(f.export.sceneNav.active, 1);
  const continuation = f.api.preparedSave;
  f.ids.get('cmp').className = 'sheet';
  f.export.sceneNav.active = 0;f.export.setFrameUI(12);
  const result = await f.api.sharePrepared(continuation);
  assert.equal(result.status, 'shared');assert.equal(result.count, 9);
  assert.equal(f.api.state.frame, 12);
  assert.equal(f.export.sceneNav.active, 0);
  assert.equal(f.ids.get('cmp').className, 'sheet', 'continuation does not reopen review');
});

test('expired activation retries the already verified batch without recapturing', async () => {
  const activation = { isActive: false }, f = setup({ userActivation: activation });
  const result = await f.export.saveFrameList([3, 12]);
  assert.equal(result.status, 'prepared');assert.equal(result.count, 0);
  assert.equal(f.captures.length, 2);assert.equal(f.shares.length, 0);
  activation.isActive = true;
  await f.api.sharePrepared(f.api.preparedSave);
  assert.equal(f.captures.length, 2);assert.equal(f.shares.length, 1);
  assert.equal(f.toast(), 'Shared 2 frames.');
});

test('source replacement invalidates capture and prepared native continuation', async () => {
  const f = setup();let finish;
  f.api.stubExport({ currentBlob: () => new Promise(resolve => { finish = resolve; }) });
  const pending = f.export.saveFrameList([3]);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  f.export.invalidate();f.api.state.url = 'blob:new-source';
  finish(new Blob(['old pixels'], { type: 'image/png' }));
  const result = await pending;
  assert.equal(result.status, 'stale');assert.equal(f.shares.length, 0);assert.equal(f.downloads.length, 0);
  const g = setup();await g.export.saveFrameList(Array.from({ length: 9 }, (_, i) => i));
  const continuation = g.api.preparedSave, captures = g.captures.length;
  g.export.invalidate();g.api.state.url = 'blob:replacement';
  await g.api.sharePrepared(continuation);
  assert.equal(g.captures.length, captures);assert.equal(g.shares.length, 1);
});

test('cancelled batch sharing stays silent and does not download or queue another batch', async () => {
  const f = setup({ share: () => Promise.reject({ name: 'AbortError' }) });
  const result = await f.export.saveFrameList([3, 12]);
  assert.equal(result.status, 'cancelled');assert.equal(result.count, 0);
  assert.equal(f.downloads.length, 0);assert.equal(f.api.preparedSave, null);
  assert.equal(f.toast(), '');assert.equal(f.api.saving, false);assert.equal(f.api.state.frame, 42);
});

test('a rejected multi-file share fallback counts only successful download requests', async () => {
  const f = setup({ canShare: data => data.files.length === 1 });let requested = 0;
  f.api.stubExport({ downloadBlob: () => { if (++requested === 2) throw new Error('Download blocked'); } });
  const result = await f.export.saveFrameList([3, 12]);
  assert.equal(result.status, 'error');assert.equal(result.count, 1);
  assert.equal(f.api.preparedSave, null);assert.equal(f.api.saving, false);
  assert.match(f.toast(), /^Started 1 downloads\./);
});
