'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../compose.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function setup(navigator={}){
  const notices=[],downloads=[],buttons=[];
  const context={navigator,File:require('node:buffer').File,Promise,
    pendingBlob:new Blob(['test'],{type:'image/jpeg'}),pendingName:'story.jpg',
    toastTimer:null,clearTimeout(){},statusEl:{appendChild(b){buttons.push(b);}},
    document:{createElement(){return {addEventListener(type,fn){this[type]=fn;}};}},
    say(m){notices.push(m);},closeSheet(){context.closed=true;},
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
  const handlers={};let picks=0;
  const cell={ready:true,w:1600,h:900,view:{cx:0.5,cy:0.5,s:2}};
  const context={state:{exporting:false,selected:0,cells:[cell]},pW:300,pH:600,
    board:{addEventListener(name,fn){handlers[name]=fn;},getBoundingClientRect(){return {left:0,top:0};}},
    selCell:()=>cell,updateUI(){},rectsFor:()=>[{x:0,y:0,w:300,h:600}],
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),clampView(){},applyCellTransform(){},
    fileIn:{click(){picks++;}},say(){},window:{addEventListener(){}},$:()=>({addEventListener(){}})};
  vm.createContext(context);
  vm.runInContext(script.slice(script.indexOf('  var ptrs={}'),script.indexOf('  /* Keep the pan inside')),context);
  function send(type,id,x,y){const event={pointerId:id,clientX:x,clientY:y,pointerType:'touch',preventDefault(){this.prevented=true;}};handlers[type](event);return event;}
  return {context,cell,send,picks:()=>picks};
}
test('Compose one-finger scroll and cancellation do not pan or open the picker',()=>{
  const {context,cell,send,picks}=gestureSetup();
  assert.ok(!send('pointerdown',1,100,200).prevented);
  assert.ok(!send('pointermove',1,100,160).prevented);
  assert.equal(cell.view.cy,0.5);send('pointercancel',1,100,160);assert.equal(picks(),0);
  context.state.cells[0]=null;send('pointerdown',2,100,200);send('pointercancel',2,100,200);assert.equal(picks(),0);
});
test('Compose two-finger translation pans the picture and never acts as a tap',()=>{
  const {cell,send,picks}=gestureSetup();
  send('pointerdown',1,100,200);send('pointerdown',2,200,200);
  send('pointermove',1,110,210);send('pointermove',2,210,210);
  assert.ok(cell.view.cx<0.5 && cell.view.cy<0.5);assert.equal(cell.view.s,2);
  send('pointerup',1,110,210);send('pointerup',2,210,210);assert.equal(picks(),0);
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
function editorSetup(){
  const elements=new Map(),draws=[];let updates=0,pauses=0;
  const make=id=>({id,style:{},handlers:{},clientWidth:540,clientHeight:500,
    addEventListener(t,f){this.handlers[t]=f;},showModal(){this.open=true;},close(){this.open=false;},focus(){},
    getBoundingClientRect(){return {left:0,top:0,width:540,height:320};},
    getContext(){return {fillRect(){},drawImage(...a){draws.push(a);}};},setPointerCapture(){}});
  const cell={kind:'image',ready:true,w:1600,h:900,el:{},view:{cx:0.5,cy:0.5,s:2}};
  const context={state:{cells:[cell],selected:0,exporting:false},sharing:false,ptrs:{},pinch:null,
    OUT_W:1080,OUT_H:1920,$:id=>{if(!elements.has(id))elements.set(id,make(id));return elements.get(id);},
    rectsFor:()=>[{x:0,y:0,w:1080,h:640}],clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    cellCount:()=>1,visibleCells:()=>[cell],videoCells:()=>[{el:{pause(){pauses++;}}}],
    document:{activeElement:{focus(){}}},window:{addEventListener(){}},
    applyCellTransform(){},updateUI(){updates++;}};
  vm.createContext(context);
  const clampFn=script.match(/  function clampView\([^]*?\n  }/)[0];
  vm.runInContext(clampFn+'\n'+script.slice(script.indexOf('  var editor=$(\'cropeditor\')'),script.indexOf('  /* Keep the pan inside')),context);
  return {context,elements,cell,draws,updates:()=>updates,pauses:()=>pauses};
}
test('cell editor opens the selected crop, pauses video playback, and Done preserves edits',()=>{
  const {context,elements,cell,draws,updates,pauses}=editorSetup();
  context.openCellEditor(0);assert.equal(elements.get('cropeditor').open,true);assert.equal(pauses(),1);
  const start=draws.at(-1);context.moveEditor(30,-20,1);
  assert.ok(cell.view.cx<0.5);assert.ok(cell.view.cy>0.5);assert.notEqual(draws.at(-1)[1],start[1]);
  const view={...cell.view};context.closeCellEditor();assert.equal(elements.get('cropeditor').open,false);
  assert.equal(context.editorIndex,-1);assert.deepEqual({...cell.view},view);assert.equal(updates(),1);
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
