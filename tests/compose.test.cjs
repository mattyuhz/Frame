'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../compose.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function loadFunction(context,name){
  const found=script.match(new RegExp('  function '+name+'\\([^]*?\\n  }'));
  assert.ok(found,'shipped '+name+' exists');vm.runInContext(found[0],context);
}
function loadArtboards(context){
  const found=script.match(/  var ARTBOARDS=\[[\s\S]*?\n  \];/);
  assert.ok(found,'shipped artboard presets exist');vm.runInContext(found[0],context);return context.ARTBOARDS;
}
function setup(navigator={}){
  const notices=[],downloads=[],buttons=[];
  const context={navigator,File:require('node:buffer').File,Promise,
    pendingBlob:new Blob(['test'],{type:'image/jpeg'}),pendingName:'story.jpg',
    toastTimer:null,clearTimeout(){},statusEl:{appendChild(b){buttons.push(b);}},
    document:{createElement(){return {addEventListener(type,fn){this[type]=fn;}};}},
    say(m){notices.push(m);},closeSheet(){context.closed=true;},updateHistoryUI(){},
    downloadBlob(blob,name){downloads.push({blob,name});},allFilled(){return true;},bExport:{disabled:false},
    bShare:{addEventListener(){}}};
  vm.createContext(context);
  vm.runInContext(script.slice(script.indexOf('  var sharing=false;'),script.indexOf('  function closeSheet(){')),context);
  return {context,notices,downloads,buttons};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('Compose directly shares the prepared file once and reports Shared',async()=>{
  let resolve,calls=0;
  const {context,notices}=setup({canShare:()=>true,share:({files})=>{
    calls++;assert.equal(files[0].name,'story.jpg');return new Promise(r=>resolve=r);
  }});
  context.sharePrepared();context.sharePrepared();assert.equal(calls,1);assert.equal(context.bExport.disabled,true);
  resolve();await flush();assert.equal(notices.at(-1),'Shared');assert.equal(context.bExport.disabled,false);
});
test('Compose download fallback does not claim Photos success',()=>{
  const {context,notices,downloads}=setup();context.sharePrepared();
  assert.equal(downloads.length,1);assert.equal(notices.at(-1),'Download started');
});
test('Compose cancelled sharing is silent without a fallback download',async()=>{
  const {context,notices,downloads}=setup({canShare:()=>true,share:()=>Promise.reject({name:'AbortError'})});
  context.sharePrepared();await flush();assert.equal(notices.at(-1),'');assert.equal(downloads.length,0);
});
test('Compose activation expiry offers a fresh tap for the same prepared file',async()=>{
  let calls=0;
  const {context,buttons,downloads,notices}=setup({canShare:()=>true,share:()=>++calls===1?Promise.reject({name:'NotAllowedError'}):Promise.resolve()});
  context.sharePrepared();await flush();assert.equal(buttons[0].textContent,'Open save menu');
  buttons[0].click();await flush();assert.equal(calls,2);assert.equal(downloads.length,0);assert.equal(notices.at(-1),'Shared');
});
test('Compose unexpected share errors remain visible and restore Save',async()=>{
  const {context,notices}=setup({canShare:()=>true,share:()=>{throw new Error('failed');}});
  context.sharePrepared();await flush();assert.match(notices.at(-1),/Could not/);assert.equal(context.bExport.disabled,false);
});
function gestureSetup(){
  const handlers={};let picks=0,edits=0,updates=0;
  const cell={ready:true,w:1600,h:900,view:{cx:0.5,cy:0.5,s:2}};
  const context={state:{exporting:false,selected:-1,cells:[cell]},sharing:false,pW:300,pH:600,pickTarget:-1,historyEntries:[],historyIndex:-1,
    board:{addEventListener(name,fn){handlers[name]=fn;},getBoundingClientRect(){return {left:0,top:0};}},
    selCell:()=>cell,updateUI(){updates++;},rectsFor:()=>[{x:0,y:0,w:300,h:600}],cellCount:()=>1,
    openCellEditor(){edits++;},fileIn:{click(){picks++;}},say(){},window:{addEventListener(){}},$:()=>({addEventListener(){}})};
  vm.createContext(context);
  vm.runInContext(script.slice(script.indexOf('  var ptrs={}'),script.indexOf('  /* Focused editor')),context);
  function send(type,id,x,y,pointerType='touch'){
    const event={pointerId:id,clientX:x,clientY:y,pointerType,button:0,preventDefault(){this.prevented=true;}};
    handlers[type](event);return event;
  }
  return {context,cell,send,handlers,picks:()=>picks,edits:()=>edits,updates:()=>updates};
}
test('Compose page scrolling and cancellation neither edit nor select a cell',()=>{
  const {context,cell,send,picks,edits}=gestureSetup();
  assert.ok(!send('pointerdown',1,100,200).prevented);
  assert.ok(!send('pointermove',1,100,160).prevented);
  assert.equal(cell.view.cy,0.5);send('pointercancel',1,100,160);
  assert.equal(context.state.selected,-1);assert.equal(picks(),0);assert.equal(edits(),0);
  context.state.cells[0]=null;send('pointerdown',2,100,200);send('pointercancel',2,100,200);
  assert.equal(context.state.selected,-1);assert.equal(picks(),0);
});
test('Compose tap selects a filled cell without opening Edit; empty tap opens the picker',()=>{
  const {context,send,picks,edits}=gestureSetup();
  send('pointerdown',1,100,200);send('pointerup',1,100,200);
  assert.equal(context.state.selected,0);assert.equal(edits(),0);assert.equal(picks(),0);
  context.state.cells[0]=null;send('pointerdown',2,100,200);send('pointerup',2,100,200);
  assert.equal(context.pickTarget,0);assert.equal(picks(),1);assert.equal(edits(),0);
});
test('Compose multi-touch and mouse drags cannot accidentally recompose or act as taps',()=>{
  const {context,cell,send,picks,edits}=gestureSetup();
  send('pointerdown',1,100,200);send('pointerdown',2,200,200);
  send('pointermove',1,110,210);send('pointermove',2,220,220);
  send('pointerup',1,110,210);send('pointerup',2,220,220);
  send('pointerdown',3,100,200,'mouse');send('pointermove',3,120,220,'mouse');send('pointerup',3,120,220,'mouse');
  assert.deepEqual({...cell.view},{cx:0.5,cy:0.5,s:2});
  assert.equal(context.state.selected,-1);assert.equal(picks(),0);assert.equal(edits(),0);
});
test('Compose selection and media picking are locked during export',()=>{
  const {context,send,picks}=gestureSetup();context.state.exporting=true;context.state.cells[0]=null;
  send('pointerdown',1,100,200);send('pointerup',1,100,200);
  assert.equal(context.state.selected,-1);assert.equal(picks(),0);
});

// A seam can be smaller than a visible row if a destination edge is fractional.
// Exercise the shipped geometry, proving exact coverage rather than allowing a
// tolerance that could hide a narrow gap or overlap. Pixel rendering is tested
// separately because browser filtering is outside this geometry proof.
function geometrySetup(){
  const context={state:{layout:'2'}};
  vm.createContext(context);
  const layouts=script.match(/  var LAYOUTS=\[[\s\S]*?\n  \];/);
  assert.ok(layouts,'shipped layout definitions must be available');
  vm.runInContext(layouts[0],context);
  for(const name of ['layoutDef','cellCount','rectsFor']){
    const fn=script.match(new RegExp('  function '+name+'\\([^]*?\\n  }'));
    assert.ok(fn,'shipped '+name+' function must be available');
    vm.runInContext(fn[0],context);
  }
  return context;
}
function assertExactTiling(context,width,height){
  const rectangles=context.rectsFor(width,height);
  const where=`${context.state.layout}-cell layout at ${width}×${height}`;
  assert.equal(rectangles.length,context.cellCount(),where);
  let area=0;
  for(let i=0;i<rectangles.length;i++){
    const r=rectangles[i];
    for(const key of ['x','y','w','h']) assert.ok(Number.isInteger(r[key]),where+' has a fractional '+key);
    assert.ok(r.x>=0 && r.y>=0 && r.w>=0 && r.h>=0,where+' has a negative extent');
    assert.ok(r.x+r.w<=width && r.y+r.h<=height,where+' extends outside the frame');
    area+=r.w*r.h;
    for(let j=0;j<i;j++){
      const other=rectangles[j];
      const overlapW=Math.max(0,Math.min(r.x+r.w,other.x+other.w)-Math.max(r.x,other.x));
      const overlapH=Math.max(0,Math.min(r.y+r.h,other.y+other.h)-Math.max(r.y,other.y));
      assert.equal(overlapW*overlapH,0,where+' overlaps at cells '+j+' and '+i);
    }
  }
  // Bounded rectangles with no overlap and exactly the frame's area cannot
  // leave an uncovered row, column, corner, or subpixel strip.
  assert.equal(area,width*height,where+' leaves uncovered pixels');
}
test('Compose rectangles cover every pixel exactly across 16,384 odd/even size-layout combinations',()=>{
  const context=geometrySetup();
  for(const layout of context.LAYOUTS){
    context.state.layout=layout.id;
    for(let width=1;width<=4096;width++){
      // A coprime permutation visits every height 1..4096, including 1 px
      // frames that require some zero-size cells, without a quadratic sweep.
      const height=((width*2053)%4096)+1;
      assertExactTiling(context,width,height);
    }
  }
});
test('Compose seams remain integral at every preview width and production export size',()=>{
  const context=geometrySetup();
  for(const layout of context.LAYOUTS){
    context.state.layout=layout.id;
    for(let width=90;width<=760;width++) assertExactTiling(context,width,Math.round(width*16/9));
    for(const [width,height] of [[1080,1920],[2160,3840],[1920,1080],[4096,2160],[4032,3024],[1179,2556]]){
      assertExactTiling(context,width,height);
    }
  }
});
test('every artboard preset has exact even export dimensions and seamless coverage in every layout',()=>{
  const context=geometrySetup(),presets=loadArtboards(context);
  assert.equal(presets.length,9);
  for(const preset of presets){
    const [a,b]=preset.id.split(':').map(Number);
    assert.equal(preset.w*b,preset.h*a,preset.id+' has exact proportions');
    assert.equal(preset.w%2,0);assert.equal(preset.h%2,0);
    assert.equal(Math.min(preset.w,preset.h),1080);
    for(const layout of context.LAYOUTS){
      context.state.layout=layout.id;assertExactTiling(context,preset.w,preset.h);
      for(const width of [90,319,375,393,444,760])assertExactTiling(context,width,Math.round(width*preset.h/preset.w));
    }
  }
});

function photoPreviewSetup(){
  const context=geometrySetup(),frames=[],draws=[];
  const drawing={fillRect(...args){draws.push(['fill',...args]);},drawImage(...args){draws.push(['image',...args]);}};
  const surface={style:{},setAttribute(){},getContext(){return drawing;},parentNode:null};
  const board={className:'',children:[],appendChild(child){this.children.push(child);child.parentNode=this;}};
  Object.assign(context,{OUT_W:1080,OUT_H:1920,board,
    document:{createElement(){return surface;}},
    requestAnimationFrame(callback){frames.push(callback);},
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v))});
  context.state.cells=Array.from({length:4},()=>({kind:'image',ready:true,w:1600,h:900,el:{},view:{cx:0.5,cy:0.5,s:1}}));
  for(const name of ['visibleCells','allFilled','drawInto']){
    const fn=script.match(new RegExp('  function '+name+'\\([^]*?\\n  }'));
    assert.ok(fn,'shipped '+name+' must exist');vm.runInContext(fn[0],context);
  }
  vm.runInContext(script.slice(script.indexOf('  var photoSurface='),script.indexOf('  /* Position one cell')),context);
  return {context,surface,board,draws,frames,paint(){const callback=frames.shift();assert.ok(callback,'paint was scheduled');callback();}};
}
test('Compose all-photo preview coalesces updates and uses the exact export canvas drawing path',()=>{
  const {context,surface,board,draws,frames,paint}=photoPreviewSetup();
  context.requestPhotoPreview();context.requestPhotoPreview();context.requestPhotoPreview();
  assert.equal(frames.length,1,'multiple cell changes need one paint per animation frame');
  paint();
  assert.equal(surface.width,1080);assert.equal(surface.height,1920);
  assert.equal(board.className,'photo-preview');assert.equal(surface.style.display,'block');
  assert.equal(surface.parentNode,board);
  const images=draws.filter(draw=>draw[0]==='image');
  assert.equal(images.length,2,'only the active two cells are drawn');
  assert.deepEqual(images.map(draw=>draw.slice(-4)),[[0,0,1080,960],[0,960,1080,960]]);
  context.requestPhotoPreview();paint();
  assert.equal(board.children.length,1,'repaints reuse one surface instead of stacking canvases');
});
test('Compose partial, loading, and video layouts restore DOM preview without rasterizing live video',()=>{
  const {context,surface,board,draws}=photoPreviewSetup();
  context.paintPhotoPreview();
  for(const replacement of [null,{kind:'image',ready:false},{kind:'video',ready:true}]){
    context.state.cells[1]=replacement;
    const before=draws.length;context.paintPhotoPreview();
    assert.equal(board.className,'');assert.equal(surface.style.display,'none');
    assert.equal(draws.length,before,'DOM media stays live without a canvas video copy');
  }
});
test('Compose photo preview follows visible layouts and reattaches after rebuilding the board',()=>{
  const {context,surface,board,draws}=photoPreviewSetup();
  context.state.cells[3]={kind:'video',ready:true};
  context.state.layout='3';context.paintPhotoPreview();
  assert.equal(board.className,'photo-preview','a hidden video does not disable the photo surface');
  assert.equal(draws.filter(draw=>draw[0]==='image').length,3);
  context.state.layout='4';context.paintPhotoPreview();assert.equal(surface.style.display,'none');
  // rebuildBoard removes every child, including the reusable surface.
  surface.parentNode=null;board.children=[];context.state.layout='2';context.paintPhotoPreview();
  assert.equal(surface.parentNode,board);assert.equal(board.children.length,1);
  assert.equal(surface.style.display,'block');
});
test('Compose keeps DOM photos visible if the browser cannot allocate a canvas context',()=>{
  const {context,surface,board,draws}=photoPreviewSetup();
  surface.getContext=()=>null;
  assert.doesNotThrow(()=>context.paintPhotoPreview());
  assert.equal(board.className,'');assert.equal(surface.style.display,'none');assert.equal(draws.length,0);
});
test('photo raster preview resizes to each artboard and keeps exact export drawing destinations',()=>{
  const {context,surface,draws}=photoPreviewSetup();const presets=loadArtboards(context);
  for(const preset of presets){
    context.OUT_W=preset.w;context.OUT_H=preset.h;context.state.layout='3';draws.length=0;
    context.paintPhotoPreview();assert.equal(surface.width,preset.w);assert.equal(surface.height,preset.h);
    assert.deepEqual(draws.filter(d=>d[0]==='image').map(d=>d.slice(-4)),
      Array.from(context.rectsFor(preset.w,preset.h),r=>[r.x,r.y,r.w,r.h]));
  }
});
test('preview sizing follows every artboard without reparenting live cells and cannot change mid-export',()=>{
  const context=geometrySetup();let layouts=0,rebuilds=0;
  Object.assign(context,{stageEl:{clientWidth:393},pW:0,pH:0,boxes:[{},{}],
    layoutBoard(){layouts++;},rebuildBoard(){rebuilds++;}});
  loadFunction(context,'sizePreview');const presets=loadArtboards(context);
  for(const preset of presets)for(const width of [320,393,444,760]){
    context.OUT_W=preset.w;context.OUT_H=preset.h;context.stageEl.clientWidth=width;context.sizePreview();
    assert.equal(context.pW,width);assert.equal(context.pH,Math.round(width*preset.h/preset.w));
  }
  assert.equal(rebuilds,0,'changing only aspect moves existing boxes instead of reparenting video');assert.ok(layouts>0);
  const size=[context.pW,context.pH];context.state.exporting=true;context.stageEl.clientWidth=123;context.sizePreview();
  assert.deepEqual([context.pW,context.pH],size);
});
function editorSetup(){
  const elements=new Map(),draws=[];let updates=0,pauses=0,commits=0,restores=0;
  const make=id=>({id,style:{},handlers:{},clientWidth:540,clientHeight:500,
    addEventListener(t,f){this.handlers[t]=f;},showModal(){this.open=true;},close(){this.open=false;},focus(){},
    getBoundingClientRect(){return {left:0,top:0,width:540,height:320};},
    getContext(){return {fillRect(){},drawImage(...a){draws.push(a);}};},setPointerCapture(){}});
  const cell={kind:'image',ready:true,w:1600,h:900,el:{},view:{cx:0.5,cy:0.5,s:2}};
  const context={state:{cells:[cell],selected:0,exporting:false},sharing:false,ptrs:{},pinch:null,
    OUT_W:1080,OUT_H:1920,$:id=>{if(!elements.has(id))elements.set(id,make(id));return elements.get(id);},
    rectsFor:()=>[{x:0,y:0,w:1080,h:640}],clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    cellCount:()=>1,visibleCells:()=>[cell],videoCells:()=>[{el:{pause(){pauses++;}}}],
    document:{activeElement:{focus(){}}},window:{addEventListener(){}},cancelAnimationFrame(){},
    applyCellTransform(){},updateUI(){updates++;},updateHistoryUI(){},historyIndex:-1,
    snapshotComposition(){return {view:{...cell.view},start:cell.start,durOverride:context.state.durOverride};},
    restoreComposition(snapshot){restores++;cell.view={...snapshot.view};cell.start=snapshot.start;context.state.durOverride=snapshot.durOverride;},
    commitHistory(){commits++;}};
  vm.createContext(context);
  const clampFn=script.match(/  function clampView\([^]*?\n  }/)[0];
  vm.runInContext(clampFn+'\n'+script.slice(script.indexOf('  var editor=$(\'cropeditor\')'),script.indexOf('  /* Keep the pan inside')),context);
  return {context,elements,cell,draws,updates:()=>updates,pauses:()=>pauses,commits:()=>commits,restores:()=>restores};
}
test('cell editor opens the selected crop, pauses video playback, and Done preserves edits',()=>{
  const {context,elements,cell,draws,updates,pauses,commits,restores}=editorSetup();
  context.openCellEditor(0);assert.equal(elements.get('cropeditor').open,true);assert.equal(pauses(),1);
  const start=draws.at(-1);context.moveEditor(30,-20,1);
  assert.ok(cell.view.cx<0.5);assert.ok(cell.view.cy>0.5);assert.notEqual(draws.at(-1)[1],start[1]);
  const view={...cell.view};context.closeCellEditor();assert.equal(elements.get('cropeditor').open,false);
  assert.equal(context.editorIndex,-1);assert.deepEqual({...cell.view},view);assert.equal(updates(),1);assert.equal(commits(),1);assert.equal(restores(),0);
});
test('editor Cancel restores the opening crop and timeline state without creating history',()=>{
  const {context,elements,cell,commits,restores}=editorSetup();
  cell.start=1.5;context.state.durOverride=4;const view={...cell.view};
  context.openCellEditor(0);context.moveEditor(30,-20,1.5);cell.start=3;context.state.durOverride=2;
  elements.get('editorcancel').handlers.click();
  assert.equal(elements.get('cropeditor').open,false);assert.equal(context.editorIndex,-1);
  assert.deepEqual({...cell.view},view);assert.equal(cell.start,1.5);assert.equal(context.state.durOverride,4);
  assert.equal(commits(),0);assert.equal(restores(),1);
});
test('editor Escape cancels while a Done click commits rather than treating the event as cancellation',()=>{
  const {context,elements,cell,commits,restores}=editorSetup();const view={...cell.view};
  context.openCellEditor(0);context.moveEditor(30,-20,1);
  let prevented=false;elements.get('cropeditor').handlers.cancel({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.deepEqual({...cell.view},view);assert.equal(restores(),1);assert.equal(commits(),0);
  context.openCellEditor(0);context.moveEditor(30,-20,1);const next={...cell.view};
  elements.get('editordone').handlers.click({type:'click'});
  assert.deepEqual({...cell.view},next);assert.equal(restores(),1);assert.equal(commits(),1);
});
test('editor pinch preserves its focal source point and clamps zoom and crop bounds',()=>{
  const {context,cell}=editorSetup();context.openCellEditor(0);
  const anchor={x:300,y:170},scale=Math.max(540/1600,320/900)*cell.view.s;
  const sourceX=cell.view.cx*1600+(anchor.x-270)/scale;
  context.moveEditor(0,0,1.5,anchor,anchor);
  const nextScale=Math.max(540/1600,320/900)*cell.view.s;
  assert.ok(Math.abs(cell.view.cx*1600+(anchor.x-270)/nextScale-sourceX)<1e-8);
  context.moveEditor(100000,-100000,100);assert.equal(cell.view.s,10);
  assert.ok(cell.view.cx>=0 && cell.view.cx<=1 && cell.view.cy>=0 && cell.view.cy<=1);
  context.moveEditor(0,0,0.00001);assert.equal(cell.view.s,1);
});
test('editor one-finger drag works, cancellation clears pointers, and Reset restores fit',()=>{
  const {context,elements,cell}=editorSetup();context.openCellEditor(0);
  const handlers=elements.get('editorcanvas').handlers;
  const e=(x,y)=>({pointerId:1,clientX:x,clientY:y,button:0,preventDefault(){}});
  handlers.pointerdown(e(250,150));handlers.pointermove(e(280,170));assert.ok(cell.view.cx<0.5);
  handlers.pointercancel(e(280,170));assert.equal(Object.keys(context.editorPtrs).length,0);
  elements.get('editorreset').handlers.click();assert.deepEqual({...cell.view},{cx:0.5,cy:0.5,s:1});
});
function videoEditorSetup(){
  const elements=new Map(),events=new Map(),timers=new Map(),notices=[],captures=[];
  let timerId=0,released=null,updated=0,closed=0,time=0;const committedKinds=[];
  const video={paused:true,seeking:false,readyState:4,loop:true,style:{},
    pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},
    addEventListener(t,f){events.set(t,f);},removeEventListener(t,f){if(events.get(t)===f)events.delete(t);},
    get currentTime(){return time;},set currentTime(v){time=v;this.seeking=true;}};
  const cell={kind:'video',file:new (require('node:buffer').File)(['video'],'clip.mp4',{type:'video/mp4'}),ready:true,el:video,w:1920,h:1080,dur:12,start:0,fps:30,view:{cx:0.4,cy:0.6,s:2}};
  const context={state:{cells:[cell],selected:0,durOverride:null},editorIndex:0,OUT_W:1080,OUT_H:1920,
    $:id=>{if(!elements.has(id))elements.set(id,{style:{},handlers:{},addEventListener(t,f){this.handlers[t]=f;},setAttribute(){},appendChild(){}});return elements.get(id);},
    pad2:n=>String(n).padStart(2,'0'),clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},
    say:m=>notices.push(m),effDuration:()=>8,recalcStarts(){},closeCellEditor(){closed++;committedKinds.push(context.state.cells[0].kind);context.editorIndex=-1;context.stopVideoEditor();context.updateUI();},
    updateUI(){updated++;},updateCropControls(){},releaseCell(c){released=c;},
    document:{createElement:()=>({getContext:()=>({drawImage(...args){captures.push(args);}}),toBlob(fn){context.encode=fn;}})},
    URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},File:require('node:buffer').File,
    Image:class {set src(value){this.naturalWidth=1920;this.naturalHeight=1080;this.onload();}}};
  vm.createContext(context);
  vm.runInContext(script.slice(script.indexOf('  var editorSession=0'),script.indexOf('  // Measure displayed frames')),context);
  context.editorVideo=cell;
  const complete=()=>{video.seeking=false;events.get('seeked')?.();};
  return {context,cell,video,complete,elements,timers,notices,captures,committedKinds,released:()=>released,updated:()=>updated,closed:()=>closed};
}
test('video editor coalesces rapid frame steps and blocks capture until the latest seek decodes',()=>{
  const {context,video,complete,captures}=videoEditorSetup();
  context.stepEditorFrame(1);context.stepEditorFrame(1);context.stepEditorFrame(10);
  assert.equal(context.editorDesiredFrame,12);context.useEditorFrame();assert.equal(captures.length,0);
  complete();assert.ok(Math.abs(video.currentTime-12.5/30)<1e-10);assert.equal(context.editorSeekBusy,true);
  complete();assert.equal(context.editorSeekBusy,false);assert.equal(context.editorSeekOK,true);
  assert.equal(context.videoFrameAt(context.editorVideo,video.currentTime),12);
});
test('failed video seek cannot be used as a still or clip start',()=>{
  const {context,timers,captures,closed,notices}=videoEditorSetup();context.seekEditorFrame(90);
  [...timers.values()][0]();context.useEditorFrame();context.useEditorClip();
  assert.equal(context.editorSeekOK,false);assert.equal(captures.length,0);assert.equal(closed(),0);assert.match(notices.at(-1),/Could not load/);
});
test('Frame-style readout and ruler share the same frame index at both timeline endpoints',()=>{
  const {context,cell,elements,complete}=videoEditorSetup();context.editorVideoUI();
  assert.equal(elements.get('editorframenumber').textContent,'0');assert.equal(elements.get('editortotal').textContent,'360');
  assert.equal(elements.get('editorprogress').style.width,'0%');assert.equal(elements.get('editorframes').textContent,'00');
  context.seekEditorFrame(359);complete();
  assert.equal(elements.get('editorframenumber').textContent,'359');assert.equal(elements.get('editortimeline').value,'359');
  assert.equal(elements.get('editorprogress').style.width,'100%');assert.equal(elements.get('editorseconds').textContent,'11');
  assert.equal(elements.get('editorframes').textContent,'29');
  cell.fps=null;context.editorVideoUI();assert.equal(elements.get('editorrate').textContent,'≈ 30 fps');
});
test('closing video editor cancels queued seeks and ignores their completion',()=>{
  const {context,complete,timers,notices}=videoEditorSetup();context.seekEditorFrame(20);context.seekEditorFrame(40);
  context.stopVideoEditor();complete();assert.equal(context.editorVideo,null);assert.equal(context.editorSeekBusy,false);
  assert.equal(timers.size,0);assert.equal(notices.length,0);
});
test('Use frame preserves full resolution and crop and releases the original video only after decoding',()=>{
  const {context,cell,captures,released,updated,closed,committedKinds}=videoEditorSetup();context.useEditorFrame();
  assert.equal(captures.length,1);assert.deepEqual(captures[0].slice(1),[0,0,1920,1080]);
  assert.equal(released(),null);context.useEditorFrame();assert.equal(captures.length,1);
  context.encode(new Blob(['png'],{type:'image/png'}));
  assert.equal(context.state.cells[0].kind,'image');assert.equal(context.state.cells[0].w,1920);
  assert.deepEqual({...context.state.cells[0].view},{...cell.view});assert.equal(released(),cell);assert.equal(updated(),1);assert.equal(closed(),1);
  assert.deepEqual(committedKinds,['image'],'captured photo is installed before the editor commits one history entry');
});
test('Use clip sets the selected moment and trims composition duration to the remaining video',()=>{
  const {context,cell,video,closed}=videoEditorSetup();video.currentTime=10;video.seeking=false;context.useEditorClip();
  assert.equal(cell.start,10);assert.equal(context.state.durOverride,2);assert.equal(closed(),1);
});
test('failed still encoding leaves the video intact and permits retry',()=>{
  const {context,cell,released,notices}=videoEditorSetup();context.useEditorFrame();context.encode(null);
  assert.equal(context.state.cells[0],cell);assert.equal(released(),null);assert.equal(context.editorCapturing,false);assert.match(notices.at(-1),/Could not capture/);
});

