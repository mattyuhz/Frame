'use strict';

// Exercise the shipped import/history integration with controlled storage and
// media completion. IndexedDB byte persistence is covered by history-store.
const assert = require('node:assert/strict');
const test = require('node:test');
const { File } = require('node:buffer');
const { boot } = require('./crop.test.cjs');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const clip = name => new File(['local video bytes'], name, { type: 'video/mp4', lastModified: 123 });
const plain = value => JSON.parse(JSON.stringify(value));

function setup(overrides = {}) {
  const saved = [], updates = [], removed = [];
  const entries = new Map();
  const store = {
    supported: true, limit: 8000000000,
    list: () => Promise.resolve([...entries.values()].map(plain)),
    save: (file, metadata) => {
      saved.push({ file, metadata });
      return Promise.resolve({ ...metadata, id: 'saved-' + saved.length, name: file.name, size: file.size });
    },
    open: () => Promise.reject({ code: 'missing' }),
    remove: id => { removed.push(id); entries.delete(id); return Promise.resolve(); },
    updateSession: (id, session) => {
      if (!entries.has(id)) return Promise.reject({ code: 'missing' });
      updates.push({ id, session: plain(session) });
      entries.get(id).session = plain(session);
      return Promise.resolve();
    },
    ...overrides
  };
  const save = store.save;
  store.save = (file, metadata, progress) => Promise.resolve(save(file, metadata, progress)).then(entry => {
    const completed = { name: file.name, size: file.size, ...metadata, ...entry };
    entries.set(completed.id, plain(completed));
    return completed;
  });
  const fixture = boot({ exposure: `
    var originalHistoryDetectFps=detectFps;
    window.__historyTest={
      loadFile:loadFile, open:openHistoryVideo, remove:removeHistoryVideo,
      remember:historyRemember, cache:cacheHistoryVideo, refresh:refreshHistory,
      sessionKey:function(id){return historySessionKey(id);},
      get context(){return historyContext;}, get token(){return loadToken;},
      detect:function(token){return originalHistoryDetectFps(token);},
      stub:function(stubs){
        if(stubs.store)videoHistoryStore=stubs.store;
        if(stubs.metadata)readVideoMetadata=stubs.metadata;
        if(stubs.fps)detectFps=stubs.fps;
        testCanvas=function(){return 'working';};
        goToFrame=function(n){setFrameUI(n);return Promise.resolve('seeked');};
      }
    };
  ` });
  const journal = new Map();
  fixture.window.localStorage = {
    get length() { return journal.size; },
    key: index => [...journal.keys()][index] ?? null,
    getItem: key => journal.has(key) ? journal.get(key) : null,
    setItem: (key, value) => journal.set(String(key), String(value)),
    removeItem: key => journal.delete(key)
  };
  const history = fixture.window.__historyTest;
  history.stub({ store, metadata: () => Promise.resolve(null), fps: () => Promise.resolve(30) });
  // The lightweight DOM harness has no encoder; a tiny real data URL is enough
  // to inspect history behavior without allocating another video decoder.
  const createElement = fixture.document.createElement;
  fixture.document.createElement = tag => {
    const element = createElement(tag);
    if (tag === 'canvas') element.toDataURL = () => 'data:image/jpeg;base64,/9j/2Q==';
    return element;
  };
  async function ready(file, entry) {
    if (entry) entries.set(entry.id, plain({ name: file.name, size: file.size, ...entry }));
    history.loadFile(file, entry);
    fixture.video.onloadedmetadata();
    await flush();
  }
  return { ...fixture, history, store, saved, updates, removed, entries, ready };
}

test('a cached source restores frame and valid marks without importing or measuring it again', async () => {
  const f = setup();
  let measured = 0;
  f.history.stub({ fps: () => { measured++; return Promise.resolve(24); } });
  await f.ready(clip('remembered.mp4'), { id: 'recent', fps: 60, session: { frame: 42, marks: [3, 45, 45, -1, 9999, 2.5] } });
  assert.equal(f.api.state.ready, true);
  assert.equal(f.api.state.fps, 60);
  assert.equal(f.api.state.frame, 42);
  assert.deepEqual(plain(f.api.state.marks), [3, 45]);
  assert.equal(f.history.context.id, 'recent');
  assert.equal(f.saved.length, 0);
  assert.equal(measured, 0);
  assert.match(f.ids.get('historystatus').textContent, /Available in Recent videos/);
  assert.ok(f.updates.every(update => update.session.frame === 42), 'initial rendering never overwrites the saved position');
});

test('a cached source without a session starts at the first frame without copying its bytes again', async () => {
  const f = setup();
  f.api.state.frame = 222; f.api.state.marks = [20, 222];
  await f.ready(clip('legacy.mp4'), { id: 'legacy', fps: 30 });
  assert.equal(f.api.state.frame, 0);
  assert.deepEqual(plain(f.api.state.marks), []);
  assert.equal(f.saved.length, 0);
  assert.ok(f.updates.every(update => update.session.frame === 0));
});

