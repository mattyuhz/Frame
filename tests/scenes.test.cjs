'use strict';

// Exercise the shipped navigation/detector bytes. Pixel fixtures below are
// deliberate signals, while the MP4 fixtures cover the real decode path.
const assert = require('node:assert/strict');
const test = require('node:test');
const { boot, near } = require('./crop.test.cjs');

const exposure = `
  window.__sceneTest = {
    sceneNav, buildSceneRanges, sceneBounds, clampSceneFrame, selectScene,
    prepareScenes, resetScenes, cancelSceneScan, startSceneScan,
    sceneSignature, sceneDifference, detectSceneCuts, framesPerPx,
    scrubAbsolute, step, requestFrame, setFrameUI, tickScenePlayback,
    paintSceneCards, paintSceneFocus, toggleMark, paintMarks, nameFor,
    setSeek(fn){ runSeek=fn; },
    setSaving(value){ saving=value; }
  };
`;

function setup(duration = 120, fps = 30) {
  const f = boot({ exposure });
  f.scene = f.window.__sceneTest;
  f.video.duration = duration;
  Object.assign(f.api.state, { fps, total: Math.max(1, Math.round(duration * fps)), frame: 0, url: 'blob:scene-source', base: 'source' });
  f.scene.sceneNav.duration = duration;
  f.scene.sceneNav.items = f.scene.buildSceneRanges(duration, []);
  f.scene.paintSceneCards();
  f.seeks = [];
  f.scene.setSeek(n => { f.seeks.push(n); f.video.currentTime = (n + 0.5) / fps; return Promise.resolve('seeked'); });
  return f;
}

const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function pixels(fn) {
  const data = new Uint8Array(32 * 18 * 4);
  for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) {
    const rgb = fn(x, y), i = (y * 32 + x) * 4;
    data.set([rgb[0], rgb[1], rgb[2], 255], i);
  }
  return data;
}
function solid(r, g, b) { return pixels(() => [r, g, b]); }
function signal(f, frames, interval = 0.5) {
  return frames.map((frame, i) => ({ time: i * interval, sig: f.scene.sceneSignature(frame) }));
}
function providePixels(f, getPixels) {
  const create = f.document.createElement;
  f.document.createElement = tag => {
    const element = create(tag);
    if (tag === 'canvas') {
      element.getContext().getImageData = () => ({ data: getPixels() });
      element.toDataURL = () => 'data:image/jpeg;base64,fixture';
    }
    return element;
  };
}

test('time sections cover the whole source once and keep a long video overview bounded', () => {
  const f = setup();
  for (const duration of [1 / 30, 0.25, 30, 30.01, 120, 1200, 18000]) {
    const ranges = f.scene.buildSceneRanges(duration, []);
    assert.ok(ranges.length > 0 && ranges.length <= 120);
    assert.equal(ranges[0].start, 0);
    near(ranges.at(-1).end, duration, 'last section reaches source end');
    ranges.forEach((r, i) => {
      assert.ok(r.end > r.start);
      assert.equal(r.kind, 'Section', 'time chunks are not presented as detected scenes');
      if (i) near(r.start, ranges[i - 1].end, 'adjacent sections meet');
    });
  }
  for (const duration of [0, -1, NaN, Infinity]) assert.equal(f.scene.buildSceneRanges(duration, []).length, 0);
});

test('scene suggestions sanitize cuts and keep long stretches usable as sections', () => {
  const f = setup();
  const ranges = f.scene.buildSceneRanges(100, [99.99, 20, 20, -3, 0, NaN, 10, Infinity]);
  assert.deepEqual(plain(ranges.slice(0, 2)), [
    { start: 0, end: 10, kind: 'Scene' }, { start: 10, end: 20, kind: 'Scene' }
  ]);
  assert.ok(ranges.slice(2).every(r => r.kind === 'Section' && r.end - r.start <= 30));
  assert.equal(ranges.at(-1).end, 100);
});