function historySetup(){
  const elements=new Map(),releases=[],assignments=[],notices=[];
  const context={state:{layout:'2',artboard:'9:16',selected:-1,durOverride:null,cells:[null,null,null,null],exporting:false},sharing:false,
    sheet:{className:'sheet'},ptrs:{},pinch:null,winState:{active:false},editorOpen:false,
    $:id=>{if(!elements.has(id))elements.set(id,{handlers:{},addEventListener(t,f){this.handlers[t]=f;}});return elements.get(id);},
    editorIndexActive(){return context.editorOpen;},say:m=>notices.push(m),
    releaseCell(cell){if(cell){releases.push(cell);cell.released=true;}},
    assign(file,index,saved){
      context.releaseCell(context.state.cells[index]);
      const cell={kind:file.kind||'image',file,ready:true,view:{...saved.view},start:saved.start,fps:saved.fps,videoSource:context.copyVideoSource(saved.videoSource),
        el:{pause(){this.paused=true;},currentTime:0}};
      context.state.cells[index]=cell;context.state.selected=index;context.state.selectionAnchor=index;assignments.push({file,index,saved});
    },
    buildLayBar(){},sizePreview(){},rebuildBoard(){},recalcStarts(){},updateUI(){context.updateHistoryUI();}};
  vm.createContext(context);
  loadArtboards(context);
  const start=script.indexOf('  var historyEntries=');
  assert.ok(start>=0,'shipped history block exists');
  vm.runInContext(script.slice(start,script.indexOf('  /* ---------- geometry ---------- */',start)),context);
  const cell=(name,kind='image')=>({kind,ready:true,file:{name,kind},w:1600,h:900,start:0,
    view:{cx:0.5,cy:0.5,s:1},el:{pause(){this.paused=true;},currentTime:0}});
  return {context,elements,releases,assignments,notices,cell};
}
function layoutSelectionSetup(firstKind='video'){
  const fixture=historySetup(),c=fixture.context;
  vm.runInContext(script.match(/  var LAYOUTS=\[[\s\S]*?\n  \];/)[0],c);
  for(const name of ['layoutDef','cellCount','selCell','changeLayout','selectCell','drawWin','winSpan']){
    vm.runInContext(script.match(new RegExp('  function '+name+'\\([^]*?\\n  }'))[0],c);
  }
  const paint={setTransform(){},clearRect(){},strokeRect(){},fillRect(){}};
  c.window={devicePixelRatio:1};c.effDuration=()=>3;
  c.winCv={clientWidth:300,getContext:()=>paint};c.winLabel={};c.fileIn={click(){throw new Error('layout changes must not open a picker');}};
  c.state.cells[0]=fixture.cell('first',firstKind);c.state.cells[0].dur=6;
  c.state.cells[1]=fixture.cell('second','video');c.state.cells[1].dur=9;
  c.state.selected=1;c.state.selectionAnchor=1;c.commitHistory();
  return fixture;
}
function artboardSetup(){
  const fixture=historySetup(),context=fixture.context;
  vm.runInContext(script.match(/  var LAYOUTS=\[[\s\S]*?\n  \];/)[0],context);
  for(const name of ['layoutDef','cellCount','visibleCells','rectsFor','clampView'])loadFunction(context,name);
  context.editorVideo=null;context.editorIndex=-1;context.clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  context.applyArtboard();return fixture;
}
test('canvas picker highlights the active ratio, commits a choice, and dismisses without changing it',()=>{
  const {context:c,elements}=artboardSetup();
  for(const el of elements.values()){
    el.attributes={};el.setAttribute=function(k,v){this.attributes[k]=v;};el.focus=function(){c.focused=this;};
    el.showModal=function(){this.open=true;};el.close=function(){this.open=false;};
  }
  c.window={innerWidth:390,innerHeight:844};
  elements.get('artboard').getBoundingClientRect=()=>({left:130,bottom:100});
  elements.get('artboardpicker').getBoundingClientRect=()=>({width:358});
  elements.get('artboardpicker').style={};
  c.commitHistory();c.openArtboardPicker();
  assert.equal(elements.get('artboardpicker').style.top,'108px');
  assert.equal(elements.get('artboardpicker').style.left,'16px');
  const picker=elements.get('artboardpicker'),trigger=elements.get('artboard');
  assert.equal(picker.open,true);assert.equal(elements.get('artboardchoice0').attributes['aria-pressed'],'true');
  assert.equal(elements.get('artboardchoice8').hidden,true);
  elements.get('artboardlandscape').handlers.click();
  assert.equal(c.state.artboard,'16:9');
  assert.equal(elements.get('artboardchoice0').hidden,true);
  assert.equal(elements.get('artboardchoice8').hidden,false);
  assert.equal(elements.get('artboardchoice4').hidden,false);
  elements.get('artboardportrait').handlers.click();
  assert.equal(c.state.artboard,'9:16');
  elements.get('artboardchoice4').handlers.click();
  assert.equal(picker.open,false);assert.equal(c.state.artboard,'1:1');assert.equal(c.focused,trigger);
  c.openArtboardPicker();let prevented=false;picker.handlers.cancel({preventDefault(){prevented=true;}});
  assert.ok(prevented);assert.equal(picker.open,false);assert.equal(c.state.artboard,'1:1');
  assert.equal(trigger.attributes['aria-expanded'],'false');
  c.state.exporting=true;c.openArtboardPicker();assert.equal(picker.open,false);
});
test('artboard changes preserve media, crop intent, selection and captured-video provenance through Undo/Redo',()=>{
  const {context:c,cell,assignments,releases}=artboardSetup();
  const video=cell('clip','video'),still=cell('frame');
  video.view={cx:0.43,cy:0.57,s:2};still.view={cx:0.55,cy:0.48,s:3};video.start=1.25;
  still.videoSource={file:video.file,time:2.067,w:1600,h:900,dur:12,fps:null};
  c.state.cells[0]=video;c.state.cells[1]=still;c.state.selected=1;c.state.selectionAnchor=1;c.state.durOverride=4;
  const before=c.snapshotComposition();c.commitHistory();c.changeArtboard('16:9');
  assert.equal(c.OUT_W,1920);assert.equal(c.OUT_H,1080);assert.equal(c.state.artboard,'16:9');
  assert.equal(c.state.cells[0],video);assert.equal(c.state.cells[1],still);assert.equal(c.state.selected,1);
  assert.deepEqual({...video.view},{...before.cells[0].view});assert.deepEqual({...still.view},{...before.cells[1].view});
  assert.equal(c.state.durOverride,4);assert.equal(video.start,1.25);assert.equal(still.videoSource.time,2.067);
  c.stepHistory(-1);assert.equal(c.state.artboard,'9:16');assert.equal(c.OUT_W,1080);assert.equal(c.OUT_H,1920);
  c.stepHistory(1);assert.equal(c.state.artboard,'16:9');assert.equal(c.state.selectionAnchor,1);
  assert.equal(still.videoSource.file,video.file);assert.equal(assignments.length,0);assert.equal(releases.length,0);
});
test('artboard changes clamp off-edge crops, reject invalid choices and are locked during edit/export/share',()=>{
  const {context:c,cell,elements}=artboardSetup();const photo=cell('photo');photo.view={cx:0.99,cy:0.01,s:2};
  c.state.cells[0]=photo;c.commitHistory();c.changeArtboard('1:1');
  assert.ok(photo.view.cx<0.99 && photo.view.cy>0.01);assert.equal(photo.view.s,2);
  const count=c.historyEntries.length;c.changeArtboard('1:1');c.changeArtboard('unknown');assert.equal(c.historyEntries.length,count);
  for(const lock of ['export','share','edit','sheet']){
    c.state.exporting=lock==='export';c.sharing=lock==='share';c.editorOpen=lock==='edit';c.sheet.className=lock==='sheet'?'sheet on':'sheet';
    elements.get('artboard').value='16:9';c.changeArtboard('16:9');
    assert.equal(c.state.artboard,'1:1');assert.equal(elements.get('artboard').value,'1:1');assert.equal(c.historyEntries.length,count);
  }
});
test('Full and 2 up preserve a selected video and restore its timeline when the hidden cell returns',()=>{
  const {context:c}=layoutSelectionSetup();
  c.changeLayout('1');assert.equal(c.state.selected,0);assert.equal(c.state.selectionAnchor,1);
  c.drawWin();assert.notEqual(c.winLabel.textContent,'Select a video');
  c.changeLayout('2');assert.equal(c.state.selected,1);assert.equal(c.selCell(),c.state.cells[1]);
  c.drawWin();assert.match(c.winLabel.textContent,/9\.0 s total/);
  c.changeLayout('1');c.changeLayout('2');assert.equal(c.state.selected,1);
});
test('a temporary photo fallback does not forget the video; an explicit selection overrides it',()=>{
  const {context:c}=layoutSelectionSetup('image');
  c.changeLayout('1');assert.equal(c.state.selected,0);assert.equal(c.state.selectionAnchor,1);
  c.changeLayout('2');assert.equal(c.state.selected,1);
  c.changeLayout('1');c.selectCell(0);c.changeLayout('2');
  assert.equal(c.state.selected,0);assert.equal(c.state.selectionAnchor,0);
});
test('layout history restores the remembered selection after media assignment',()=>{
  const {context:c}=layoutSelectionSetup();c.changeLayout('1');c.changeLayout('2');
  c.state.cells[1]=null;c.stepHistory(-1);
  assert.equal(c.state.layout,'1');assert.equal(c.state.selected,0);assert.equal(c.state.selectionAnchor,1);
  c.stepHistory(1);assert.equal(c.state.layout,'2');assert.equal(c.state.selected,1);assert.equal(c.state.selectionAnchor,1);
});
test('layout switches tolerate empty and loading cells without opening a picker',()=>{
  const {context:c}=layoutSelectionSetup();c.state.cells[0]=null;c.state.cells[1].ready=false;
  c.changeLayout('1');assert.equal(c.state.selected,-1);assert.equal(c.state.selectionAnchor,1);
  c.changeLayout('2');assert.equal(c.state.selected,1);assert.equal(c.state.selectionAnchor,1);
  c.state.exporting=true;c.changeLayout('1');assert.equal(c.state.layout,'2');
});
test('Compose history snapshots keep immutable crop values and File references without retaining decoders',()=>{
  const {context,cell}=historySetup();const photo=cell('photo');context.state.cells[0]=photo;
  context.commitHistory();const saved=context.historyEntries[0].cells[0];
  photo.view.cx=0.7;photo.view.s=3;photo.start=2;
  assert.deepEqual({...saved.view},{cx:0.5,cy:0.5,s:1});assert.equal(saved.start,0);assert.equal(saved.file,photo.file);
  assert.equal(saved.el,undefined);assert.equal(saved.url,undefined);
});
test('Compose Undo/Redo restores source replacement, removal, crop, layout, selection, and duration',()=>{
  const {context,cell,assignments}=historySetup();const photo=cell('photo'),video=cell('video','video');
  context.commitHistory();context.state.cells[0]=photo;context.state.selected=0;context.commitHistory();
  context.state.layout='3';context.state.cells[0]=video;video.view={cx:0.3,cy:0.6,s:2};video.start=1.75;
  context.state.durOverride=4;context.commitHistory();
  context.state.cells[0]=null;context.state.durOverride=null;context.commitHistory();
  context.stepHistory(-1);
  assert.equal(context.state.cells[0].file,video.file);assert.equal(context.state.layout,'3');
  assert.equal(context.state.selected,0);assert.equal(context.state.durOverride,4);
  assert.equal(context.state.cells[0].start,1.75);assert.deepEqual({...context.state.cells[0].view},{cx:0.3,cy:0.6,s:2});
  context.stepHistory(-1);
  assert.equal(context.state.cells[0].file,photo.file);assert.equal(context.state.layout,'2');assert.equal(context.state.durOverride,null);
  context.stepHistory(-1);assert.equal(context.state.cells[0],null);assert.equal(context.state.selected,-1);
  context.stepHistory(1);context.stepHistory(1);
  assert.equal(context.state.cells[0].file,video.file);assert.equal(context.state.cells[0].start,1.75);
  assert.equal(assignments.length,4,'changed source reopens only when needed');
});
test('Compose crop-only Undo reuses the existing decoder and seeks a video to its saved start',()=>{
  const {context,cell,assignments,releases}=historySetup();const video=cell('video','video');
  context.state.cells[0]=video;context.state.selected=0;video.start=1.25;context.commitHistory();
  video.start=3;video.view.s=4;context.commitHistory();context.stepHistory(-1);
  assert.equal(context.state.cells[0],video);assert.equal(video.view.s,1);assert.equal(video.start,1.25);
  assert.equal(video.el.currentTime,1.25);assert.equal(video.el.paused,true);assert.equal(assignments.length,0);assert.equal(releases.length,0);
});
test('Compose history deduplicates selection and no-op edits, and new edits invalidate only redo',()=>{
  const {context,cell,elements}=historySetup();const photo=cell('photo');context.state.cells[0]=photo;
  context.commitHistory();context.state.selected=0;context.commitHistory();context.commitHistory();
  assert.equal(context.historyEntries.length,1,'selection is not an edit');
  photo.view.s=2;context.commitHistory();photo.view.s=3;context.commitHistory();
  context.stepHistory(-1);assert.equal(photo.view.s,2);assert.equal(elements.get('bredo').disabled,false);
  photo.view.s=4;context.commitHistory();assert.equal(context.historyEntries.length,3);assert.equal(elements.get('bredo').disabled,true);
  context.stepHistory(1);assert.equal(photo.view.s,4);context.stepHistory(-1);assert.equal(photo.view.s,2);
});
test('Compose history caps retained source snapshots at 30 and refuses stepping past either end',()=>{
  const {context,cell}=historySetup();const photo=cell('photo');context.state.cells[0]=photo;
  for(let i=0;i<45;i++){photo.start=i;context.commitHistory();}
  assert.equal(context.historyEntries.length,30);assert.equal(context.historyIndex,29);
  for(let i=0;i<50;i++)context.stepHistory(-1);
  assert.equal(context.historyIndex,0);assert.equal(photo.start,15);
  for(let i=0;i<50;i++)context.stepHistory(1);
  assert.equal(context.historyIndex,29);assert.equal(photo.start,44);
});
test('Compose history is locked during editing, sharing, export, and result sheets',()=>{
  const {context,cell,elements}=historySetup();const photo=cell('photo');context.state.cells[0]=photo;
  context.commitHistory();photo.view.s=2;context.commitHistory();
  const locks=[()=>context.state.exporting=true,()=>context.sharing=true,()=>context.editorOpen=true,()=>context.sheet.className='sheet on'];
  for(const lock of locks){
    context.state.exporting=false;context.sharing=false;context.editorOpen=false;context.sheet.className='sheet';lock();
    context.updateHistoryUI();assert.equal(elements.get('bundo').disabled,true);context.stepHistory(-1);
    assert.equal(context.historyIndex,1);assert.equal(photo.view.s,2);
  }
  context.sheet.className='sheet';context.updateHistoryUI();assert.equal(elements.get('bundo').disabled,false);
  context.stepHistory(-1);assert.equal(photo.view.s,1);
});