test('a previous import cannot overwrite a newer clip through delayed metadata or FPS completion', async () => {
  const f = setup(), metaA = deferred(), metaB = deferred(), fpsA = deferred(), fpsB = deferred();
  let measurements = 0;
  f.history.stub({ metadata: file => file.name === 'a.mp4' ? metaA.promise : metaB.promise,
    fps: () => (++measurements === 1 ? fpsA.promise : fpsB.promise) });
  f.history.loadFile(clip('a.mp4'));
  const oldError = f.video.onerror;
  f.video.onloadedmetadata();
  f.history.loadFile(clip('b.mp4'));
  f.video.onloadedmetadata();
  metaB.resolve({ model: 'B camera' }); fpsB.resolve(60);
  await flush();
  metaA.resolve({ model: 'A camera' }); fpsA.resolve(24); oldError();
  await flush();
  assert.equal(f.api.state.base, 'b');
  assert.equal(f.api.state.meta.model, 'B camera');
  assert.equal(f.api.state.fps, 60);
  assert.equal(f.api.state.ready, true);
  assert.deepEqual(f.saved.map(item => item.file.name), ['b.mp4']);
});

test('an old real FPS detector cannot pause the replacement video when its timeout fires', async () => {
  const f = setup(), callbacks = [];
  f.history.loadFile(clip('a.mp4'));
  f.video.requestVideoFrameCallback = callback => { callbacks.push(callback); return callbacks.length; };
  const before = new Set(f.timers.keys());
  const result = f.history.detect(f.history.token);
  const detectorTimers = [...f.timers].filter(([id]) => !before.has(id)).map(([, callback]) => callback);
  f.history.loadFile(clip('b.mp4'));
  f.video.paused = false;
  detectorTimers.forEach(callback => callback());
  assert.equal(await result, null);
  assert.equal(f.video.paused, false);
  const count = callbacks.length;
  callbacks[0](0, { presentedFrames: 1, mediaTime: 0 });
  assert.equal(callbacks.length, count, 'stale callbacks do not schedule more frame reads');
});

test('switching sources persists a copied session for the previous cached video', async () => {
  const f = setup();
  await f.ready(clip('a.mp4'), { id: 'a', fps: 30, session: { frame: 5, marks: [2] } });
  f.api.state.frame = 81; f.api.state.marks = [7, 81];
  f.history.loadFile(clip('b.mp4'));
  await flush();
  f.api.state.marks.push(99);
  const savedSession = f.updates.filter(item => item.id === 'a').at(-1);
  assert.deepEqual(savedSession.session, { frame: 81, marks: [7, 81] });
});

test('a pending cache write keeps its own final session after a different video opens', async () => {
  const write = deferred(), saved = [], f = setup({ save: (file, metadata) => {
    saved.push({ file, metadata }); return write.promise;
  } });
  await f.ready(clip('a.mp4'));
  assert.equal(saved.length, 1);
  const oldContext = f.history.context;
  f.api.state.frame = 95; f.api.state.marks = [20, 95];
  await f.ready(clip('b.mp4'), { id: 'b', fps: 30, session: { frame: 3, marks: [] } });
  write.resolve({ ...saved[0].metadata, id: 'a', name: 'a.mp4', size: saved[0].file.size });
  await flush();
  assert.equal(f.history.context.id, 'b');
  assert.equal(f.api.state.base, 'b');
  assert.equal(f.api.state.frame, 3);
  assert.equal(oldContext.id, 'a');
  const session = f.updates.filter(item => item.id === 'a').at(-1);
  assert.deepEqual(session.session, { frame: 95, marks: [20, 95] });
});

test('removing the active cache leaves the source usable and prevents session resurrection', async () => {
  const f = setup();
  await f.ready(clip('a.mp4'), { id: 'a', fps: 30, session: { frame: 12, marks: [12] } });
  const sessionKey = f.history.sessionKey('a');
  assert.ok(f.window.localStorage.getItem(sessionKey));
  await f.history.remove('a'); await flush();
  const updatesBefore = f.updates.length;
  f.api.state.frame = 32; f.api.state.marks = [12, 32];
  f.history.remember(true); await flush();
  assert.deepEqual(f.removed, ['a']);
  assert.equal(f.api.state.ready, true);
  assert.equal(f.api.state.base, 'a');
  assert.equal(f.updates.length, updatesBefore);
  assert.equal(f.saved.length, 0);
  assert.equal(f.window.localStorage.getItem(sessionKey), null);
});

test('refresh notices an externally evicted source and preserves the usable open video', async () => {
  const f = setup();
  await f.ready(clip('a.mp4'), { id: 'a', fps: 30, session: { frame: 12, marks: [12] } });
  const activeURL = f.api.state.url;
  f.entries.delete('a');
  await f.history.refresh();
  assert.equal(f.history.context.id, null);
  assert.equal(f.history.context.removed, true);
  assert.equal(f.api.state.url, activeURL);
  assert.equal(f.api.state.ready, true);
  assert.equal(f.api.state.frame, 12);
  assert.deepEqual(plain(f.api.state.marks), [12]);
  assert.equal(f.ids.get('recents').hidden, true);
  assert.match(f.ids.get('historystatus').textContent, /no longer in Recent videos/);
  const updatesBefore = f.updates.length;
  f.api.state.frame = 32;
  f.history.remember(true);
  await f.history.cache(f.history.context);
  assert.equal(f.updates.length, updatesBefore);
  assert.equal(f.saved.length, 0);
  assert.equal(f.entries.size, 0);
});

