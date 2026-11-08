'use strict';
// Real decoder checks for the three marked-frame workflow explorations.
// Run a local server at 8876, then supply FRAME_PLAYWRIGHT_PATH/FRAME_CHROME.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.FRAME_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..');
const base=process.env.FRAME_PREVIEW_URL||'http://127.0.0.1:8876';
const output=process.env.FRAME_QA_OUTPUT||'/tmp/frame-marks-qa';
fs.mkdirSync(output,{recursive:true});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const instrumented=html.replace(/\}\)\(\);\s*<\/script>/,`window.__marksQA={state,markFlow,sceneNav,goToFrame,setFrameUI,setSections,selectScene,buildSceneRanges,paintSceneCards,setRotation,setCropToRect,cropRect};\n})();\n</script>`);
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FRAME_CHROME?{executablePath:process.env.FRAME_CHROME}:{})});
 const page=await browser.newPage({viewport:{width:1024,height:1050},acceptDownloads:true});
 const errors=[],externalRequests=[],downloads=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(base))externalRequests.push(r.url());});
 page.on('download',d=>downloads.push(d));
 await page.addInitScript(()=>Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true}));
 await page.route(base+'/',route=>route.fulfill({contentType:'text/html',body:instrumented}));
 async function open(file){
   await page.goto(base+'/');
   await page.locator('#file').setInputFiles(path.join(__dirname,'fixtures/scenes',file));
   await page.waitForFunction(()=>window.__marksQA.state.ready&&window.__marksQA.sceneNav.items.length>0);
   assert.equal(await page.locator('#markedentry').isVisible(),false,'zero marks do not expose an empty collection');
   assert.equal(await page.locator('#markstrip').isVisible(),false);
   assert.equal(await page.locator('#banner').isVisible(),false,'working local-host media has no compatibility banner');
 }
 async function add(frame){
   await page.evaluate(n=>window.__marksQA.goToFrame(n),frame);
   await page.locator('#bmark').click();
   await page.waitForFunction(n=>window.__marksQA.state.marks.includes(n),frame);
   await page.waitForFunction(()=>!window.__marksQA.state.seeking&&!window.__marksQA.markFlow.state.busy);
 }
 async function mode(value){await page.locator('#markworkflow').selectOption(value);}
 async function select(frames){await page.evaluate(frames=>{const q=window.__marksQA;q.markFlow.state.selected=[];frames.forEach(n=>q.markFlow.select(n));q.markFlow.paint();},frames);}
 async function closed(){await page.waitForFunction(()=>!window.__marksQA.markFlow.opened&&!window.__marksQA.state.seeking);}
 await open('01-hard-cuts.mp4');
 for(const n of [30,120,150,240,300,360])await add(n);
 assert.equal(await page.locator('#bmark').getAttribute('aria-pressed'),'true');
 await select([30,300]);
 for(const value of ['filmstrip','review','drawer']){
   await mode(value);
   assert.deepEqual(await page.evaluate(()=>[window.__marksQA.state.marks,window.__marksQA.markFlow.state.selected]),[[30,120,150,240,300,360],[30,300]]);
 }
 // Removing a selected mark is recoverable, including selection membership.
 await page.evaluate(()=>window.__marksQA.markFlow.remove(30));
 assert.deepEqual(await page.evaluate(()=>window.__marksQA.markFlow.state.selected),[300]);
 await page.locator('#markundoinline').click();
 assert.deepEqual((await page.evaluate(()=>window.__marksQA.markFlow.state.selected)).sort((a,b)=>a-b),[30,300]);
 // Restore exact timeline context after reviewing a mark outside its section.
 await page.evaluate(async()=>{const q=window.__marksQA;q.sceneNav.items=q.buildSceneRanges(16,[4,8,12]);q.setSections(true);q.paintSceneCards();q.selectScene(1);await q.goToFrame(180);});
 await page.locator('#markedentry').click();
 assert.equal(await page.locator('.wrap').evaluate(e=>e.inert),true,'review makes the background editor inert');
 await page.locator('#markclose').focus();await page.keyboard.press('Shift+Tab');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'marksave','focus wraps within review');
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'markclose');
 await page.locator('#markbackdrop').click({position:{x:3,y:3}});await closed();
 assert.equal(await page.locator('.wrap').evaluate(e=>e.inert),false,'closing restores editor interaction');
 await page.locator('#markedentry').click();
 await page.evaluate(()=>window.__marksQA.markFlow.inspect(30));
 await page.waitForFunction(()=>!window.__marksQA.state.seeking&&!window.__marksQA.markFlow.state.busy);
 await page.locator('#markclose').click();await closed();
 assert.deepEqual(await page.evaluate(()=>[window.__marksQA.state.frame,window.__marksQA.sceneNav.active]),[180,1]);
 // Every candidate remains available above the former twenty-mark ceiling.
 await page.evaluate(()=>{const q=window.__marksQA;q.markFlow.reset();q.state.marks=[];q.setSections(false);q.markFlow.paint();});
 for(let i=0;i<24;i++)await add(i*10);
 await page.locator('#markedentry').click();
 assert.equal(await page.locator('#markgrid').evaluate(e=>e.children.length),24);
 await page.locator('#markclose').click();await closed();
 // Audit all workflows at two narrow phone widths, including their open views.
 const layouts=[];
 for(const width of [320,390]){
   await page.setViewportSize({width,height:1000});
   for(const value of ['drawer','filmstrip','review']){
     await mode(value);
     if(value!=='filmstrip')await page.locator('#markedentry').click();
     if(value==='review'){
       await page.waitForFunction(()=>window.__marksQA.markFlow.state.frameReady);
       const reviewFrame=await page.evaluate(()=>window.__marksQA.markFlow.state.current);
       await page.locator('#markback').click();
       assert.equal(await page.locator('#markback').isVisible(),true,'Continue review is reachable from All marks');
       assert.equal(await page.locator('#markback').textContent(),'Continue review');
       await page.locator('#markback').click();
       await page.waitForFunction(()=>window.__marksQA.markFlow.state.frameReady);
       assert.equal(await page.evaluate(()=>window.__marksQA.markFlow.state.current),reviewFrame,'All marks round trip preserves review position');
     }
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,value+' page overflow at '+width);
     const overlap=await page.evaluate(()=>{
       const ids=window.__marksQA.markFlow.opened?['markclose','marksave','markcompare']:['bmark','bsave','markedentry'];
       const rects=ids.map(id=>document.getElementById(id)).filter(e=>e&&e.getClientRects().length&&!e.hidden).map(e=>({id:e.id,r:e.getBoundingClientRect()}));
       const collisions=[];for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];if(Math.min(a.r.right,b.r.right)>Math.max(a.r.left,b.r.left)&&Math.min(a.r.bottom,b.r.bottom)>Math.max(a.r.top,b.r.top))collisions.push([a.id,b.id]);}return collisions;
     });
     assert.deepEqual(overlap,[],value+' controls overlap at '+width);
     await page.screenshot({path:path.join(output,value+'-'+width+'.png'),fullPage:true});
     layouts.push({width,workflow:value,overflow:false,overlap});
     if(value!=='filmstrip'){await page.locator('#markclose').click();await closed();}
   }
 }
 // Replacing a source discards the old marks/selection and closes the viewer.
 await mode('drawer');await page.locator('#markedentry').click();
 await page.locator('#file').setInputFiles(path.join(__dirname,'fixtures/scenes','07-subsecond.mp4'));
 await page.waitForFunction(()=>window.__marksQA.state.ready&&window.__marksQA.sceneNav.duration<1);
 assert.deepEqual(await page.evaluate(()=>[window.__marksQA.state.marks,window.__marksQA.markFlow.state.selected,window.__marksQA.markFlow.opened]),[[],[],false]);
 // Capture two distinct real 4K frames with the same crop and 90-degree turn.
 await page.setViewportSize({width:1024,height:1050});await open('08-4k-cuts.mp4');
 await page.evaluate(()=>{const q=window.__marksQA;q.setRotation(90);q.setCropToRect({sx:100,sy:100,w:1600,h:900});});
 await add(30);await add(90);await mode('filmstrip');
 await page.waitForFunction(()=>[...document.querySelectorAll('#markstrip img')].length===2&&[...document.querySelectorAll('#markstrip img')].every(im=>im.complete&&im.naturalWidth>0));
 const thumbDimensions=await page.locator('#markstrip img').evaluateAll(images=>images.map(im=>[im.naturalWidth,im.naturalHeight]));
 thumbDimensions.forEach(([w,h])=>{assert.ok(Math.abs(w/h-900/1600)<.02,'thumbnail matches rotated crop');assert.ok(Math.max(w,h)<=640);});
 await select([30,90]);await mode('drawer');await page.locator('#markedentry').click();
 const downloadStart=downloads.length;
 await page.locator('#marksave').click();
 await page.waitForFunction(()=>!window.__marksQA.markFlow.state.busy,{},{timeout:30000});
 await page.waitForFunction(()=>document.querySelector('#savetoasttext').textContent.includes('Download'),{},{timeout:30000});
 assert.equal(downloads.length-downloadStart,2);
 assert.equal(await page.evaluate(()=>window.__marksQA.markFlow.opened),true,'Save selected retains review context');
 const exportDimensions=[],exportMeans=[];
 for(let i=downloadStart;i<downloads.length;i++){
   const dest=path.join(output,'selected-'+(i-downloadStart)+'.png');await downloads[i].saveAs(dest);
   const bytes=fs.readFileSync(dest),dimensions=[bytes.readUInt32BE(16),bytes.readUInt32BE(20)];assert.deepEqual(dimensions,[900,1600]);exportDimensions.push(dimensions);
   exportMeans.push(await page.evaluate(data=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{const c=document.createElement('canvas');c.width=32;c.height=32;const x=c.getContext('2d');x.drawImage(im,0,0,32,32);const d=x.getImageData(0,0,32,32).data,sum=[0,0,0];for(let i=0;i<d.length;i+=4)for(let ch=0;ch<3;ch++)sum[ch]+=d[i+ch];resolve(sum.map(v=>v/1024));};im.onerror=reject;im.src='data:image/png;base64,'+data;}),bytes.toString('base64')));
 }
 assert.ok(exportMeans[0][2]>exportMeans[0][0]+10,'first exported mark contains the blue shot');
 assert.ok(exportMeans[1][0]>exportMeans[1][2]+10,'second exported mark contains the burgundy shot');
 await page.evaluate(()=>window.__marksQA.markFlow.inspect(30));
 await page.waitForFunction(()=>window.__marksQA.markFlow.state.frameReady);
 await page.screenshot({path:path.join(output,'rotated-review.png'),fullPage:true});
 const environment=await browser.newPage();
 environment.on('pageerror',e=>errors.push(e.message));
 await environment.addInitScript(()=>Object.defineProperty(window,'origin',{value:'null',configurable:true}));
 await environment.route(base+'/',route=>route.fulfill({contentType:'text/html',body:instrumented}));
 await environment.goto(base+'/');
 assert.equal(await environment.locator('#banner').isVisible(),false,'opaque origin alone does not establish a video failure');
 await environment.locator('#file').setInputFiles({name:'unsupported.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a video')});
 await environment.locator('#banner.on').waitFor();
 await environment.locator('#file').setInputFiles(path.join(__dirname,'fixtures/scenes','07-subsecond.mp4'));
 await environment.waitForFunction(()=>window.__marksQA.state.ready&&window.__marksQA.sceneNav.items.length>0);
 assert.equal(await environment.locator('#banner').isVisible(),false,'replacing failed media clears the old compatibility message');
 await environment.close();
 assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
 const result={workflows:'passed',manyMarks:24,undo:'passed',returnContext:'passed',sourceReplacement:'passed',compatibilityBanner:'passed',layouts,thumbDimensions,exportDimensions,exportMeans,errors,externalRequests};
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