function sourceLifecycleSetup(){
  const setup=historySetup(),context=setup.context,media=[],timers=[],notices=[],revoked=[];
  let updates=0;
  const makeMedia=kind=>{
    const item={kind,style:{},videoWidth:1920,videoHeight:1080,duration:4,naturalWidth:1600,naturalHeight:900,
      currentTime:0,pause(){this.paused=true;},load(){},setAttribute(){},removeAttribute(){}};
    media.push(item);return item;
  };
  Object.assign(context,{MAX_STORY:60,URL:{createObjectURL:()=> 'blob:source-'+media.length,revokeObjectURL:u=>revoked.push(u)},
    Image:function(){return makeMedia('image');},document:{createElement:kind=>makeMedia(kind)},
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},observeVideoRate(){},
    say:m=>notices.push(m),clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),updateUI(){updates++;context.updateHistoryUI();}});
  vm.runInContext(script.match(/  var LAYOUTS=\[[\s\S]*?\n  \];/)[0],context);
  for(const name of ['layoutDef','cellCount','visibleCells','videoCells','windowLimit','effDuration','recalcStarts','guessKind','releaseCell','assign']){
    const fn=script.match(new RegExp('  function '+name+'\\([^]*?\\n  }'));assert.ok(fn,name+' exists');vm.runInContext(fn[0],context);
  }
  return {...setup,media,timers,notices,revoked,updates:()=>updates};
}
test('Compose Undo preserves saved clip starts while restored video metadata arrives asynchronously',()=>{
  const {context,cell,media}=sourceLifecycleSetup();
  const long=cell('long.mp4','video'),short=cell('short.mp4','video');long.dur=12;short.dur=4;
  long.start=5;context.state.cells[0]=long;context.state.cells[1]=short;context.state.selected=0;
  const saved=context.snapshotComposition();context.state.cells[1]=null;long.start=0;
  context.restoreComposition(saved);
  assert.equal(long.start,5,'a temporarily missing duration must not clamp a saved start');
  const restored=media.at(-1);restored.onloadedmetadata();
  assert.equal(context.effDuration(),4);assert.equal(long.start,5);assert.equal(context.state.cells[1].ready,true);
});
test('Compose ignores stale image load/error callbacks after replacement',()=>{
  const {context,media,notices,updates,revoked}=sourceLifecycleSetup();
  context.assign({name:'first.jpg',type:'image/jpeg'},0);const first=media.at(-1);
  context.assign({name:'second.jpg',type:'image/jpeg'},0);const second=media.at(-1),active=context.state.cells[0];
  first.onload();first.onerror();assert.equal(context.state.cells[0],active);assert.equal(active.ready,false);
  assert.equal(updates(),0);assert.equal(notices.length,0);assert.equal(revoked.length,1);
  second.onload();assert.equal(active.ready,true);assert.equal(updates(),1);
});
test('Compose ignores a stale video duration probe and error after its source was replaced',()=>{
  const {context,media,timers,notices,updates}=sourceLifecycleSetup();
  context.assign({name:'first.mp4',type:'video/mp4'},0);const video=media.at(-1);
  video.duration=Infinity;video.onloadedmetadata();assert.equal(timers.length,1);
  context.assign({name:'second.jpg',type:'image/jpeg'},0);const active=context.state.cells[0];
  timers[0]();video.onerror();assert.equal(context.state.cells[0],active);assert.equal(active.ready,false);
  assert.equal(updates(),0);assert.equal(notices.length,0);
});