test('a delayed Recent open cannot replace a video imported while its bytes were loading', async () => {
  const opening = deferred(), f = setup({ open: () => opening.promise });
  const request = f.history.open('old');
  f.history.loadFile(clip('new.mp4'));
  opening.resolve({ file: clip('old.mp4'), entry: { id: 'old', fps: 30, session: { frame: 44, marks: [] } } });
  await request; await flush();
  assert.equal(f.api.state.base, 'new');
  assert.equal(f.history.context.file.name, 'new.mp4');
});

test('unavailable history storage does not prevent normal video use or claim a saved copy', async () => {
  const f = setup({ supported: false });
  await f.ready(clip('a.mp4'));
  assert.equal(f.api.state.ready, true);
  assert.equal(f.api.state.base, 'a');
  assert.equal(f.saved.length, 0);
  assert.doesNotMatch(f.ids.get('historystatus').textContent, /Available in Recent videos/);
  assert.match(f.ids.get('historystatus').textContent, /unavailable|could not|cannot|isn't|not available/i);
});

test('cache progress reports availability only after the final storage commit', async () => {
  const write = deferred();
  let reportProgress;
  const f = setup({ save: (file, metadata, progress) => {
    reportProgress = progress; return write.promise;
  } });
  const file = clip('a.mp4');
  await f.ready(file);
  reportProgress(file.size, file.size);
  assert.equal(f.ids.get('historyprogress').value, 99);
  assert.doesNotMatch(f.ids.get('historystatus').textContent, /Available/);
  assert.equal(f.history.context.id, null);
  write.resolve({ id: 'a', size: file.size });
  await flush();
  assert.equal(f.history.context.id, 'a');
  assert.match(f.ids.get('historystatus').textContent, /Available in Recent videos/);
  assert.equal(f.ids.get('historyprogress').hidden, true);
});

test('a quota failure leaves the current source usable and explains that it was not retained', async () => {
  const f = setup({ save: () => Promise.reject({ code: 'quota' }) });
  await f.ready(clip('large.mp4'));
  assert.equal(f.api.state.ready, true);
  assert.equal(f.api.state.base, 'large');
  assert.equal(f.history.context.id, null);
  assert.equal(f.history.context.caching, false);
  assert.match(f.ids.get('historystatus').textContent, /Not enough device storage/);
  assert.doesNotMatch(f.ids.get('historystatus').textContent, /Available/);
});

test('the file picker resets after selection so a removed source can be selected again', () => {
  const f = setup(), input = f.ids.get('file'), file = clip('same.mp4');
  input.files = [file]; input.value = 'C:\\fakepath\\same.mp4';
  f.dispatch(input, 'change');
  assert.equal(f.history.context.file, file);
  assert.equal(input.value, '');
});

test('a synchronous session checkpoint wins over stale database metadata when reopening', async () => {
  const f = setup();
  f.window.localStorage.setItem(f.history.sessionKey('a'), JSON.stringify({ frame: 113, marks: [12, 113] }));
  await f.ready(clip('a.mp4'), { id: 'a', fps: 30, session: { frame: 10, marks: [] } });
  assert.equal(f.api.state.frame, 113);
  assert.deepEqual(plain(f.api.state.marks), [12, 113]);
  assert.ok(f.updates.every(update => update.session.frame === 113), 'initial render must preserve the newer checkpoint');
});

test('pagehide checkpoints the latest selection synchronously before an unfinished database write', async () => {
  const commit = deferred(), f = setup({ updateSession: () => commit.promise });
  await f.ready(clip('a.mp4'), { id: 'a', fps: 30, session: { frame: 10, marks: [] } });
  f.api.state.frame = 113; f.api.state.marks = [12, 113];
  f.dispatch(f.window, 'pagehide');
  assert.deepEqual(JSON.parse(f.window.localStorage.getItem(f.history.sessionKey('a'))), { frame: 113, marks: [12, 113] });
  assert.equal(f.entries.get('a').session.frame, 10, 'the database still has the old metadata');
  commit.resolve();
  await flush();
});

test('refresh prunes checkpoints for evicted copies while preserving unrelated local data', async () => {
  const f = setup();
  await f.ready(clip('a.mp4'), { id: 'a', fps: 30, session: { frame: 12, marks: [12] } });
  const activeKey = f.history.sessionKey('a'), abandonedKey = f.history.sessionKey('already-removed');
  f.window.localStorage.setItem(abandonedKey, JSON.stringify({ frame: 90, marks: [] }));
  f.window.localStorage.setItem('unrelated-preference', 'keep');
  f.entries.delete('a');
  await f.history.refresh();
  assert.equal(f.window.localStorage.getItem(activeKey), null);
  assert.equal(f.window.localStorage.getItem(abandonedKey), null);
  assert.equal(f.window.localStorage.getItem('unrelated-preference'), 'keep');
});
