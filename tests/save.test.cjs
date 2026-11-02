'use strict';

// Exercise the shipped Save pipeline with local media/share substitutes.
const assert = require('node:assert/strict');
const test = require('node:test');
const { boot } = require('./crop.test.cjs');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(overrides = {}) {
  const shares = [], downloads = [], captures = [];
  const fixture = boot({ navigator: {
    canShare: () => true,
    share: data => { shares.push(data); return Promise.resolve(); },
    ...overrides
  } });
  fixture.api.state.base = 'clip';
  fixture.api.state.frame = 42;
  fixture.api.state.url = 'blob:source';
  fixture.api.stubExport({
    currentBlob: snapshot => { captures.push(snapshot); return Promise.resolve(new Blob(['pixels'], { type: 'image/png' })); },
    verifyImage: () => Promise.resolve({ w: 1920, h: 1080 }),
    downloadBlob: (blob, name) => downloads.push({ blob, name })
  });
  return { ...fixture, shares, downloads, captures,
    toast: () => fixture.ids.get('savetoasttext').textContent };
}

test('Save shares a verified file directly, with no in-app save sheet', async () => {
  const f = setup();
  await f.api.saveCurrent();
  assert.equal(f.shares.length, 1);
  assert.equal(f.shares[0].files[0].name, 'clip_00-00-01-12.png');
  assert.equal(f.shares[0].files[0].type, 'image/png');
  assert.equal(f.downloads.length, 0);
  assert.equal(f.ids.has('sheet'), false);
  assert.equal(f.toast(), 'Shared');
  assert.equal(f.api.saving, false);
  assert.equal(f.ids.get('bsave').disabled, false);
});

test('Save freezes crop, rotation, metadata and filename while capture is asynchronous', async () => {
  const f = setup(), capture = deferred();
  f.api.setCropToRect({ sx: 100, sy: 200, w: 800, h: 600 });
  f.api.state.rot = 90;
  f.api.state.meta = { model: 'Camera at capture' };
  f.api.state.metaCount = 1;
  let snapshot;
  f.api.stubExport({
    currentBlob: options => { snapshot = options; return capture.promise; },
    verifyImage: () => Promise.resolve({ w: 600, h: 800 })
  });
  // A fixed ratio is interpreted in output space, so hold the source crop.
  f.api.setCropToRect({ sx: 100, sy: 200, w: 800, h: 600 });
  const saving = f.api.saveCurrent();
  await Promise.resolve();
  f.api.state.frame = 70;
  f.api.state.base = 'renamed';
  f.api.state.rot = 0;
  f.api.state.meta = { model: 'Later camera' };
  f.api.state.crop.scale = 1;
  capture.resolve(new Blob(['pixels'], { type: 'image/png' }));
  await saving;
  assert.equal(snapshot.rot, 90);
  assert.equal(snapshot.crop.w, 800);
  assert.equal(snapshot.crop.h, 600);
  assert.equal(snapshot.meta.model, 'Camera at capture');
  assert.equal(f.shares[0].files[0].name, 'clip_00-00-01-12.png');
  assert.equal(f.toast(), 'Shared');
});

test('unsupported file sharing downloads once and reports only that the download started', async () => {
  const f = setup({ canShare: () => false });
  await f.api.saveCurrent();
  assert.equal(f.downloads.length, 1);
  assert.equal(f.shares.length, 0);
  assert.equal(f.toast(), 'Download started');
  assert.equal(f.api.preparedSave, null);
});

test('cancelling the native menu is silent and never downloads instead', async () => {
  const f = setup({ share: () => Promise.reject({ name: 'AbortError' }) });
  await f.api.saveCurrent();
  assert.equal(f.toast(), '');
  assert.equal(f.downloads.length, 0);
  assert.equal(f.api.saving, false);
  assert.equal(f.api.preparedSave, null);
});

test('expired user activation offers one fresh-gesture retry using the existing verified file', async () => {
  const activation = { isActive: false }, f = setup({ userActivation: activation });
  await f.api.saveCurrent();
  const prepared = f.api.preparedSave;
  assert.ok(prepared);
  assert.equal(f.shares.length, 0);
  assert.equal(f.toast(), 'Ready to save');
  assert.equal(f.ids.get('bsavemenu').hidden, false);
  activation.isActive = true;
  f.dispatch(f.ids.get('bsavemenu'), 'click');
  assert.equal(f.shares.length, 1, 'share starts synchronously in the button event');
  assert.equal(f.shares[0].files[0], prepared.file);
  await Promise.resolve();
  assert.equal(f.captures.length, 1, 'retry does not recapture a different frame');
  assert.equal(f.toast(), 'Shared');
});

test('NotAllowedError retains the file for a retry without triggering a download', async () => {
  let attempts = 0;
  const f = setup({ share: () => {
    attempts++;
    return attempts === 1 ? Promise.reject({ name: 'NotAllowedError' }) : Promise.resolve();
  } });
  await f.api.saveCurrent();
  assert.equal(f.toast(), 'Ready to save');
  assert.equal(f.downloads.length, 0);
  await f.api.sharePrepared(f.api.preparedSave);
  assert.equal(attempts, 2);
  assert.equal(f.captures.length, 1);
  assert.equal(f.toast(), 'Shared');
});