test('Compose reopening the photo editor clears capture-disabled controls from a previous video session',()=>{
  const {context,elements}=editorSetup();
  for(const id of ['editordone','editorcancel','editorreset'])context.$(id).disabled=true;
  context.openCellEditor(0);
  for(const id of ['editordone','editorcancel','editorreset'])assert.equal(elements.get(id).disabled,false,id+' is usable');
});
test('Compose background media readiness cannot reparent the video out of an open editor',()=>{
  const moves=[],transforms=[],modal={name:'editorframe'};
  const video={kind:'video',ready:true,el:{parentNode:modal,className:'editor-video',currentTime:2},start:1};
  const image={kind:'image',ready:true,el:{parentNode:null}};
  const boxes=[0,1].map(index=>({setAttribute(){},appendChild(el){moves.push(index);el.parentNode=this;}}));
  const context={state:{cells:[video,image],selected:0,previewPlay:false},editorIndex:0,boxes,
    requestPhotoPreview(){},applyCellTransform:index=>transforms.push(index),document:{createElement:()=>({})}};
  vm.createContext(context);vm.runInContext(script.match(/  function syncCells\([^]*?\n  }/)[0],context);
  context.syncCells();assert.equal(video.el.parentNode,modal);assert.equal(video.el.className,'editor-video');
  assert.equal(video.el.currentTime,2);assert.deepEqual(moves,[1]);assert.deepEqual(transforms,[1]);
  context.editorIndex=-1;context.syncCells();assert.equal(video.el.parentNode,boxes[0]);assert.equal(video.el.className,'media');
  assert.deepEqual(moves,[1,0]);assert.ok(video.el.currentTime>2,'paused video gets the visible-frame seek nudge on return');
});

