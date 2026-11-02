'use strict';
// Dev-only real decoder checks. Requires Playwright and a locally installed Chrome.
// Start `python3 -m http.server 8876 --bind 127.0.0.1` in the repository first.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.FRAME_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/scenes/manifest.json'))).fixtures;
const base = process.env.FRAME_PREVIEW_URL || 'http://127.0.0.1:8876';
const output = process.env.FRAME_QA_OUTPUT || '/tmp/frame-scene-qa';
fs.mkdirSync(output, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// Expose existing functions only inside the test browser, as the unit harness does.
const instrumented = html.replace(/\}\)\(\);\s*<\/script>/, `window.__sceneQA={state,sceneNav,sceneBounds,requestFrame,goToFrame,selectScene};\n})();\n</script>`);
(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.FRAME_CHROME ? { executablePath: process.env.FRAME_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1050 }, acceptDownloads: true });
  // The native macOS share sheet needs a human; exercise the real encoder,
  // verifier and download fallback in this unattended browser check.
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true }));
  const errors = [], network = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(base)) network.push(r.url()); });
  await page.route(base + '/', route => route.fulfill({ contentType: 'text/html', body: instrumented }));
  const results = [];
  async function open(name) {
    await page.goto(base + '/');
    await page.locator('#file').setInputFiles(path.join(__dirname, 'fixtures/scenes', name));
    await page.waitForFunction(() => window.__sceneQA.sceneNav.items.length > 0);
  }
  for (const fixture of fixtures) {
    const start = Date.now();
    await open(fixture.file);
    await page.waitForFunction(() => window.__sceneQA.sceneNav.done, {}, { timeout: 120000 });
    const result = await page.evaluate(() => {
      const q = window.__sceneQA;
      return { cuts: q.sceneNav.cuts, sections: q.sceneNav.items.length, fps: q.state.fps,
        thumbnails: document.querySelectorAll('.scenecard img').length,
        status: document.querySelector('#scenestatus').textContent };
    });
    if (['01-hard-cuts.mp4', '06-portrait-variable-rate.mp4', '08-4k-cuts.mp4'].includes(fixture.file)) {
      assert.equal(result.cuts.length, fixture.cutsSeconds.length, fixture.file + ': cut count');
      result.cuts.forEach((t, i) => assert.ok(Math.abs(t - fixture.cutsSeconds[i]) <= 0.15, fixture.file + ': boundary within 150 ms'));
      assert.equal(result.thumbnails, result.sections, fixture.file + ': every scene has a visual preview');
    }
    if (['02-long-continuous.mp4', '03-flashes-and-pan.mp4', '07-subsecond.mp4'].includes(fixture.file)) assert.deepEqual(result.cuts, [], fixture.file + ': no false cuts');
    await page.locator('.scenecard').last().click();
    await page.waitForFunction(() => !window.__sceneQA.state.seeking);
    await page.locator('#scrub').focus();await page.keyboard.press('End');
    await page.waitForFunction(() => !window.__sceneQA.state.seeking);
    const endpoint = await page.evaluate(() => ({ frame: window.__sceneQA.state.frame, total: window.__sceneQA.state.total, time: document.querySelector('video').currentTime, bounds: window.__sceneQA.sceneBounds() }));
    assert.equal(endpoint.frame, endpoint.total - 1, fixture.file + ': final source frame reachable');
    assert.equal(endpoint.frame, endpoint.bounds.end);
    if (fixture.file === '08-4k-cuts.mp4') {
      const downloadPromise = page.waitForEvent('download');await page.locator('#bsave').click();
      const download = await downloadPromise, dest = path.join(output, '4k-export.png');await download.saveAs(dest);
      const bytes = fs.readFileSync(dest);assert.equal(bytes.readUInt32BE(16), 3840);assert.equal(bytes.readUInt32BE(20), 2160);
      result.exportDimensions = [3840, 2160];
    }
    result.file = fixture.file;result.elapsedMs = Date.now() - start;results.push(result);
    console.log(JSON.stringify(result));
  }
  // Interaction must interrupt the actual decoder scan; wait to catch late callbacks.
  await open('02-long-continuous.mp4');
  await page.waitForFunction(() => !!window.__sceneQA.sceneNav.scan);
  await page.locator('.scenecard').nth(2).click();
  await page.waitForFunction(() => !window.__sceneQA.state.seeking);
  const before = await page.evaluate(() => window.__sceneQA.state.frame);
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => [window.__sceneQA.state.frame, window.__sceneQA.sceneNav.scan]), [before, null]);
  // Resuming then replacing the file must leave no old sections or samples.
  await page.locator('#bscanscenes').click();
  await page.locator('#file').setInputFiles(path.join(__dirname, 'fixtures/scenes/07-subsecond.mp4'));
  await page.waitForFunction(() => window.__sceneQA.sceneNav.done && window.__sceneQA.sceneNav.duration < 1);
  assert.equal(await page.locator('.scenecard').count(), 1);
  // Uninstrumented page: startup, real video and responsive screenshots.
  await page.unroute(base + '/');await page.goto(base + '/');
  await page.locator('#file').setInputFiles(path.join(__dirname, 'fixtures/scenes/01-hard-cuts.mp4'));
  await page.waitForFunction(() => document.querySelector('#bscanscenes').textContent === 'Scan complete', {}, { timeout: 60000 });
  await page.locator('.scenecard').nth(1).click();await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 1000 });await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(output, 'mobile.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no mobile page overflow');
  assert.deepEqual(errors, []);assert.deepEqual(network, []);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors, externalRequests: network, cancellation: 'passed', replacement: 'passed', mobileOverflow: false }, null, 2) + '\n');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
