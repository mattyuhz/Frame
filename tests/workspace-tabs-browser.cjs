'use strict';
const fs=require('fs'),assert=require('assert');
const {chromium}=require(process.env.FRAME_PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.FRAME_CHROME});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 for(const file of ['index.html','compose.html']){
  const expose=file==='index.html'?'window.testFrame={state,goToFrame};':'window.testCompose={state};';
  const html=fs.readFileSync(file,'utf8').replace(/\}\)\(\);\s*<\/script>/,expose+'})();</script>');
  await page.route('http://127.0.0.1:8877/'+file,r=>r.fulfill({contentType:'text/html',body:html}));
 }
 await page.goto('http://127.0.0.1:8877/index.html');
 await page.locator('#file').setInputFiles('tests/fixtures/scenes/01-hard-cuts.mp4');
 await page.waitForFunction(()=>testFrame.state.ready);
 await page.evaluate(()=>testFrame.goToFrame(30));await page.locator('#bmark').click();
 const source=await page.evaluate(()=>testFrame.state.url);
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
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