test('Compose selection updates the current history snapshot without a step so Undo keeps the edited cell selected',()=>{
  const {context,cell}=historySetup();const photo=cell('photo'),video=cell('video','video');
  context.state.cells[0]=photo;context.state.cells[1]=video;context.state.selected=0;
  context.cellCount=()=>2;context.fileIn={click(){throw new Error('filled selection must not pick a file');}};
  vm.runInContext(script.match(/  function selectCell\([^]*?\n  }/)[0],context);
  context.commitHistory();context.selectCell(1);
  assert.equal(context.state.selected,1);assert.equal(context.historyEntries.length,1);assert.equal(context.historyIndex,0);
  assert.equal(context.historyEntries[0].selected,1);
  context.state.cells[1]=cell('captured frame');context.commitHistory();context.stepHistory(-1);
  assert.equal(context.state.cells[1].file,video.file);assert.equal(context.state.selected,1);
  assert.equal(context.historyEntries.length,2);
});

// Run the shipped editor, source loading, and history together. The only
// simulated boundary is media decode, so tests can complete (or fail) a decode
// after Cancel and verify the original source and crop are not lost.
function reeditSetup(){
  const base=historySetup(),context=base.context,media=[],images=[],encodes=[],revoked=[],timers=new Map(),notices=[];
  let serial=0,timerId=0;
  const makeNode=id=>({id,style:{},handlers:{},attributes:{},children:[],clientWidth:540,clientHeight:620,
    addEventListener(t,f){this.handlers[t]=f;},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},
    appendChild(child){if(child.parentNode)child.parentNode.removeChild(child);this.children.push(child);child.parentNode=this;},
    removeChild(child){this.children=this.children.filter(c=>c!==child);child.parentNode=null;},
    showModal(){this.open=true;},close(){this.open=false;},focus(){},setPointerCapture(){},
    getBoundingClientRect(){return {left:0,top:0,width:540,height:480};},
    getContext(){return {fillRect(){},drawImage(){}};}});
  const makeVideo=()=>{
    const events=new Map(),v=makeNode('video');let time=0;
    Object.assign(v,{paused:true,seeking:false,readyState:0,videoWidth:1920,videoHeight:1080,duration:12,
      pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},load(){},
      addEventListener(t,f){events.set(t,f);},removeEventListener(t,f){if(events.get(t)===f)events.delete(t);},
      finishSeek(){this.seeking=false;this.readyState=4;events.get('seeked')?.();},
      finishMetadata(){this.readyState=4;this.onloadedmetadata?.();events.get('loadedmetadata')?.();},
      fail(){this.onerror?.();events.get('error')?.();}});
    Object.defineProperty(v,'currentTime',{get(){return time;},set(value){time=value;v.seeking=true;}});
    media.push(v);return v;
  };
  const makeImage=()=>{const im=makeNode('image');im.naturalWidth=1920;im.naturalHeight=1080;images.push(im);return im;};
  base.elements.clear();
  Object.assign(context,{OUT_W:1080,OUT_H:1920,MAX_STORY:60,File:require('node:buffer').File,
    $:id=>{if(!base.elements.has(id))base.elements.set(id,makeNode(id));return base.elements.get(id);},
    document:{activeElement:{focus(){}},createElement(kind){
      if(kind==='video')return makeVideo();
      const node=makeNode(kind);if(kind==='canvas')node.toBlob=cb=>encodes.push(cb);return node;
    }},Image:function(){return makeImage();},window:{addEventListener(){}},
    URL:{createObjectURL:()=> 'blob:reedit-'+(++serial),revokeObjectURL:url=>revoked.push(url)},
    setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:()=>1,cancelAnimationFrame(){},pad2:n=>String(n).padStart(2,'0'),
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),say:m=>notices.push(m),observeVideoRate(){},
    applyCellTransform(){},buildLayBar(){},rebuildBoard(){},updateUI(){context.updateHistoryUI();}});
  vm.runInContext(script.match(/  var LAYOUTS=\[[\s\S]*?\n  \];/)[0],context);
  for(const name of ['layoutDef','cellCount','visibleCells','videoCells','rectsFor','windowLimit','effDuration','recalcStarts','clampView','guessKind','releaseCell','assign']){
    const fn=script.match(new RegExp('  function '+name+'\\([^]*?\\n  }'));assert.ok(fn,name+' exists');vm.runInContext(fn[0],context);
  }
  vm.runInContext(script.slice(script.indexOf("  var editor=$('cropeditor')"),script.indexOf('  // Measure displayed frames')),context);
  context.editorIndexActive=()=>context.editorIndex>=0;
  const originalVideo=makeVideo();originalVideo.readyState=4;
  const file=new context.File(['original video'],'original.mp4',{type:'video/mp4'});
  const original={kind:'video',file,url:'blob:original',el:originalVideo,w:1920,h:1080,dur:12,start:1.25,fps:30,ready:true,view:{cx:0.5,cy:0.5,s:1.5}};
  context.state.cells[0]=original;context.state.selected=0;context.commitHistory();
  function encode(w=1920,h=1080){
    assert.ok(encodes.length,'capture requested an encoder');encodes.shift()(new Blob(['png'],{type:'image/png'}));
    const image=images.at(-1);image.naturalWidth=w;image.naturalHeight=h;image.onload();return context.state.cells[0];
  }
  function capture(){
    context.openCellEditor(0);originalVideo.finishSeek();context.useEditorFrame();return encode();
  }
  function reopen(){
    context.openCellEditor(0);const v=media.at(-1);v.finishMetadata();v.finishSeek();return v;
  }
  return {...base,context,media,images,encodes,revoked,timers,notices,original,originalVideo,encode,capture,reopen};
}