test('focused scrubbing expands its range with absolute timestamps and accessible endpoints', async () => {
  const f = setup(1200);
  const fullScale = f.scene.framesPerPx();
  f.scene.selectScene(2);
  assert.deepEqual(plain(f.scene.sceneBounds()), { start: 1800, end: 2699 });
  assert.equal(f.api.state.frame, 1800);
  assert.equal(f.ids.get('scrub').getAttribute('aria-valuemin'), '1800');
  assert.equal(f.ids.get('scrub').getAttribute('aria-valuemax'), '2699');
  assert.ok(f.scene.framesPerPx() < fullScale / 39);
  assert.equal(f.ids.get('scenelist').children[2].getAttribute('aria-pressed'), 'true');
  const rect = f.ids.get('scrub').getBoundingClientRect();
  f.scene.scrubAbsolute(rect.left - 50); assert.equal(f.api.state.frame, 1800);
  f.scene.scrubAbsolute(rect.right + 50); assert.equal(f.api.state.frame, 2699);
  f.scene.scrubAbsolute(rect.left + rect.width / 2); assert.equal(f.api.state.frame, 2250);
  assert.equal(f.ids.get('tc').textContent, '00:01:15:00', 'timecode remains source absolute');
  assert.equal(f.scene.sceneNav.active, 2);
  f.scene.selectScene(-1);
  assert.equal(f.api.state.frame, 2250, 'Whole video preserves the selected moment');
  assert.equal(f.ids.get('scrub').getAttribute('aria-valuemin'), '0');
  assert.equal(f.ids.get('scrub').getAttribute('aria-valuemax'), '35999');
  await flush();
});

test('step, wheel, Home/End and fine pointer scrubbing cannot escape the focused section', () => {
  const f = setup(); f.scene.selectScene(1);
  f.scene.step(-10); assert.equal(f.api.state.frame, 900);
  f.scene.setFrameUI(1798); f.scene.step(10); assert.equal(f.api.state.frame, 1799);
  const scrub = f.ids.get('scrub');
  f.dispatch(scrub, 'keydown', { key: 'Home' }); assert.equal(f.api.state.frame, 900);
  f.dispatch(scrub, 'wheel', { deltaX: 0, deltaY: -1 }); assert.equal(f.api.state.frame, 900);
  f.dispatch(scrub, 'keydown', { key: 'End' }); assert.equal(f.api.state.frame, 1799);
  const r = scrub.getBoundingClientRect();
  f.pointer('pointerdown', 81, r.left + r.width / 2, r.top + 10, scrub);
  const anchor = f.api.state.frame;
  f.pointer('pointermove', 81, r.left + r.width / 2, r.top - 200, scrub);
  assert.equal(f.api.state.frame, anchor, 'entering finer tier must re-anchor without a jump');
  f.pointer('pointermove', 81, r.left + r.width / 2 + 100, r.top - 200, scrub);
  near(f.api.state.frame, Math.round(anchor + 100 * 899 / r.width * 0.04), 'fine tier uses selected range');
  f.pointer('pointermove', 81, r.left - 100000, r.top - 200, scrub);
  assert.equal(f.api.state.frame, 900);
  f.pointer('pointerup', 81, r.left, r.top - 200, scrub);
});

test('tiny sections have finite coordinates and nonnegative frame bounds', () => {
  const f = setup(1 / 30); f.scene.selectScene(0);
  assert.deepEqual(plain(f.scene.sceneBounds()), { start: 0, end: 0 });
  assert.equal(f.scene.framesPerPx(), 0);
  f.scene.scrubAbsolute(100000); f.scene.step(10);
  assert.equal(f.api.state.frame, 0);
  assert.equal(f.ids.get('playhead').style.left, '0%');
});

