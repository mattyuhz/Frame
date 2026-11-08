'use strict';

// Optional browser coverage: NODE_PATH=<dev playwright install> node --test
// tests/history-store.test.cjs. PLAYWRIGHT_CHROMIUM_EXECUTABLE may select Chrome.
// No test dependency ships in Frame.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { File } = require('node:buffer');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/\/\* FRAME_HISTORY_STORE_BEGIN \*\/([\s\S]*?)\/\* FRAME_HISTORY_STORE_END \*\//);
assert.ok(match, 'the shipped page contains the local history module');
const source = match[1];

function factory(extra = {}) {
  const context = { Promise, Blob, File, Uint8Array, Date, Math, JSON, Error, ...extra };
  vm.createContext(context); vm.runInContext(source, context);
  return context.createVideoHistoryStore;
}

test('unsupported storage and oversized files fail without attempting a copy', async () => {
  const create = factory(), unavailable = create({ indexedDB: null });
  assert.equal(unavailable.supported, false);
  await assert.rejects(unavailable.list(), { code: 'unavailable' });
  let opens = 0, slices = 0;
  const store = create({ limit: 4, indexedDB: { open() { opens++; } } });
  await assert.rejects(store.save({ size: 5, slice() { slices++; } }), { code: 'too-large' });
  assert.equal(opens, 0); assert.equal(slices, 0);
  assert.equal(unavailable.limit, 8000000000);
  const hostile = {};
  Object.defineProperty(hostile, 'indexedDB', { get() { throw new Error('Opaque origin'); } });
  vm.createContext(hostile);
  vm.runInContext(source, hostile);
  assert.equal(hostile.videoHistoryStore.supported, false);
});

let chromium;
try { ({ chromium } = require('playwright')); } catch (_) {}