test('capturing a video frame retains its original source and reopens the same moment with video controls',()=>{
  const {context,original,capture,reopen,elements}=reeditSetup();const still=capture();
  assert.equal(still.kind,'image');assert.equal(still.videoSource.file,original.file);
  assert.equal(still.videoSource.w,1920);assert.equal(still.videoSource.h,1080);assert.equal(still.videoSource.dur,12);
  assert.equal(still.videoSource.el,undefined,'source provenance never retains a second decoder');
  const video=reopen();assert.equal(context.state.cells[0],still,'reopening does not replace the committed still');
  assert.equal(context.editorVideo.temporary,true);assert.equal(context.editorVideo.file,original.file);
  assert.ok(Math.abs(video.currentTime-still.videoSource.time)<1/30);
  assert.equal(elements.get('editorvideocontrols').className,'video-controls');
  assert.equal(elements.get('editoruseclip').disabled,false);assert.equal(elements.get('editorzoom').disabled,false);
});

test('reopened captured frame can become a moving clip at a new moment while preserving its edited crop',()=>{
  const {context,capture,reopen,original,revoked}=reeditSetup();const still=capture(),video=reopen();
  context.moveEditor(18,-12,1.2);context.seekEditorFrame(90);video.finishSeek();
  const crop={...context.editorVideo.view},temporary=context.editorVideo;
  context.useEditorClip();
  assert.equal(context.state.cells[0],temporary);assert.equal(temporary.kind,'video');assert.equal(temporary.file,original.file);
  assert.ok(Math.abs(temporary.start-90.5/30)<1e-8);assert.deepEqual({...temporary.view},crop);
  assert.ok(!temporary.temporary);assert.ok(!temporary.released);assert.equal(context.editorIndex,-1);
  assert.ok(revoked.includes(still.url));assert.ok(!revoked.includes(temporary.url),'adopted decoder remains live');
  context.stepHistory(-1);assert.equal(context.state.cells[0].file,still.file);
  assert.equal(context.state.cells[0].videoSource.file,original.file,'Undo retains the path back to the source');
});