test('fractional frame rates preserve the cut frame despite floating-point round trips', () => {
  for (const [fps, cutFrame] of [[23.976, 25], [29.97, 125], [59.94, 125], [29.67, 15]]) {
    const f = setup(20, fps), cut = cutFrame / fps;
    assert.ok(cut * fps > cutFrame, 'fixture must exercise upward floating-point error');
    f.scene.sceneNav.items = f.scene.buildSceneRanges(20, [cut]);
    f.scene.selectScene(0);
    assert.deepEqual(plain(f.scene.sceneBounds()), { start: 0, end: cutFrame - 1 });
    f.scene.selectScene(1);
    assert.deepEqual(plain(f.scene.sceneBounds()), { start: cutFrame, end: f.api.state.total - 1 });
    assert.equal(f.api.state.frame, cutFrame);
  }
});

test('marks outside a scene return to the original source and export keeps the original timestamp', async () => {
  const f = setup();
  f.scene.selectScene(2); f.scene.setFrameUI(1901); f.scene.toggleMark();
  assert.deepEqual([...f.api.state.marks], [1901]);
  f.scene.selectScene(0);
  f.ids.get('chips').children[0].click();
  assert.equal(f.api.state.frame, 1901);
  assert.equal(f.scene.sceneNav.active, -1, 'a source mark outside focus remains reachable');
  const downloads = [];
  f.api.stubExport({
    currentBlob: () => Promise.resolve(new Blob(['frame'], { type: 'image/png' })),
    verifyImage: () => Promise.resolve({ w: 1920, h: 1080 }),
    downloadBlob: (blob, name) => downloads.push(name)
  });
  await f.api.saveCurrent();
  assert.deepEqual(downloads, ['source_00-01-03-11.png']);
});

test('focused playback stops at the section boundary without stepping into the next section', () => {
  const f = setup(); f.scene.selectScene(1);
  f.video.paused = false; f.video.currentTime = 60.1;
  f.scene.tickScenePlayback();
  assert.equal(f.video.paused, true);
  assert.equal(f.api.state.frame, 1799);
  assert.equal(f.scene.sceneNav.active, 1);
});

test('playback seeks back to the section end even when the UI already shows the final frame', () => {
  const f = setup(); f.scene.selectScene(1); f.scene.setFrameUI(1799);
  const before = f.seeks.length;
  f.video.paused = false; f.video.currentTime = 60.1;
  f.scene.tickScenePlayback();
  assert.equal(f.video.paused, true);
  assert.equal(f.api.state.frame, 1799);
  assert.equal(f.seeks.length, before + 1, 'the decoder must seek even though the displayed frame is unchanged');
  assert.equal(f.seeks.at(-1), 1799);
  near(f.video.currentTime, 1799.5 / 30, 'decoded picture is inside the selected section');
});

test('detector identifies sustained cuts but rejects a one-sample flash and its return', () => {
  const f = setup(), a = solid(20, 40, 90), b = solid(230, 140, 20), flash = solid(255, 255, 255);
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, [a, a, a, b, b, b]))], [1.25]);
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, [a, a, flash, a, a, a]))], []);
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, [a, a, a, a]))], []);
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, [a, b]))], [], 'unconfirmed final change stays a suggestion-free section');
});

test('a flash during a moving shot does not create a cut when the picture returns farther along the pan', () => {
  const f = setup();
  const pan = offset => pixels(x => (x + offset) % 32 < 16 ? [0, 0, 0] : [255, 255, 255]);
  const before = pan(0), after = pan(8), later = pan(9), flash = solid(255, 255, 255);
  const motion = f.scene.sceneDifference(f.scene.sceneSignature(before), f.scene.sceneSignature(after));
  assert.ok(motion > 0.12 && motion < 0.25, 'the returning picture moves enough to defeat exact-return flash checks');
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, [before, before, flash, after, later, later]))], []);
});

test('detector tolerates continuous movement and gradual changes in a textured shot', () => {
  const f = setup();
  const frames = Array.from({ length: 20 }, (_, n) => pixels((x, y) => {
    const v = ((x + n) % 32) * 7;
    return [v, y * 13, 80 + n];
  }));
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, frames))], []);
  const fade = Array.from({ length: 25 }, (_, n) => pixels((x, y) => {
    const v = Math.round(((x * 7 + y * 5) % 256) * (1 - n / 30));
    return [v, v, v];
  }));
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, fade))], []);
});