test('persistent history uses real browser storage', { skip: !chromium && 'Install dev-only Playwright to run browser storage checks' }, async t => {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (process.platform === 'darwin' && fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  const browser = await chromium.launch({ headless: true, executablePath });
  t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local history storage test</title>' }));
  await context.addInitScript({ content: source + '\nwindow.createVideoHistoryStore=createVideoHistoryStore;' });
  const page = await context.newPage();
  await page.goto('http://localhost:34343/history-tests/');

  await t.test('committed chunks reopen after reload with exact bytes and metadata, then delete completely', async () => {
    const saved = await page.evaluate(async () => {
      const store = createVideoHistoryStore({ name: 'roundtrip', chunkSize: 4 });
      const progress = [], file = new File(['0123456789abcdef'], 'long.mov', { type: 'video/quicktime', lastModified: 123456 });
      const entry = await store.save(file, { duration: 123.5, fps: 29.97, thumbnail: 'data:image/jpeg;base64,AA', session: { frame: 91, marks: [2, 7] } }, (written, total) => progress.push([written, total]));
      return { entry, progress };
    });
    assert.deepEqual(saved.progress, [[0, 16], [4, 16], [8, 16], [12, 16], [16, 16]]);
    assert.equal(saved.entry.complete, true);
    await page.reload();
    const reopened = await page.evaluate(async id => {
      const store = createVideoHistoryStore({ name: 'roundtrip' });
      const list = await store.list(), { file, entry } = await store.open(id);
      const content = await file.text();
      await store.updateSession(id, { frame: 111, marks: [2, 7, 11] });
      const updated = (await store.list())[0];
      await store.remove(id);
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('roundtrip'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const chunks = await new Promise(resolve => { const request = database.transaction('chunks').objectStore('chunks').count(); request.onsuccess = () => resolve(request.result); });
      database.close();
      return { list, content, name: file.name, type: file.type, modified: file.lastModified, entry, updated, remaining: await store.list(), chunks };
    }, saved.entry.id);
    assert.equal(reopened.content, '0123456789abcdef');
    assert.equal(reopened.name, 'long.mov'); assert.equal(reopened.type, 'video/quicktime'); assert.equal(reopened.modified, 123456);
    assert.equal(reopened.list[0].duration, 123.5); assert.equal(reopened.list[0].fps, 29.97);
    assert.deepEqual(reopened.entry.session, { frame: 91, marks: [2, 7] });
    assert.deepEqual(reopened.updated.session, { frame: 111, marks: [2, 7, 11] });
    assert.equal(reopened.entry.lastUsed, reopened.updated.lastUsed, 'session writes do not reorder recents');
    assert.deepEqual(reopened.remaining, []); assert.equal(reopened.chunks, 0);
  });

  await t.test('storage bounds evict the least recently opened clip and reject large files without deleting anything', async () => {
    const result = await page.evaluate(async () => {
      const clock = Date.now; let now = 100;
      Date.now = () => now;
      try {
        const store = createVideoHistoryStore({ name: 'bounds', limit: 9, maxEntries: 2, chunkSize: 2 });
        const a = await store.save(new File(['aaaa'], 'a.mov'), {}); now++;
        const b = await store.save(new File(['bbbb'], 'b.mov'), {}); now++;
        await store.open(a.id); now++;
        const c = await store.save(new File(['cccc'], 'c.mov'), {});
        let error; try { await store.save(new File(['0123456789'], 'huge.mov'), {}); } catch (e) { error = e.code; }
        return { names: (await store.list()).map(e => e.name), error, content: await (await store.open(a.id)).file.text() };
      } finally { Date.now = clock; }
    });
    assert.deepEqual(result.names, ['c.mov', 'a.mov']); assert.equal(result.error, 'too-large'); assert.equal(result.content, 'aaaa');
  });

  await t.test('a mid-copy quota error removes every partial chunk and preserves earlier completed video', async () => {
    const result = await page.evaluate(async () => {
      const store = createVideoHistoryStore({ name: 'quota', limit: 8, maxEntries: 1, chunkSize: 2 });
      const good = await store.save(new File(['good'], 'good.mov'), {});
      const put = IDBObjectStore.prototype.put; let writes = 0, error;
      IDBObjectStore.prototype.put = function(...args) {
        if (this.name === 'chunks' && ++writes === 2) throw new DOMException('Disk full', 'QuotaExceededError');
        return put.apply(this, args);
      };
      try { await store.save(new File(['failure!'], 'failed.mov'), {}); } catch (e) { error = e.code; }
      finally { IDBObjectStore.prototype.put = put; }
      const list = await store.list();
      const db = await new Promise(resolve => { const r = indexedDB.open('quota'); r.onsuccess = () => resolve(r.result); });
      const counts = await new Promise(resolve => {
        const tx = db.transaction(['entries', 'chunks']); const entries = tx.objectStore('entries').count(), chunks = tx.objectStore('chunks').count();
        tx.oncomplete = () => resolve([entries.result, chunks.result]);
      }); db.close();
      return { error, names: list.map(e => e.name), counts, bytes: await (await store.open(good.id)).file.text() };
    });
    assert.equal(result.error, 'quota'); assert.deepEqual(result.names, ['good.mov']); assert.deepEqual(result.counts, [1, 2]); assert.equal(result.bytes, 'good');
  });

  await t.test('interrupted drafts are hidden and cleaned, while incomplete completed records fail safely', async () => {
    const result = await page.evaluate(async () => {
      const initial = createVideoHistoryStore({ name: 'interrupted', chunkSize: 2 });
      const good = await initial.save(new File(['1234'], 'broken.mov'), {});
      const db = await new Promise(resolve => { const r = indexedDB.open('interrupted'); r.onsuccess = () => resolve(r.result); });
      await new Promise(resolve => {
        const tx = db.transaction(['entries', 'chunks'], 'readwrite');
        tx.objectStore('entries').put({ id: 'interrupted', size: 4, complete: false, updated: Date.now() });
        tx.objectStore('chunks').put({ id: 'interrupted', index: 0, blob: new Blob(['12']) });
        tx.objectStore('chunks').delete([good.id, 1]); tx.oncomplete = resolve;
      });
      const fresh = createVideoHistoryStore({ name: 'interrupted' });
      const visible = await fresh.list(); let error;
      try { await fresh.open(good.id); } catch (e) { error = e.code; }
      const counts = await new Promise(resolve => {
        const tx = db.transaction(['entries', 'chunks']); const entries = tx.objectStore('entries').count(), chunks = tx.objectStore('chunks').count();
        tx.oncomplete = () => resolve([entries.result, chunks.result]);
      }); db.close();
      return { visible: visible.map(e => e.name), error, counts };
    });
    assert.deepEqual(result.visible, ['broken.mov']); assert.equal(result.error, 'missing'); assert.deepEqual(result.counts, [0, 0]);
  });

  await t.test('concurrent stores without Web Locks reserve capacity atomically and do not expose drafts', async () => {
    const result = await page.evaluate(async () => {
      const opts = { name: 'concurrent', limit: 8, chunkSize: 1, navigator: {} };
      const a = createVideoHistoryStore(opts), b = createVideoHistoryStore(opts);
      const copies = await Promise.allSettled([a.save(new File(['123456'], 'a.mov'), {}), b.save(new File(['abcdef'], 'b.mov'), {})]);
      return { statuses: copies.map(r => r.status), codes: copies.filter(r => r.status === 'rejected').map(r => r.reason.code), list: await a.list() };
    });
    assert.equal(result.statuses.filter(s => s === 'fulfilled').length, 1);
    assert.deepEqual(result.codes, ['quota']); assert.equal(result.list.length, 1); assert.equal(result.list[0].complete, true);
  });

  await t.test('concurrent replacement commits recheck the byte and entry limits', async () => {
    const result = await page.evaluate(async () => {
      const options = { name: 'concurrent-replacement', limit: 8, maxEntries: 2, navigator: {} };
      const seed = createVideoHistoryStore(options);
      await seed.save(new File(['aaaaaa'], 'old-large.mov'), {});
      await seed.save(new File(['bb'], 'old-small.mov'), {});
      const a = createVideoHistoryStore({ ...options, chunkSize: 1 });
      const b = createVideoHistoryStore({ ...options, chunkSize: 6 });
      const copies = await Promise.allSettled([a.save(new File(['cc'], 'new-small.mov'), {}), b.save(new File(['dddddd'], 'new-large.mov'), {})]);
      const list = await seed.list();
      return { statuses: copies.map(r => r.status), names: list.map(e => e.name).sort(), bytes: list.reduce((sum, e) => sum + e.size, 0) };
    });
    assert.deepEqual(result.statuses, ['fulfilled', 'fulfilled']);
    assert.deepEqual(result.names, ['new-large.mov', 'new-small.mov']); assert.equal(result.bytes, 8);
  });

  await t.test('throwing persistence and progress hooks cannot break a successfully stored video', async () => {
    const result = await page.evaluate(async () => {
      const store = createVideoHistoryStore({ name: 'hooks', chunkSize: 2, navigator: { storage: { persist() { throw new Error('denied'); } } } });
      const entry = await store.save(new File(['test'], 'test.mov'), { session: { frame: 3 } }, () => { throw new Error('UI went away'); });
      await store.remove(entry.id);
      let error; try { await store.updateSession(entry.id, { frame: 7 }); } catch (e) { error = e.code; }
      return { complete: entry.complete, error, count: (await store.list()).length };
    });
    assert.equal(result.complete, true); assert.equal(result.error, 'missing'); assert.equal(result.count, 0);
  });
});
