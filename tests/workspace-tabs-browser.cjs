'use strict';
const fs=require('fs'),assert=require('assert');
const {chromium}=require(process.env.FRAME_PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.FRAME_CHROME});
 const context=await browser.newContext({viewport:{width:390,height:844},recordVideo:{dir:'/tmp/v35-workspace-recording',size:{width:390,height:844}}});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 for(const file of ['index.html','compose.html']){
  const expose=file==='index.html'?'window.testFrame={state,goToFrame};':'window.testCompose={state};';
  const html=fs.readFileSync(file,'utf8').replace(/\}\)\(\);\s*<\/script>/,expose+'})();</script>');
  await page.route('http://127.0.0.1:8877/'+file+'*',r=>r.fulfill({contentType:'text/html',body:html}));
 }
 await page.goto('http://127.0.0.1:8877/index.html');
 await page.locator('#file').setInputFiles('tests/fixtures/scenes/01-hard-cuts.mp4');
 await page.waitForFunction(()=>testFrame.state.ready);
 await page.evaluate(()=>testFrame.goToFrame(30));await page.locator('#bmark').click();
 const source=await page.evaluate(()=>testFrame.state.url);
 assert.ok(source,'Frame source must exist');
 await page.waitForFunction(()=>!testFrame.state.seeking);
 const originalPixels=await page.locator('#stage').screenshot();
 await page.evaluate(()=>{
  window.workspaceSamples=[];window.workspaceSeeks=0;
  document.querySelector('video').addEventListener('seeking',()=>window.workspaceSeeks++);
  const tick=()=>{const n=document.querySelector('.appnav'),v=document.querySelector('video'),r=n.getBoundingClientRect(),s=getComputedStyle(n),vr=v.getBoundingClientRect();
   workspaceSamples.push([r.x,r.y,r.width,r.height,s.opacity,s.visibility,vr.width,vr.height]);requestAnimationFrame(tick);};requestAnimationFrame(tick);
 });
 await page.locator('#tabcompose').click();
 const iframe=page.frameLocator('#composeworkspace');
 await iframe.locator('#artboard').click();await iframe.locator('#artboardchoice4').click();
 await iframe.locator('#file').setInputFiles('tests/fixtures/scenes/01-hard-cuts.mp4');
 const compose=page.frames().find(f=>f.url().includes('compose.html'));
 await compose.waitForFunction(()=>testCompose.state.cells.some(c=>c&&c.ready));
 const composition=await compose.evaluate(()=>({artboard:testCompose.state.artboard,url:testCompose.state.cells[0].url}));
 assert.equal(await iframe.locator('#banner').isVisible(),false,'owned local workspace is not a restricted preview');
 assert.equal(await iframe.locator('#hdr').isVisible(),false,'Compose must not duplicate the shared navigation');
 await page.screenshot({path:'/tmp/v33-compose.png'});
 for(let i=0;i<3;i++){
  await page.locator('#tabframe').click();await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>testFrame.state.url),source);
  assert.deepEqual(await page.evaluate(()=>testFrame.state.marks),[30]);
  assert.equal(await page.evaluate(()=>testFrame.state.frame),30);
  assert.deepEqual(await page.locator('#stage').screenshot(),originalPixels,'paused video pixels survive workspace round trip');
  await page.locator('#tabcompose').click();
  assert.deepEqual(await compose.evaluate(()=>({artboard:testCompose.state.artboard,url:testCompose.state.cells[0].url})),composition);
 }
 await page.locator('#tabframe').click();
 const sizes=await page.locator('#tc').evaluate(e=>[...e.children].map(s=>getComputedStyle(s).fontSize));
 assert.equal(new Set(sizes).size,1,'whole timecode has one font size');
 assert.equal(page.context().pages().length,1,'workspace switch never opens another browser tab');
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'/tmp/v33-frame.png'});
 console.log(JSON.stringify({retainedFrame:true,retainedComposition:true,browserTabs:1,timecodeSizes:sizes,errors}));
 const samples=await page.evaluate(()=>workspaceSamples);
 assert.ok(samples.length>30);
 assert.equal(new Set(samples.map(r=>JSON.stringify(r))).size,1,'navigation and retained video geometry/visibility stay fixed on every sampled animation frame');
 assert.equal(await page.evaluate(()=>workspaceSeeks),0,'switching never seeks or discards the paused video');
 fs.writeFileSync('/tmp/v35-workspace-samples.json',JSON.stringify(samples));
 await page.goto('http://127.0.0.1:8877/compose.html');
 await page.waitForURL('**/index.html?workspace=compose');
 assert.equal(await page.locator('#tabcompose').getAttribute('aria-selected'),'true');
 assert.equal(await page.frameLocator('#composeworkspace').locator('#hdr').isVisible(),false);
 await page.locator('#tabframe').click();await page.locator('#tabcompose').click();
 console.log(JSON.stringify({animationFrames:samples.length,stable:true,standaloneUsesSharedShell:true}));
 await context.close();await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