test('the spatial comparison can distinguish changed pictures with the same color histogram', () => {
  const f = setup();
  const a = pixels(x => x < 16 ? [0, 0, 0] : [255, 255, 255]);
  const b = pixels(x => x < 16 ? [255, 255, 255] : [0, 0, 0]);
  const sigA = f.scene.sceneSignature(a), sigB = f.scene.sceneSignature(b);
  assert.deepEqual([...sigA.hist], [...sigB.hist]);
  assert.ok(f.scene.sceneDifference(sigA, sigB) >= 0.3);
  assert.deepEqual([...f.scene.detectSceneCuts(signal(f, [a, a, a, b, b, b]))], [1.25]);
});

test('sections are usable immediately and touching the editor cancels the queued automatic scan', () => {
  const f = setup(180);
  f.scene.prepareScenes();
  assert.equal(f.scene.sceneNav.items.length, 6);
  assert.equal(f.scene.sceneNav.scan, null);
  const timer = f.scene.sceneNav.timer;
  assert.ok(f.timers.has(timer));
  f.scene.selectScene(3);
  assert.equal(f.scene.sceneNav.timer, null);
  assert.equal(f.timers.has(timer), false);
  assert.equal(f.api.state.frame, 2700);
});

test('interrupted analysis cannot collect stale pixels or restore over a newer user seek', async () => {
  const f = setup(90), first = deferred(), calls = [];
  providePixels(f, () => solid(40, 80, 120));
  f.scene.setFrameUI(1000);
  f.scene.setSeek(n => { calls.push(n); return calls.length === 1 ? first.promise : Promise.resolve('seeked'); });
  f.scene.startSceneScan();
  assert.ok(f.scene.sceneNav.scan);
  assert.equal(f.api.state.frame, 1000, 'analysis keeps the user selection while borrowing the decoder');
  f.scene.requestFrame(1500);
  assert.equal(f.scene.sceneNav.scan, null);
  first.resolve('seeked'); await flush();
  assert.equal(f.api.state.frame, 1500);
  assert.equal(f.scene.sceneNav.samples.length, 0);
  assert.equal(f.scene.sceneNav.thumbs.length, 0);
  assert.deepEqual(calls, [0, 1500]);
  assert.equal(f.scene.sceneNav.timer, null);
});

test('file replacement invalidates an in-flight scan and resets its partial results', async () => {
  const f = setup(), first = deferred();
  providePixels(f, () => solid(40, 80, 120));
  f.scene.setSeek(() => first.promise);
  f.scene.startSceneScan();
  f.scene.resetScenes(); f.api.state.url = 'blob:replacement'; f.scene.setFrameUI(0);
  first.resolve('seeked'); await flush();
  assert.equal(f.scene.sceneNav.scan, null);
  assert.equal(f.scene.sceneNav.samples.length, 0);
  assert.equal(f.scene.sceneNav.items.length, 0);
  assert.equal(f.scene.sceneNav.timer, null);
  assert.equal(f.ids.get('scenes').hidden, true);
  assert.equal(f.api.state.frame, 0);
});

test('analysis pause restores the selected frame and resumes from the next unprocessed sample', async () => {
  const f = setup(90);
  providePixels(f, () => solid(40, 80, 120));
  f.scene.setFrameUI(1300); f.scene.startSceneScan(); await flush();
  assert.equal(f.scene.sceneNav.samples.length, 1);
  assert.equal(f.scene.sceneNav.next, 1);
  const queued = f.scene.sceneNav.timer;
  f.scene.cancelSceneScan(true); await flush();
  assert.equal(f.timers.has(queued), false);
  assert.equal(f.seeks.at(-1), 1300);
  assert.equal(f.api.state.frame, 1300);
  f.scene.startSceneScan(); await flush();
  assert.equal(f.scene.sceneNav.samples.length, 2);
  near(f.scene.sceneNav.samples[0].time, 0.5 / 30, 'first sample records the actual frame-center seek');
  near(f.scene.sceneNav.samples[1].time, 15.5 / 30, 'resumed sample records the actual frame-center seek');
  assert.equal(f.seeks.at(-1), 15);
  f.scene.cancelSceneScan(false);
});

