'use strict';
// Records the complete lifecycle, including intentionally delayed asynchronous work.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {chromium}=require(process.env.FRAME_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),base=process.env.FRAME_PREVIEW_URL||'http://127.0.0.1:8877';
const width=Number(process.env.FRAME_AUDIT_WIDTH||390),height=Number(process.env.FRAME_AUDIT_HEIGHT||844);
const out=process.env.FRAME_AUDIT_OUTPUT||'/tmp/frame-transition-recordings/'+width;
fs.mkdirSync(out,{recursive:true});
const original=process.env.FRAME_SOURCE_REF?cp.execFileSync('git',['show',process.env.FRAME_SOURCE_REF+':index.html'],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,'index.html'),'utf8');
const injection=`
var auditLoad=loadFile;loadFile=function(file){auditLoad(file);var handler=video.onloadedmetadata;video.onloadedmetadata=function(){setTimeout(handler,600);};};
var auditDetect=detectFps;detectFps=function(){return auditDetect().then(v=>new Promise(r=>setTimeout(()=>r(v),900)));};
var auditSeek=goToFrame;goToFrame=function(frame){return auditSeek(frame).then(v=>new Promise(r=>setTimeout(()=>r(window.auditFailSeek?(window.auditFailSeek=false,'timeout'):v),180)));};
var auditBlob=currentBlob;currentBlob=function(snapshot){return auditBlob(snapshot).then(v=>new Promise(r=>setTimeout(()=>r(v),600)));};
window.audit={state,markFlow,goToFrame,loadFile,setSections,setRotation,video};
window.auditSamples=[];window.auditLabel='empty';
var auditStart=performance.now();
function auditTick(){var pane=markFlow.state.open,phase=document.getElementById('stage').getAttribute('data-load-phase')||(state.ready?'ready':document.getElementById('busytext').textContent==='Reading frame rate'?'detecting':'reading');
var row={t:performance.now()-auditStart,label:window.auditLabel,phase:phase,view:pane?markFlow.state.view:'editor',loading:markFlow.state.loading,rects:{}};
['viewport','tc','scrub','bmark','bsave','markedentry','markviewer','markgrid','markaccepta','markacceptb','marknextcandidate','marksavekeeper'].forEach(function(id){var e=document.getElementById(id),r=e.getBoundingClientRect(),s=getComputedStyle(e);row.rects[id]=[r.x,r.y+(pane?0:scrollY),r.width,r.height,s.opacity,s.visibility,s.display];});window.auditSamples.push(row);requestAnimationFrame(auditTick);}requestAnimationFrame(auditTick);
`;
const html=original.replace(/\}\)\(\);\s*<\/script>/,injection+'\n})();\n</script>');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.FRAME_CHROME});
 const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,acceptDownloads:true,recordVideo:{dir:out,size:{width,height}}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>!!window.auditCancelShare});Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{await new Promise(r=>setTimeout(r,500));throw new DOMException('Cancelled','AbortError');}});const native=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(cb,...args){return native.call(this,b=>setTimeout(()=>cb(b),200),...args);};});
 await page.route(base+'/audit',r=>r.fulfill({contentType:'text/html',body:html}));
 await page.goto(base+'/audit');const events=[];
 async function label(value){events.push({label:value,at:await page.evaluate(v=>{window.auditLabel=v;return performance.now();},value)});}
 async function pause(ms=350){await page.waitForTimeout(ms);}
 async function settled(){await page.waitForFunction(()=>!audit.state.seeking&&!audit.markFlow.state.loading&&!audit.markFlow.state.busy&&!audit.markFlow.state.queueRunning);}
 async function ready(){await page.waitForFunction(()=>audit.state.ready&&document.querySelector('#busy').className==='busy');await settled();}
 async function load(file){await page.locator('#file').setInputFiles(path.join(__dirname,'fixtures/scenes',file));await ready();await pause(500);}
 await pause();await label('upload-landscape');await load('01-hard-cuts.mp4');
 const loadingSamples=await page.evaluate(()=>auditSamples.filter(s=>s.label==='upload-landscape'&&(s.phase==='detecting'||s.phase==='ready')));
 const heights=loadingSamples.map(s=>s.rects.viewport[3]);const loadingShift=Math.max(...heights)-Math.min(...heights);
 const controlShifts={};for(const id of ['tc','scrub','bmark','bsave']){const ys=loadingSamples.map(s=>s.rects[id][1]);controlShifts[id]=Math.max(...ys)-Math.min(...ys);}
 const loadCheck={samples:loadingSamples.length,phases:[...new Set(loadingSamples.map(s=>s.phase))],loadingShift,controlShifts};
 if(!process.env.FRAME_LOAD_ONLY){
  await label('sections-expand-collapse');await page.locator('#edittools summary').click();await page.locator('#bsections').click();await pause(450);await page.locator('#edittools summary').click();await page.locator('#bsections').click();await pause(450);
  for(const frame of [30,120,240]){await label('mark-'+frame);await page.evaluate(n=>audit.goToFrame(n),frame);await page.locator('#bmark').click();await pause();}
  await label('duplicate-mark');await page.locator('#bmark').click();await pause(600);
  await label('board-first-selection');await page.locator('#markedentry').click();await settled();await pause();await page.locator('#markpick-30').click();await pause();await page.locator('#markpick-120').click();await pause();
  await label('selected-filter');await page.locator('#markfilterselected').click();await pause();await page.locator('#markfilterall').click();await pause();
  await label('inspect-pin');await page.locator('#markthumb-120').click();await settled();await page.locator('#markpin').click();await pause();
  await label('zoom-open-close');await page.locator('#markzoomtools summary').click();await page.locator('#markzoomrange').fill('2');await pause();await page.locator('#markresetzoom').click();await page.locator('#markzoomtools summary').click();await pause();
  await label('remove-undo');await page.locator('#markmore summary').click();await page.locator('#markremove').click();await settled();await pause();await page.locator('#markundo').click();await settled();await pause();
  await page.locator('#markback').click();await settled();await page.locator('#markthumb-30').click();await settled();await page.locator('#markcompare').click();await settled();
  await label('A-B-delayed-seek');await pause();await page.locator('#markshowa').click();await settled();await pause();await page.locator('#markshowb').click();await settled();await pause();
  await label('reveal-keyboard-toggle');await page.locator('#markreveal').click();await settled();await page.locator('#markrevealhandle').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await pause();await page.locator('#markreveal').click();await pause();
  await label('failed-seek-and-retry-simulated');await page.evaluate(()=>window.auditFailSeek=true);await page.locator('#markshowa').click();await settled();await pause(600);await page.locator('#markshowb').click();await settled();await pause();
  await label('decision-and-undo');await page.locator('#markacceptb').click();await settled();await pause();await page.locator('#markundo').click();await settled();await pause();
  await label('share-cancel-simulated');await page.evaluate(()=>window.auditCancelShare=true);await page.locator('#marksavekeeper').click();await settled();await pause(650);await page.evaluate(()=>window.auditCancelShare=false);
  await label('save-real-png');const download=page.waitForEvent('download');await page.locator('#marksavekeeper').click();const saved=await download;await saved.saveAs(path.join(out,'keeper.png'));await settled();await pause(700);
  const bytes=fs.readFileSync(path.join(out,'keeper.png'));assert.deepEqual([bytes.readUInt32BE(16),bytes.readUInt32BE(20)],await page.evaluate(()=>[audit.video.videoWidth,audit.video.videoHeight]));
  await label('return-editor');await page.locator('#markclose').click();await settled();await pause();
  await label('source-replacement-portrait');await load('06-portrait-variable-rate.mp4');await pause();
  await label('unsupported-file-error');await page.locator('#file').setInputFiles({name:'invalid.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a video')});await page.waitForFunction(()=>document.getElementById('stage').getAttribute('data-load-phase')==='error');await pause(700);
  await label('recover-short-video');await load('07-subsecond.mp4');await pause();
 }
 const samples=await page.evaluate(()=>auditSamples);fs.writeFileSync(path.join(out,'samples.json'),JSON.stringify(samples));fs.writeFileSync(path.join(out,'events.json'),JSON.stringify(events));
 const emptyToReady=samples.filter(s=>s.label==='empty'||s.label==='upload-landscape');
 for(const id of ['tc','scrub','bmark','bsave']){
  const ys=emptyToReady.map(s=>s.rects[id][1]);
  assert.ok(Math.max(...ys)-Math.min(...ys)<1,id+' moved from empty to loaded');
 }
 for(const label of ['mark-30','source-replacement-portrait']){
  const rows=samples.filter(s=>s.label===label);if(!rows.length)continue;
  for(const id of ['tc','scrub','bmark','bsave']){
   const ys=rows.map(s=>s.rects[id][1]);assert.ok(Math.max(...ys)-Math.min(...ys)<1,label+' moved '+id);
  }
 }
 const transitionChecks=[];
 for(const label of ['A-B-delayed-seek','reveal-keyboard-toggle','zoom-open-close','share-cancel-simulated','save-real-png']){
  const rows=samples.filter(s=>s.label===label);if(!rows.length)continue;
  for(const id of ['markviewer','markaccepta','markacceptb','marknextcandidate','marksavekeeper']){
   const spans=[0,1,2,3,4].map(i=>Math.max(...rows.map(s=>Number(s.rects[id][i])))-Math.min(...rows.map(s=>Number(s.rects[id][i]))));
   transitionChecks.push({label,id,samples:rows.length,spans});
  }
 }
 const video=page.video();await context.close();await video.saveAs(path.join(out,'walkthrough.webm'));await browser.close();
 const report={width,height,loadCheck,transitionChecks,errors,recording:path.join(out,'walkthrough.webm'),labels:[...new Set(samples.map(s=>s.label))]};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 for(const check of transitionChecks)assert.ok(check.spans.every((n,i)=>n<(i===4?.01:1)),check.label+' '+check.id+' changed geometry/opacity: '+check.spans);
 assert.ok(loadingSamples.length>30&&loadCheck.phases.includes('detecting')&&loadCheck.phases.includes('ready'),'both loading and ready phases are measured');assert.ok(loadingShift<1,'viewer shifts '+loadingShift+'px during frame-rate detection');for(const [id,shift] of Object.entries(controlShifts))assert.ok(shift<1,id+' shifts '+shift+'px during loading');assert.deepEqual(errors,[]);
})().catch(e=>{console.error(e);process.exit(1);});