test('Cancel discards temporary frame/crop changes and releases its decoder without changing history',()=>{
  const {context,capture,reopen,revoked,notices}=reeditSetup();const still=capture(),crop={...still.view};
  const before=context.historyEntries.length;const video=reopen(),temporary=context.editorVideo;
  context.moveEditor(20,16,1.4);context.seekEditorFrame(100);
  context.closeCellEditor(true);video.finishSeek();
  assert.equal(context.state.cells[0],still);assert.deepEqual({...still.view},crop);
  assert.equal(context.historyEntries.length,before);assert.equal(temporary.released,true);
  assert.ok(revoked.includes(temporary.url));assert.ok(!revoked.includes(still.url));
  assert.ok(!notices.some(m=>/Could not load/.test(m)),'late seek completion after Cancel is ignored');
});

test('Done on a reopened frame captures the displayed new moment and crop while keeping original video provenance',()=>{
  const {context,capture,reopen,encode,original,elements,revoked}=reeditSetup();const still=capture(),video=reopen();
  context.moveEditor(10,-8,1.3);context.seekEditorFrame(72);video.finishSeek();
  const crop={...context.editorVideo.view},temporary=context.editorVideo;
  elements.get('editordone').handlers.click();
  assert.equal(context.state.cells[0],still,'a verified replacement must be ready before the old still is released');
  const next=encode();assert.notEqual(next.file,still.file);assert.equal(next.kind,'image');
  assert.equal(next.videoSource.file,original.file);assert.ok(Math.abs(next.videoSource.time-72.5/30)<1e-8);
  assert.deepEqual({...next.view},crop);assert.ok(revoked.includes(still.url));assert.ok(revoked.includes(temporary.url));
  assert.equal(context.editorIndex,-1);assert.equal(context.historyEntries.length,3,'one committed recapture adds one history step');
});

test('failed recapture verification leaves the still and video source intact and can retry',()=>{
  const {context,capture,reopen,encode,notices,revoked}=reeditSetup();const still=capture();reopen();
  const temporary=context.editorVideo;context.useEditorFrame();encode(640,360);
  assert.equal(context.state.cells[0],still);assert.equal(context.editorVideo,temporary);
  assert.equal(context.editorCapturing,false);assert.ok(!revoked.includes(still.url));assert.ok(!temporary.released);
  assert.match(notices.at(-1),/Could not capture/);
  context.useEditorFrame();const next=encode();assert.notEqual(next,still);assert.equal(next.videoSource.file,still.videoSource.file);
});