test('duplicate Save taps cannot start a second capture or overlapping system share', async () => {
  const sharing = deferred();
  let count = 0;
  const f = setup({ share: () => { count++; return sharing.promise; } });
  const first = f.api.saveCurrent();
  await f.api.saveCurrent();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(f.captures.length, 1);
  assert.equal(count, 1);
  assert.equal(f.api.saving, true);
  await f.api.saveCurrent();
  assert.equal(f.captures.length, 1);
  sharing.resolve();
  await first;
  assert.equal(f.api.saving, false);
});

test('a queued seek finishes before capture and a timed-out seek never exports stale pixels', async () => {
  const f = setup(), seek = deferred();
  f.api.state.seeking = true;
  f.api.stubExport({ goToFrame: frame => {
    assert.equal(frame, 42);
    return seek.promise;
  } });
  const saving = f.api.saveCurrent();
  assert.equal(f.captures.length, 0);
  f.api.state.seeking = false;
  seek.resolve('seeked');
  await saving;
  assert.equal(f.captures.length, 1);
  const failed = setup();
  failed.api.state.seeking = true;
  failed.api.stubExport({ goToFrame: () => { failed.api.state.seeking = false; return Promise.resolve('timeout'); } });
  await failed.api.saveCurrent();
  assert.equal(failed.captures.length, 0);
  assert.equal(failed.shares.length, 0);
  assert.match(failed.toast(), /not ready/);
  assert.equal(failed.api.saving, false);
});

test('failed capture or dimension verification blocks sharing and restores Save', async () => {
  for (const failure of ['capture', 'decode', 'dimensions']) {
    const f = setup();
    f.api.stubExport(failure === 'capture' ? { currentBlob: () => Promise.resolve(null) } :
      { verifyImage: () => Promise.resolve(failure === 'decode' ? null : { w: 100, h: 100 }) });
    await f.api.saveCurrent();
    assert.equal(f.shares.length, 0, failure);
    assert.equal(f.downloads.length, 0, failure);
    assert.equal(f.api.saving, false, failure);
    assert.match(f.toast(), /Could not/);
  }
});

test('unexpected native share failures report failure without a false saved message', async () => {
  const f = setup({ share: () => { throw { name: 'DataError' }; } });
  await f.api.saveCurrent();
  assert.equal(f.downloads.length, 0);
  assert.equal(f.toast(), 'Could not share. Please try again.');
  assert.equal(f.api.saving, false);
});

test('marked-frame saving calls the real encoder without passing a seek status as its snapshot', async () => {
  const f = boot(), downloads = [];
  f.api.state.marks = [12, 3];
  f.api.state.base = 'batch';
  f.api.setCropToRect({ sx: 100, sy: 150, w: 800, h: 600 });
  f.api.stubExport({
    goToFrame: frame => { f.api.state.frame = frame; return Promise.resolve('seeked'); },
    downloadBlob: (blob, name) => downloads.push({ blob, name })
  });
  f.api.saveAllMarks();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(downloads.length, 1, 'first marked frame is encoded');
  for (const [id, callback] of [...f.timers]) {
    f.timers.delete(id);
    callback();
  }
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(downloads.length, 2, 'next marked frame is encoded');
  assert.deepEqual(downloads.map(item => item.name), ['batch_00-00-00-03.png', 'batch_00-00-00-12.png']);
  for (const { blob } of downloads) {
    assert.equal(blob.width, 800);
    assert.equal(blob.height, 600);
    assert.equal(blob.canvas.getContext().calls.filter(call => call.name === 'drawImage').length, 1);
  }
});

test('a decoder assignment failure is explicit and Save cannot export the previous frame', async () => {
  const f = setup();
  f.api.state.total = 100;
  Object.defineProperty(f.video, 'currentTime', {
    get: () => 1,
    set: () => { throw new Error('Decoder unavailable'); }
  });
  assert.equal(await f.api.runSeek(42), 'failed');
  f.api.state.seeking = true;
  await f.api.saveCurrent();
  assert.equal(f.captures.length, 0);
  assert.equal(f.shares.length, 0);
  assert.equal(f.api.saving, false);
  assert.match(f.toast(), /not ready/);
});

test('superseded seeks are explicit and Save accepts only confirmed frame readiness', async () => {
  const f = boot();
  f.api.state.total = 100;
  const first = f.api.runSeek(3), second = f.api.runSeek(4);
  const oldTimers = new Set(f.timers.keys());
  f.dispatch(f.video, 'seeked');
  for (const [id, callback] of [...f.timers]) {
    if (!oldTimers.has(id)) { f.timers.delete(id); callback(); }
  }
  assert.equal(await first, 'superseded');
  assert.equal(await second, 'seeked');
  for (const status of ['failed', 'superseded', undefined]) {
    const failed = setup();
    failed.api.state.seeking = true;
    failed.api.stubExport({ goToFrame: () => {
      failed.api.state.seeking = false;
      return Promise.resolve(status);
    } });
    await failed.api.saveCurrent();
    assert.equal(failed.captures.length, 0, String(status));
    assert.equal(failed.shares.length, 0, String(status));
    assert.match(failed.toast(), /not ready/);
  }
});
