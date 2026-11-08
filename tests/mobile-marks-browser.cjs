'use strict';
// Phone-sized checks against the shipped app, real video seeks, and PNG exports.
// Start a server in this worktree at 8877; supply FRAME_PLAYWRIGHT_PATH/FRAME_CHROME.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.FRAME_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..');
const base=process.env.FRAME_PREVIEW_URL||'http://127.0.0.1:8877';
const output=process.env.FRAME_QA_OUTPUT||'/tmp/frame-mobile-marks-qa';
fs.mkdirSync(output,{recursive:true});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const instrumented=html.replace(/\}\)\(\);\s*<\/script>/,`window.__mobileMarks={slowSeeks(){window.originalSeek=goToFrame;goToFrame=function(n){return window.originalSeek(n).then(result=>new Promise(resolve=>setTimeout(()=>resolve(result),100)));};},normalSeeks(){goToFrame=window.originalSeek;},state,markFlow,sceneNav,goToFrame,setSections,buildSceneRanges,paintSceneCards,selectScene,setRotation,setCropToRect};\n})();\n</script>`);
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.FRAME_CHROME?{executablePath:process.env.FRAME_CHROME}:{})});
 let page;
 const errors=[],externalRequests=[],downloads=[];
 async function newPage(width,height){
 page=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1,acceptDownloads:true});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(base))externalRequests.push(r.url());});
 page.on('download',d=>downloads.push(d));
 await page.addInitScript(()=>Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true}));
 await page.route(base+'/',route=>route.fulfill({contentType:'text/html',body:instrumented}));
 }
 await newPage(390,844);
 const snapshot=()=>page.evaluate(()=>{const q=window.__mobileMarks,m=q.markFlow.state;return {marks:q.state.marks,selected:m.selected,keeper:m.keeper,pair:m.pair,current:m.current,view:m.view,candidates:m.candidates,candidateAt:m.candidateAt,zoom:m.zoom};});
 async function settled(){await page.waitForFunction(()=>{const q=window.__mobileMarks;return !q.state.seeking&&!q.markFlow.state.loading&&!q.markFlow.state.busy&&!q.markFlow.state.queueRunning;});}
 async function ready(){await page.waitForFunction(()=>{const q=window.__mobileMarks;return q.markFlow.state.frameReady&&!q.state.seeking&&!q.markFlow.state.loading;});}
 async function open(file){
   await page.goto(base+'/');
   assert.equal(await page.locator('#markworkflow').inputValue(),'board','mobile board is the default exploration');
   await page.locator('#file').setInputFiles(path.join(__dirname,'fixtures/scenes',file));
   await page.waitForFunction(()=>window.__mobileMarks.state.ready&&window.__mobileMarks.sceneNav.items.length>0);
   assert.equal(await page.locator('#markedentry').isVisible(),false,'no empty collection in the editor');
 }
 async function add(frame){
   await page.evaluate(n=>window.__mobileMarks.goToFrame(n),frame);await page.locator('#bmark').click();
   await page.waitForFunction(n=>window.__mobileMarks.state.marks.includes(n),frame);
   await page.waitForFunction(n=>!!window.__mobileMarks.markFlow.state.thumbs[n]?.url,frame);
 }
 async function board(){await page.evaluate(()=>window.__mobileMarks.markFlow.open('grid'));await settled();}
 async function inspect(frame){await board();await page.locator('#markthumb-'+frame).click();await ready();}
 async function checkLayout(name,width,height){
   assert.deepEqual(page.viewportSize(),{width,height});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>{window.__mobileMarks.markFlow.layout();requestAnimationFrame(resolve);})));
   const measurement=await page.evaluate(()=>{
     const pane=document.getElementById('markreview'),box=pane.getBoundingClientRect();
     const ids=['markclose','markback','markcompare','marksave','marksavekeeper'];
     const controls=ids.map(id=>document.getElementById(id)).filter(e=>e&&!e.hidden&&e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {id:e.id,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};});
     const overlaps=[];for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i],b=controls[j];if(Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1)overlaps.push([a.id,b.id]);}
     return {overflow:document.documentElement.scrollWidth>innerWidth,pane:{left:box.left,right:box.right,bottom:box.bottom},controls,overlaps,gridColumns:getComputedStyle(document.getElementById('markgrid')).gridTemplateColumns.split(' ').length};
   });
   assert.equal(measurement.overflow,false,name+' has no horizontal overflow at '+width);
   assert.deepEqual(measurement.overlaps,[],name+' controls do not overlap');
   assert.ok(measurement.pane.left>=-1&&measurement.pane.right<=width+1&&measurement.pane.bottom<=height+1);
   for(const control of measurement.controls){assert.ok(control.height>=44,control.id+' is a 44px target');assert.ok(control.bottom<=height+1,control.id+' stays on screen');}
   if(name==='board')assert.equal(measurement.gridColumns,width<600?2:3,'contact board fits the viewport');
   await page.screenshot({path:path.join(output,name+'-'+width+'.png')});
   return {name,width,height,...measurement};
 }
 await open('01-hard-cuts.mp4');
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.__mobileMarks.setSections(true));assert.equal(await page.evaluate(()=>!!document.getElementById('scenes')._motion),false,'reduced motion disables section animation');await page.evaluate(()=>window.__mobileMarks.setSections(false));await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>window.__mobileMarks.setSections(true));assert.equal(await page.evaluate(()=>document.getElementById('scenes')._motion.effect.getTiming().duration),180,'section expansion is eased');await page.waitForFunction(()=>!document.getElementById('scenes')._motion);await page.evaluate(()=>window.__mobileMarks.setSections(false));await page.waitForFunction(()=>!document.getElementById('scenes')._motion);
 for(const frame of [30,120,240,360])await add(frame);
 await page.evaluate(async()=>{const q=window.__mobileMarks;q.sceneNav.items=q.buildSceneRanges(16,[4,8,12]);q.setSections(true);q.paintSceneCards();q.selectScene(1);await q.goToFrame(180);});
 await page.locator('#markedentry').click();await settled();
 assert.equal((await snapshot()).view,'grid');
 assert.equal(await page.locator('#markviewer').isVisible(),false,'ready contact board gives its space to thumbnails');
 assert.equal(await page.locator('#markgrid .marktile').count(),4);
 await page.evaluate(()=>window.originalTile=document.getElementById('markthumb-30'));const boardTop=await page.locator('#markgrid').evaluate(e=>e.getBoundingClientRect().top);await page.locator('#markpick-30').click();assert.equal(await page.locator('#markgrid').evaluate(e=>e.getBoundingClientRect().top),boardTop,'first selection does not push thumbnails down');await page.locator('#markpick-240').click();assert.equal(await page.locator('#markgrid').evaluate(e=>e.getBoundingClientRect().top),boardTop,'second selection keeps thumbnails anchored');assert.ok(await page.evaluate(()=>window.originalTile===document.getElementById('markthumb-30')),'selection preserves existing thumbnail nodes');
 await page.locator('#markfilterselected').click();assert.equal(await page.locator('#markgrid .marktile').count(),2);
 await page.locator('#markfilterall').click();assert.equal(await page.locator('#markgrid .marktile').count(),4);
 const layouts=[];

 await inspect(120);await page.locator('#markpin').scrollIntoViewIfNeeded();const beforePin=await page.locator('#markviewer').boundingBox();const beforePinFooter=await page.locator('.markfooter').boundingBox();await page.locator('#markpin').click();assert.deepEqual(await page.locator('#markviewer').boundingBox(),beforePin,'pin feedback does not shift inspector');assert.deepEqual(await page.locator('.markfooter').boundingBox(),beforePinFooter,'pin keeps action area anchored');
 assert.equal((await snapshot()).keeper,120);
 assert.deepEqual((await snapshot()).selected,[30,240],'pin does not change save selection');
 await inspect(30);await page.locator('#markcompare').click();await ready();
 assert.deepEqual((await snapshot()).pair,[120,30]);
 const beforeZoom=await page.locator('#markviewer').boundingBox();await page.locator('#markzoomtools summary').click();assert.deepEqual(await page.locator('#markviewer').boundingBox(),beforeZoom,'zoom popover does not shift image');await page.locator('#markzoomrange').fill('3');
 await page.evaluate(()=>{const f=window.__mobileMarks.markFlow;f.state.zoom.x=8;f.state.zoom.y=6;f.layout();});
 const zoom=(await snapshot()).zoom;
 const renderedZoom=()=>page.locator('#video').evaluate(v=>({width:v.style.width,height:v.style.height,transform:document.getElementById('vframe').style.transform}));
 const renderedBefore=await renderedZoom();
 await page.evaluate(()=>{window.__mobileMarks.slowSeeks();window.hopSamples=[];window.hopSampling=true;function sample(){const el=document.getElementById('markviewer'),r=el.getBoundingClientRect(),c=document.getElementById('markoverlay');window.hopSamples.push([r.x,r.y,r.width,r.height,document.getElementById('markreviewbody').scrollTop,c.hidden,['markaccepta','markacceptb','marknextcandidate','markreveal','marksavekeeper'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect(),s=getComputedStyle(e);return [id,r.x,r.y,r.width,r.height,s.opacity,s.visibility,s.display];}),document.getElementById('markreview').getAttribute('data-frame-loading')]);if(window.hopSampling)requestAnimationFrame(sample);}sample();});
 await page.locator('#markshowa').click();await ready();assert.equal((await snapshot()).current,120);
 assert.deepEqual((await snapshot()).zoom,zoom,'A keeps the candidate zoom and pan');
 await page.locator('#markshowb').click();await ready();assert.equal((await snapshot()).current,30);
 assert.deepEqual((await snapshot()).zoom,zoom,'B keeps the keeper zoom and pan');
 const hopSamples=await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.hopSampling=false;window.__mobileMarks.normalSeeks();return window.hopSamples;});assert.ok(hopSamples.length>2);assert.ok(hopSamples.some(sample=>sample[7]==='true'),'measurements include the decoding interval');for(const sample of hopSamples){assert.deepEqual(sample.slice(0,5),hopSamples[0].slice(0,5),'viewer position and scroll remain stable throughout A/B');assert.equal(sample[5],false,'same canvas remains visible through loading and ready states');assert.deepEqual(sample[6],hopSamples[0][6],'bottom controls keep the same position and opacity throughout decoding');}
 assert.deepEqual(await renderedZoom(),renderedBefore,'A/B preserves rendered scale and pan, not just stored zoom');
 await page.locator('#markresetzoom').click();await page.locator('#markzoomtools summary').click();

 const revealBefore=await page.locator('#markviewer').boundingBox();await page.locator('#markreveal').click();await ready();await page.waitForFunction(()=>!document.getElementById('markrevealhandle').hidden);assert.deepEqual(await page.locator('#markviewer').boundingBox(),revealBefore,'Reveal does not reflow the viewer');assert.equal(await page.locator('#markrevealrange').count(),0,'no redundant bottom slider');for(const id of ['markshowa','markshowb'])assert.equal(await page.locator('#'+id).getAttribute('aria-pressed'),'false','neither A nor B is active in Reveal');await page.locator('#markrevealhandle').focus();for(let i=0;i<5;i++)await page.keyboard.press('ArrowLeft');const halves=await page.locator('#markoverlay').evaluate(c=>{const x=c.getContext('2d');return [.1,.75].map(p=>Array.from(x.getImageData(Math.floor(c.width*p),Math.floor(c.height/2),1,1).data));});assert.ok(halves[0][0]>halves[0][2]&&halves[1][2]>halves[1][0],'reveal shows real A on left and B on right');await page.locator('#markrevealhandle').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#markrevealhandle').getAttribute('aria-valuenow'),'30');const topPixel=await page.locator('#markoverlay').evaluate(c=>Array.from(c.getContext('2d').getImageData(Math.round(c.width*.3),1,1,1).data));assert.deepEqual(topPixel.slice(0,3),[0,0,0],'divider does not extend into top letterbox');const handleBox=await page.locator('#markrevealhandle').boundingBox(),viewerBox=await page.locator('#markviewer').boundingBox();await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);await page.mouse.down();await page.mouse.move(viewerBox.x+viewerBox.width*.6,handleBox.y+handleBox.height/2,{steps:5});await page.mouse.up();assert.ok(Math.abs(Number(await page.locator('#markrevealhandle').getAttribute('aria-valuenow'))-60)<=1,'dragging the image handle moves the divider');await page.screenshot({path:path.join(output,'reveal.png')});await page.locator('#markreveal').click();assert.deepEqual(await page.locator('#markviewer').boundingBox(),revealBefore,'leaving Reveal keeps layout stable');
 await page.locator('#markaccepta').click();await ready();
 let state=await snapshot();assert.equal(state.keeper,120);assert.deepEqual(state.pair,[120,240]);
 await page.locator('#markshowa').click();await ready();
 await page.locator('#markacceptb').click();await ready();
 state=await snapshot();assert.equal(state.keeper,240,'Promote B chooses B even while A is displayed');
 assert.deepEqual(state.selected,[30,240]);assert.deepEqual(state.marks,[30,120,240,360]);
 await page.locator('#markundo').click();await ready();
 state=await snapshot();assert.equal(state.keeper,120);assert.deepEqual(state.pair,[120,240]);assert.equal(state.current,120);
 await page.locator('#markacceptb').click();await ready();
 await page.locator('#markaccepta').click();await ready();
 state=await snapshot();assert.equal(state.view,'inspect','finite candidate review stops instead of wrapping');assert.equal(state.keeper,240);
 assert.deepEqual(state.marks,[30,120,240,360]);assert.deepEqual(state.selected,[30,240]);
 await page.locator('#markclose').click();await settled();
 assert.deepEqual(await page.evaluate(()=>[window.__mobileMarks.state.frame,window.__mobileMarks.sceneNav.active]),[180,1]);
 // Saving the pinned frame must export its pixels, even when another candidate is shown.
 await open('08-4k-cuts.mp4');
 await add(30);await add(90);
 await page.evaluate(()=>{const q=window.__mobileMarks;q.setRotation(90);q.setCropToRect({sx:100,sy:100,w:1600,h:900});});
 await page.locator('#markedentry').click();
 await page.waitForFunction(()=>window.__mobileMarks.markFlow.state.queueRunning);
 assert.equal(await page.locator('#markviewer').isVisible(),true,'thumbnail regeneration keeps the real decoder visible');
 await page.waitForFunction(()=>[30,90].every(f=>window.__mobileMarks.markFlow.state.thumbs[f]?.url));
 await settled();assert.equal(await page.locator('#markviewer').isVisible(),false,'finished thumbnail generation returns space to the board');
 await page.locator('#markpick-30').click();
 await inspect(90);await page.locator('#markpin').click();await inspect(30);await page.locator('#markcompare').click();await ready();
 assert.equal((await snapshot()).current,30);
 const downloaded=page.waitForEvent('download');await page.locator('#marksavekeeper').click();const download=await downloaded;
 await settled();const dest=path.join(output,'keeper.png');await download.saveAs(dest);
 const bytes=fs.readFileSync(dest),dimensions=[bytes.readUInt32BE(16),bytes.readUInt32BE(20)];assert.deepEqual(dimensions,[900,1600]);
 const mean=await page.evaluate(data=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{const c=document.createElement('canvas');c.width=32;c.height=32;const x=c.getContext('2d');x.drawImage(im,0,0,32,32);const d=x.getImageData(0,0,32,32).data,sum=[0,0,0];for(let i=0;i<d.length;i+=4)for(let ch=0;ch<3;ch++)sum[ch]+=d[i+ch];resolve(sum.map(v=>v/1024));};im.onerror=reject;im.src='data:image/png;base64,'+data;}),bytes.toString('base64'));
 assert.ok(mean[0]>mean[2]+10,'saved keeper is the burgundy shot, not the displayed blue challenger');
 assert.deepEqual((await snapshot()).selected,[30]);assert.equal((await snapshot()).current,30);
 assert.equal(await page.evaluate(()=>window.__mobileMarks.state.frame),30,'save restores the actual displayed source frame');
 assert.equal(await page.locator('#markreview').isVisible(),true);
 await page.screenshot({path:path.join(output,'portrait-compare.png')});
 // Replacement invalidates the pinned choice as well as marks and selection.
 await page.locator('#file').setInputFiles(path.join(__dirname,'fixtures/scenes','07-subsecond.mp4'));
 await page.waitForFunction(()=>window.__mobileMarks.state.ready&&window.__mobileMarks.sceneNav.duration<1);
 state=await snapshot();assert.equal(state.keeper,null);assert.deepEqual(state.selected,[]);assert.deepEqual(state.marks,[]);
 // Start each device size fresh: resizing a mobile Chrome compositor can produce
 // tiled fixed-layer screenshots even when DOM rects report the new viewport.
 await page.close();
 for(const [width,height] of [[320,568],[390,844],[430,932],[844,390]]){
   await newPage(width,height);await open('01-hard-cuts.mp4');
   for(const frame of [30,120,240,360])await add(frame);
   await board();await page.locator('#markpick-30').click();await page.locator('#markpick-240').click();
   layouts.push(await checkLayout('board',width,height));
   await inspect(120);layouts.push(await checkLayout('inspect',width,height));await page.locator('#markpin').scrollIntoViewIfNeeded();const beforePin=await page.locator('#markviewer').boundingBox();const beforePinFooter=await page.locator('.markfooter').boundingBox();await page.locator('#markpin').click();assert.deepEqual(await page.locator('#markviewer').boundingBox(),beforePin,'pin feedback does not shift inspector');assert.deepEqual(await page.locator('.markfooter').boundingBox(),beforePinFooter,'pin keeps action area anchored');await inspect(30);
   await page.locator('#markcompare').click();await ready();
   await page.locator('#markshowa').click();await ready();await page.locator('#markshowb').click();await ready();
   layouts.push(await checkLayout('compare',width,height));if(width>height){const picture=await page.locator('#markviewer').boundingBox();assert.ok(picture.height>180,'landscape comparison keeps a useful image area');assert.equal(await page.locator('#markreveal').isVisible(),true,'landscape retains comparison tools');}await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
 const result={workflow:'passed',selectionIndependent:'passed',finiteProgression:'passed',undo:'passed',matchedZoom:'passed',returnContext:'passed',sourceReplacement:'passed',visibleThumbnailDecoder:'passed',layouts,export:{dimensions,mean},errors,externalRequests};
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