test('source-video reopening failure falls back to crop controls and retains provenance for retry',()=>{
  const {context,capture,media,elements,revoked,notices}=reeditSetup();const still=capture();context.openCellEditor(0);
  const temporary=context.editorVideo,video=media.at(-1);video.fail();
  assert.equal(context.state.cells[0],still);assert.equal(context.editorVideo,null);assert.ok(still.videoSource.file);
  assert.equal(elements.get('editorvideocontrols').className,'video-controls hidden');
  assert.equal(elements.get('editorzoom').disabled,false);assert.equal(elements.get('editordone').disabled,false);
  assert.ok(revoked.includes(temporary.url));assert.match(notices.at(-1),/Could not|could not/);
  context.moveEditor(10,12,1.2);const crop={...still.view};elements.get('editordone').handlers.click();
  assert.deepEqual({...context.state.cells[0].view},crop);assert.equal(context.editorIndex,-1);
});

test('captured-frame provenance survives removal, Undo/Redo, and immutable history snapshots',()=>{
  const {context,capture,original}=reeditSetup();const still=capture();
  const saved=context.historyEntries.at(-1).cells[0];
  assert.notEqual(saved.videoSource,still.videoSource);assert.equal(saved.videoSource.file,original.file);
  const time=saved.videoSource.time;still.videoSource.time+=1;
  assert.equal(saved.videoSource.time,time,'later source-time changes cannot mutate old history');
  still.videoSource.time=time;context.releaseCell(still);context.state.cells[0]=null;context.commitHistory();
  context.stepHistory(-1);assert.equal(context.state.cells[0].videoSource.file,original.file);
  assert.equal(context.state.cells[0].videoSource.time,time);context.stepHistory(1);assert.equal(context.state.cells[0],null);
  context.stepHistory(-1);assert.equal(context.state.cells[0].videoSource.file,original.file);
});

test('visible zoom buttons and slider edit the photo crop and stay bounded',()=>{
  const {context,elements,cell}=editorSetup();context.openCellEditor(0);
  elements.get('editorzoomin').handlers.click();assert.ok(cell.view.s>2);
  elements.get('editorzoomout').handlers.click();assert.ok(Math.abs(cell.view.s-2)<1e-10);
  const slider=elements.get('editorzoom');slider.value='20';slider.handlers.input.call(slider);assert.equal(cell.view.s,10);
  assert.equal(elements.get('editorzoomin').disabled,true);
  slider.value='0.1';slider.handlers.input.call(slider);assert.equal(cell.view.s,1);
  assert.equal(elements.get('editorzoomout').disabled,true);
});

test('reopening an unmeasured-rate captured frame preserves its exact timestamp instead of quantizing to 30 fps',()=>{
  const {context,original,originalVideo,encode,reopen}=reeditSetup();
  original.fps=null;original.start=0.067;
  context.openCellEditor(0);originalVideo.finishSeek();assert.equal(originalVideo.currentTime,0.067);
  context.useEditorFrame();const still=encode();assert.equal(still.videoSource.time,0.067);assert.equal(still.videoSource.fps,null);
  const video=reopen();assert.equal(video.currentTime,0.067,'approximate frame numbering cannot move the selected source moment');
});

test('a pending source reopen blocks capture/clip actions and Cancel ignores late metadata and errors',()=>{
  const {context,capture,media,elements,encodes,timers,notices}=reeditSetup();const still=capture();
  context.openCellEditor(0);const temporary=context.editorVideo,video=media.at(-1);
  for(const id of ['editoruseframe','editoruseclip','editordone','editorzoom'])assert.equal(elements.get(id).disabled,true,id+' waits for source readiness');
  assert.equal(elements.get('editorcancel').disabled,false);
  context.useEditorFrame();context.useEditorClip();assert.equal(context.state.cells[0],still);assert.equal(encodes.length,0);
  context.closeCellEditor(true);video.finishMetadata();video.fail();
  assert.equal(context.editorVideo,null);assert.equal(context.state.cells[0],still);assert.equal(temporary.released,true);
  assert.equal(timers.size,0,'cancelling clears the source-load watchdog');assert.equal(notices.length,0);
});

for(const stage of ['encoding','verification'])test('source error during '+stage+' restores crop controls and ignores stale capture completion',()=>{
  const {context,capture,reopen,encodes,images,elements,notices,revoked}=reeditSetup();
  const still=capture(),video=reopen();context.useEditorFrame();
  const encoded=encodes.shift();let image;
  if(stage==='verification'){encoded(new Blob(['png'],{type:'image/png'}));image=images.at(-1);}
  video.fail();
  assert.equal(context.editorCapturing,false);assert.equal(context.editorVideo,null);
  for(const id of ['editorcancel','editordone','editorzoom','editorreset'])assert.equal(elements.get(id).disabled,false,id+' restored');
  const messages=notices.length;
  if(image){image.onload();assert.ok(revoked.includes(image.src));}
  else encoded(new Blob(['png'],{type:'image/png'}));
  assert.equal(context.state.cells[0],still);assert.equal(notices.length,messages);
  context.moveEditor(10,0,1.2);assert.ok(still.view.s>1.5,'fallback remains editable');
});

test('a promoted clip reports later media errors and Undo restores its captured frame',()=>{
  const {context,capture,reopen,notices}=reeditSetup();const still=capture(),video=reopen();
  context.useEditorClip();video.fail();assert.equal(context.state.cells[0],null);
  assert.match(notices.at(-1),/Undo/);context.stepHistory(-1);
  assert.equal(context.state.cells[0].file,still.file);
  assert.equal(context.state.cells[0].videoSource.file,still.videoSource.file);
});

function artboardExportSetup(){
  const canvases=[],draws=[],shares=[],notices=[];
  const node=()=>({removeAttribute(){},play(){return Promise.resolve();}});
  const context={OUT_W:1080,OUT_H:1920,state:{exporting:false},fmtSel:{value:'image/png'},bExport:{},
    document:{createElement(){const c={getContext:()=>({}),toBlob(fn){c.encode=fn;}};canvases.push(c);return c;}},
    drawInto(g,w,h){draws.push([w,h]);},verifyImage:()=>Promise.resolve(context.decoded),
    updateHistoryUI(){},say:m=>notices.push(m),stamp:()=> 'test',allFilled:()=>true,
    sheet:{},sheetImg:node(),sheetVid:node(),sheetInfo:{},sheetCheck:{},sheetHint:{},sheetUrl:null,
    pendingBlob:null,pendingName:'',fmtSize:()=> '1 KB',shareHint:()=> '',sharePrepared(){shares.push(context.pendingName);},
    URL:{createObjectURL:()=> 'blob:export',revokeObjectURL(){}}};
  vm.createContext(context);for(const name of ['exportStill','openSheetStill','openSheetVideo'])loadFunction(context,name);
  loadArtboards(context);return {context,canvases,draws,shares,notices};
}
test('still exports draw and verify every selected artboard using dimensions captured before encoding',async()=>{
  const {context:c,canvases,draws,shares}=artboardExportSetup();
  for(const preset of c.ARTBOARDS){
    c.OUT_W=preset.w;c.OUT_H=preset.h;c.decoded={w:preset.w,h:preset.h};c.exportStill();
    const canvas=canvases.at(-1);assert.equal(canvas.width,preset.w);assert.equal(canvas.height,preset.h);
    assert.deepEqual(draws.at(-1),[preset.w,preset.h]);assert.equal(c.state.exporting,true);
    // Even if UI dimensions change outside normal locked controls, the old
    // verified file is compared with the dimensions it was rendered at.
    c.OUT_W=2;c.OUT_H=2;canvas.encode(new Blob(['png'],{type:'image/png'}));await flush();
    assert.equal(c.state.exporting,false);assert.equal(shares.length,canvases.length);
  }
});
test('still and video export verification rejects wrong sizes and explains the selected artboard size',()=>{
  const {context:c,shares}=artboardExportSetup(),blob=new Blob(['media']);
  for(const preset of c.ARTBOARDS){
    const expected={w:preset.w,h:preset.h},wrong={w:preset.w+2,h:preset.h,dur:3};
    const previous=shares.length;c.openSheetStill(blob,'still.png',wrong,expected);
    assert.equal(shares.length,previous);assert.match(c.sheetCheck.textContent,new RegExp(preset.w+' × '+preset.h));
    c.openSheetVideo(blob,'clip.mp4',wrong,3,'video/mp4',0,0,expected);
    assert.equal(shares.length,previous);assert.match(c.sheetCheck.textContent,new RegExp(preset.w+' × '+preset.h));
    c.OUT_W=2;c.OUT_H=2;c.openSheetVideo(blob,'clip.mp4',{...expected,dur:3},3,'video/mp4',0,0,expected);
    assert.equal(shares.length,previous+1,'valid original dimensions can share even after UI dimensions change');
  }
});