test('a completed scan suggests cuts, keeps thumbnails, and returns to the selected source frame', async () => {
  const f = setup(4);
  providePixels(f, () => f.video.currentTime < 2 ? solid(20, 40, 90) : solid(230, 140, 20));
  f.scene.setFrameUI(42); f.scene.startSceneScan();
  for (let i = 0; i < 24 && !f.scene.sceneNav.done; i++) {
    await flush();
    const timer = f.scene.sceneNav.timer;
    if (timer !== null) {
      const callback = f.timers.get(timer);
      assert.equal(typeof callback, 'function');
      f.timers.delete(timer); callback();
    }
  }
  await flush();
  assert.equal(f.scene.sceneNav.done, true);
  assert.equal(f.scene.sceneNav.scan, null);
  assert.equal(f.scene.sceneNav.samples.length, 8);
  assert.equal(f.scene.sceneNav.cuts.length, 1);
  near(f.scene.sceneNav.cuts[0], 2, 'refinement uses the cut frame boundary, not its center');
  assert.equal(f.scene.sceneNav.items.length, 2);
  assert.ok(f.scene.sceneNav.items.every(item => item.kind === 'Scene'));
  assert.ok(f.scene.sceneNav.thumbs.length > 0);
  assert.equal(f.api.state.frame, 42);
  assert.equal(f.seeks.at(-1), 42);
  assert.equal(f.ids.get('bscanscenes').disabled, true);
  assert.match(f.ids.get('scenestatus').textContent, /Suggested scenes.*sampled every/);
  f.scene.selectScene(0);
  assert.deepEqual(plain(f.scene.sceneBounds()), { start: 0, end: 59 });
  f.scene.selectScene(1);
  assert.deepEqual(plain(f.scene.sceneBounds()), { start: 60, end: 119 });
  assert.equal(f.api.state.frame, 60, 'choosing the next scene lands on its first frame');
});

test('real seek tokens keep a cancelled scan from completing or clearing a newer edit seek', async () => {
  const f = setup(90), presented = [];
  providePixels(f, () => solid(40, 80, 120));
  f.scene.setSeek(f.api.runSeek);
  f.video.requestVideoFrameCallback = callback => { presented.push(callback); };
  f.scene.setFrameUI(1000); f.scene.startSceneScan();
  assert.equal(f.api.state.seeking, true);
  f.scene.requestFrame(1500);
  assert.equal(presented.length, 2);
  presented[0](); await flush();
  assert.equal(f.api.state.seeking, true, 'stale scan completion cannot clear the edit seek');
  assert.equal(f.scene.sceneNav.samples.length, 0);
  assert.equal(f.api.state.frame, 1500);
  presented[1](); await flush();
  assert.equal(f.api.state.seeking, false);
  assert.equal(f.scene.sceneNav.scan, null);
  near(f.video.currentTime, 1500.5 / 30, 'decoder stays at the requested source frame');
});

test('a hidden tab or a failed seek stops analysis without presenting a completed scan', async () => {
  const f = setup();
  f.document.hidden = true; f.scene.startSceneScan();
  assert.equal(f.scene.sceneNav.scan, null);
  f.document.hidden = false;
  f.scene.setSeek(() => Promise.resolve('timeout'));
  f.scene.startSceneScan(); await flush();
  assert.equal(f.scene.sceneNav.scan, null);
  assert.equal(f.scene.sceneNav.done, false);
  assert.equal(f.scene.sceneNav.items.length, 4);
  assert.match(f.ids.get('scenestatus').textContent, /could not finish/);
});
