  /* Marked-frame staging workflows. All imagery comes from the visible source
     decoder. Marks remain source positions; crop and rotation apply globally. */
  var markFlow=(function(){
    var m={mode:'board',open:false,view:'grid',current:0,selected:[],pair:[],
      keeper:null,candidates:[],candidateAt:0,candidateReady:false,filter:'all',boardScroll:0,
      beforePair:'grid',returnFrame:0,returnSection:-1,thumbs:{},undo:null,
      generation:0,operation:0,queue:0,queueRunning:false,busy:false,loading:false,frameReady:false,
      message:'',zoom:{z:1,x:0,y:0},fitScale:1,focusId:''};
    var parent=null,nextSibling=null,frameStyle='',videoStyle='',returnFocus=null;
    var ptr={},pinch=null,timer=null,cancelledPreview=false,stills={},heldFrame=null,reveal=false;
    var overlay=document.createElement('canvas');overlay.id='markoverlay';node('markviewer').appendChild(overlay);
    function snapshotFrame(frame){if(video.readyState<2||video.seeking||state.frame!==frame)return;var c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;try{c.getContext('2d').drawImage(video,0,0);stills[frame]=c;Object.keys(stills).forEach(function(k){if(Number(k)!==frame&&m.pair.indexOf(Number(k))<0)delete stills[k];});}catch(_){}}
    function renderOverlay(){var box=node('markviewer'),r=cropRect(),a=stills[m.pair[0]],b=stills[m.pair[1]],held=m.loading?heldFrame:(m.view==='compare'?stills[m.current]:null);var use=reveal&&m.view==='compare'&&a&&b;node('markrevealhandle').hidden=!use;node('markrevealhandle').style.left=node('markrevealrange').value+'%';overlay.hidden=!(use||held);if(overlay.hidden||!r)return;var w=box.clientWidth,h=box.clientHeight,d=Math.min(window.devicePixelRatio||1,2);overlay.width=w*d;overlay.height=h*d;var x=overlay.getContext('2d');x.scale(d,d);function draw(c){x.save();x.translate(w/2+m.zoom.x,h/2+m.zoom.y);x.scale(m.fitScale*m.zoom.z,m.fitScale*m.zoom.z);x.rotate(state.rot*Math.PI/180);x.drawImage(c,r.sx,r.sy,r.w,r.h,-r.w/2,-r.h/2,r.w,r.h);x.restore();}x.fillStyle='#000';x.fillRect(0,0,w,h);if(use){draw(a);var cut=w*Number(node('markrevealrange').value)/100;x.save();x.beginPath();x.rect(cut,0,w-cut,h);x.clip();x.fillRect(0,0,w,h);draw(b);x.restore();x.fillStyle='#fff';x.fillRect(cut-1,0,2,h);}else draw(held);}
    function enableReveal(){if(m.loading||m.busy||saving)return;reveal=!reveal;if(reveal&&m.pair.length===2&&!stills[m.pair[0]]){var backFrame=m.current;inspect(m.pair[0],'compare').then(function(){if(m.open&&m.view==='compare')return inspect(backFrame,'compare');});}paint();}
    function node(id){return $(id);}
    function list(){return state.marks.slice().sort(function(a,b){return a-b;});}
    function validMode(mode){return mode==='board'||mode==='drawer'||mode==='filmstrip'||mode==='review';}
    function elapsed(frame){
      var ms=Math.round(frame/state.fps*1000),sec=Math.floor(ms/1000);
      return (sec>=3600?Math.floor(sec/3600)+':':'')+pad(Math.floor(sec/60)%60)+':'+pad(sec%60)+'.'+String(ms%1000).padStart(3,'0');
    }
    function contains(frame){return state.marks.indexOf(frame)>=0;}
    function selected(frame){return m.selected.indexOf(frame)>=0;}
    function sanitize(){m.selected=m.selected.filter(contains);if(!contains(m.keeper))m.keeper=null;if(!m.selected.length)m.filter='all';}
    function status(text){m.message=text||'';node('markstatus').textContent=m.message;}
    function transformKey(){var r=cropRect();return JSON.stringify([r&&r.sx,r&&r.sy,r&&r.w,r&&r.h,state.rot]);}
    function releaseThumb(frame){var old=m.thumbs[frame];if(old&&old.url)URL.revokeObjectURL(old.url);delete m.thumbs[frame];}
    function invalidateThumbs(){Object.keys(m.thumbs).forEach(releaseThumb);}
    function button(text,cls,action){var b=document.createElement('button');b.type='button';b.className=cls;b.textContent=text;b.addEventListener('click',action);return b;}
    function image(frame){
      var record=m.thumbs[frame],im;
      if(record&&record.url&&record.key===transformKey()){
        im=document.createElement('img');im.src=record.url;im.alt='';
      }else{im=document.createElement('span');im.className='markplaceholder';im.textContent='Preview';}
      return im;
    }
    function makeCard(frame){
      var tile=document.createElement('div');tile.className='marktile';tile.setAttribute('data-keeper',String(m.keeper===frame));
      var thumb=button('','markthumb',function(){inspect(frame);});thumb.id='markthumb-'+frame;
      thumb.setAttribute('aria-label','Inspect marked frame at '+elapsed(frame));thumb.appendChild(image(frame));tile.appendChild(thumb);
      if(m.mode==='board'&&m.keeper===frame){var badge=document.createElement('span');badge.className='markkeeper';badge.textContent='Keeper';tile.appendChild(badge);}
      var foot=document.createElement('div');foot.className='marktilefoot';
      var time=document.createElement('span');time.textContent=elapsed(frame);foot.appendChild(time);
      var pick=button(selected(frame)?'✓':'○','markpick',function(){select(frame);});pick.id='markpick-'+frame;
      pick.setAttribute('aria-label','Select frame at '+elapsed(frame));pick.setAttribute('aria-pressed',String(selected(frame)));pick.disabled=m.busy||saving;
      foot.appendChild(pick);tile.appendChild(foot);return tile;
    }
    function show(id,on){node(id).hidden=!on;}
    function onFrame(){
      var marked=contains(state.frame);btns.bmark.textContent=marked?'✓ Marked':'Mark';
      btns.bmark.setAttribute('aria-pressed',String(marked));
      if(m.open)node('marktime').textContent=elapsed(state.frame);
      var buttons=node('markstrip').children;
      for(var i=0;i<buttons.length;i++)buttons[i].setAttribute('aria-current',String(Number(buttons[i].getAttribute('data-frame'))===state.frame));
    }
    function paint(){
      sanitize();var frames=list(),active=document.activeElement;
      if(m.open&&active&&node('markreview').contains(active)&&active.id)m.focusId=active.id;
      var grid=node('markgrid'),body=node('markreviewbody'),scroll=body.scrollTop||0;
      node('markworkflow').value=m.mode;
      node('markedentry').hidden=!frames.length;
      node('markedentry').textContent=m.mode==='review'?'Review '+frames.length+' marked frame'+(frames.length===1?'':'s'):'Marked frames · '+frames.length;
      node('markedentry').setAttribute('aria-expanded',String(m.open));
      node('markedentry').disabled=!state.ready||m.busy||saving;
      var strip=node('markstrip');strip.textContent='';strip.hidden=m.mode!=='filmstrip'||!frames.length;
      if(!strip.hidden)frames.forEach(function(frame){
        var b=button('','markstripitem',function(){jump(frame);});b.appendChild(image(frame));
        var t=document.createElement('span');t.textContent=elapsed(frame);b.appendChild(t);
        b.setAttribute('data-frame',String(frame));b.setAttribute('aria-label','Go to marked frame at '+elapsed(frame));
        b.disabled=m.busy||saving;strip.appendChild(b);
      });
      node('markreview').hidden=!m.open;node('markreview').className=m.open?'markreview on':'markreview';
      if(node('markbackdrop'))node('markbackdrop').hidden=!m.open;
      var editor=document.querySelector('.wrap');
      if(editor){if(m.open)editor.setAttribute('inert','');else editor.removeAttribute('inert');}
      node('markreview').setAttribute('data-mode',m.mode);node('markreview').setAttribute('data-view',m.view);
      node('markreview').setAttribute('aria-busy',String(m.busy||m.loading));
      node('markreview').setAttribute('data-frame-loading',String(m.loading));
      node('markworkflow').disabled=m.busy||saving;
      show('markundo',!!m.undo);if(node('markundoinline'))show('markundoinline',!!m.undo&&!m.open);
      if(node('markundoinline'))node('markundoinline').disabled=m.busy||saving;
      node('markundo').disabled=m.busy||saving;node('markundo').textContent=m.undo&&m.undo.type==='decision'?'Undo decision':m.undo&&m.undo.type==='pin'?'Undo pin':'Undo remove';if(node('markundoinline'))node('markundoinline').textContent=node('markundo').textContent;
      if(m.open){
        var board=m.mode==='board',reviewing=m.view==='review',comparing=m.view==='compare',inspecting=m.view==='inspect',isGrid=m.view==='grid';
        var shown=board&&m.filter==='selected'?frames.filter(selected):frames;
        var gridKey=JSON.stringify([shown,m.selected,m.keeper,m.mode,shown.map(function(f){return m.thumbs[f]&&m.thumbs[f].url;})]);
        if(isGrid&&m.gridKey!==gridKey){grid.textContent='';shown.forEach(function(frame){grid.appendChild(makeCard(frame));});m.gridKey=gridKey;}body.scrollTop=scroll;
        show('markgrid',isGrid);show('markinspect',!isGrid);show('markimage',false);show('markreveal',comparing);show('markrevealrange',comparing&&reveal);node('markreveal').textContent=reveal?'A/B':'Reveal';show('markmore',!isGrid&&!comparing);show('markzoomtools',!isGrid);node('markzoomrange').value=m.zoom.z;
        show('markviewer',!board||!isGrid||m.queueRunning||m.busy);
        show('markfilters',board&&isGrid);
        node('markfilterall').setAttribute('aria-pressed',String(m.filter==='all'));
        node('markfilterselected').setAttribute('aria-pressed',String(m.filter==='selected'));
        node('markfilterselected').textContent='Selected · '+m.selected.length;
        node('marktitle').textContent=comparing?(board?'Compare':'Compare two frames'):reviewing?'Review '+Math.max(1,frames.indexOf(m.current)+1)+' of '+frames.length:'Marked frames · '+frames.length;
        show('markprev',!isGrid&&!comparing);show('marknext',!isGrid&&!comparing);
        node('markprev').disabled=m.busy||saving||frames.indexOf(m.current)<=0;
        node('marknext').disabled=m.busy||saving||frames.indexOf(m.current)>=frames.length-1;
        show('markkeep',reviewing||comparing&&!board);node('markkeep').textContent=comparing?'Keep both':'Keep';
        show('markskip',reviewing);show('markremove',!isGrid&&!comparing);
        show('markselect',inspecting||comparing&&!board);node('markselect').textContent=comparing?'Keep this one':selected(m.current)?'Selected':'Select to save';
        node('markselect').setAttribute('aria-pressed',String(selected(m.current)));
        show('markflip',comparing&&!board);show('markfit',false);show('markactual',false);
        show('markpin',board&&inspecting);node('markpin').textContent=m.keeper===m.current?'Unpin keeper':'Pin as keeper';
        node('markpin').setAttribute('aria-pressed',String(m.keeper===m.current));
        ['markab','markdecisions','markshowa','markshowb','markaccepta','markacceptb','marknextcandidate','markpairinfo'].forEach(function(id){show(id,board&&comparing);});
        node('markshowa').setAttribute('aria-pressed',String(m.current===m.pair[0]));node('markshowa').textContent=m.pair[0]===m.keeper?'A · Keeper':'A · Candidate';
        node('markshowb').setAttribute('aria-pressed',String(m.current===m.pair[1]));
        node('markpairinfo').textContent=board&&comparing&&m.pair.length===2?(m.current===m.pair[0]?(m.pair[0]===m.keeper?'A · Keeper':'A · Candidate'):'B · Candidate')+' · '+elapsed(m.current)+' · '+(m.candidateAt+1)+' of '+m.candidates.length:'';
        if(comparing&&reveal)node('markpairinfo').textContent='A on the left · B on the right';
        show('markback',!isGrid||m.mode==='review');node('markback').textContent=isGrid?'Continue review':board?'All marks':comparing?'Back to review':'All marks';
        show('markcompare',board?!comparing&&frames.length>1:isGrid||reviewing);
        var selectedPair=isGrid&&m.selected.length===2;
        node('markcompare').textContent=board?(selectedPair?'Compare 2':inspecting&&m.current!==m.keeper?'Compare with keeper':'Compare candidates'):reviewing?'Compare with last keeper':'Compare 2';
        node('markcompare').disabled=m.busy||saving||m.loading||(board?(!isGrid&&!m.frameReady)||(!selectedPair&&m.keeper===null):reviewing?!m.selected.some(function(f){return f!==m.current;}):m.selected.length!==2);
        show('marksave',!board||isGrid||inspecting&&m.current!==m.keeper);node('marksave').textContent='Save selected'+(m.selected.length?' · '+m.selected.length:'');
        node('marksave').disabled=!m.selected.length||m.busy||saving||m.loading;
        show('marksavekeeper',board&&m.keeper!==null&&(comparing&&m.pair[0]===m.keeper||inspecting&&m.current===m.keeper));node('marksavekeeper').disabled=m.busy||saving||m.loading;
        ['markkeep','markskip','markselect','markflip','markpin','markaccepta','markacceptb'].forEach(function(id){node(id).disabled=m.busy||saving||m.loading||(!isGrid&&!m.frameReady);});
        if(board&&comparing&&!m.candidateReady){node('markaccepta').disabled=true;node('markacceptb').disabled=true;}
        // A failed B seek can still be retried via A/B or skipped; it cannot be promoted.
        ['markshowa','markshowb','marknextcandidate'].forEach(function(id){node(id).disabled=m.busy||saving||m.loading;});
        ['markfilterall','markfilterselected','markclose','markback','markremove','markfit','markactual'].forEach(function(id){node(id).disabled=m.busy||saving;});
        node('markviewer').setAttribute('aria-busy',String(m.loading));node('markviewer').style.opacity='1';
        if(node('markcompare').disabled)show('markcompare',false);if(!m.selected.length)show('marksave',false);
        node('markstatus').textContent=m.message;
        layout();
      }
      onFrame();
      if(m.open&&m.focusId){var focus=node(m.focusId);if(focus&&!focus.hidden&&!focus.disabled&&node('markreview').contains(focus)&&(!focus.getClientRects||focus.getClientRects().length)&&typeof focus.focus==='function')focus.focus({preventScroll:true});}
    }
    function drawThumb(frame){
      var r=cropRect();if(!r||video.readyState<2)return Promise.resolve(null);
      var key=transformKey(),source=state.url,generation=m.generation,record={url:null,key:key};
      var swap=state.rot===90||state.rot===270,scale=Math.min(1,320/Math.max(r.w,r.h));
      var canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round((swap?r.h:r.w)*scale));canvas.height=Math.max(1,Math.round((swap?r.w:r.h)*scale));
      var ctx=canvas.getContext('2d');if(!ctx)return Promise.resolve(null);
      try{ctx.translate(canvas.width/2,canvas.height/2);if(state.rot)ctx.rotate(state.rot*Math.PI/180);
        ctx.drawImage(video,r.sx,r.sy,r.w,r.h,-r.w*scale/2,-r.h*scale/2,r.w*scale,r.h*scale);
      }catch(_){return Promise.resolve(null);}
      releaseThumb(frame);m.thumbs[frame]=record;
      return new Promise(function(resolve){function finish(blob){
        if(!blob||generation!==m.generation||source!==state.url||!contains(frame)||m.thumbs[frame]!==record||key!==transformKey()){resolve(null);return;}
        try{record.url=URL.createObjectURL(blob);}catch(_){resolve(null);return;}
        paint();resolve(record.url);
      }
      try{canvas.toBlob(finish,'image/jpeg',0.8);}catch(_){resolve(null);}
      });
    }
    function captureMarked(frame){
      var generation=m.generation,source=state.url;
      var ready=!state.seeking&&!video.seeking&&state.frame===frame?Promise.resolve('ready'):goToFrame(frame);
      return ready.then(function(how){
        if(generation!==m.generation||source!==state.url||!contains(frame)||state.frame!==frame||state.seeking||video.seeking||['ready','seeked','frame'].indexOf(how)<0)return null;
        return drawThumb(frame);
      });
    }
    function interrupt(){m.operation++;m.queue++;m.queueRunning=false;m.loading=false;if(timer!==null){clearTimeout(timer);timer=null;}return m.open;}
    function queueThumbs(){
      if(m.queueRunning||!m.open||m.view!=='grid'||!state.ready||saving||m.busy||document.hidden||!video.paused||state.seeking)return;
      var frames=list().filter(function(f){var it=m.thumbs[f];return !it||!it.url||it.key!==transformKey();});
      if(!frames.length)return;
      node('markreviewbody').scrollTop=0;
      var token=++m.queue,generation=m.generation,source=state.url,anchor=state.frame,section=sceneNav.active,i=0;
      m.queueRunning=true;paint();
      function live(){return token===m.queue&&generation===m.generation&&source===state.url&&!saving&&!m.busy&&!document.hidden;}
      function next(){
        if(!live()){return;}
        if(i>=frames.length){
          return goToFrame(anchor).then(function(){if(!live())return;m.queueRunning=false;sceneNav.active=section;paintSceneFocus();status('');paint();});
        }
        var frame=frames[i++];if(!contains(frame)){next();return;}
        status('Preparing previews · '+i+' of '+frames.length);
        goToFrame(frame).then(function(how){
          if(!live())return;
          if(['seeked','frame'].indexOf(how)<0||state.frame!==frame||state.seeking||video.seeking){m.queueRunning=false;status('Some previews are unavailable. Open a frame to try again.');paint();return;}
          return drawThumb(frame).then(function(){if(live())timer=setTimeout(function(){timer=null;next();},20);});
        });
      }
      next();
    }
    function scheduleThumbs(){if(timer!==null)clearTimeout(timer);timer=setTimeout(function(){timer=null;queueThumbs();},100);}
    function toggle(){
      if(!state.ready||saving||m.busy)return;
      interrupt();closeBoundaryReview(true);cancelSceneScan(true);video.pause();
      var frame=state.frame;if(contains(frame)){saveToast('Already marked');return;}
      state.marks.push(frame);state.marks.sort(function(a,b){return a-b;});m.undo=null;paint();
      captureMarked(frame).then(function(){if(m.mode==='filmstrip')scheduleThumbs();});
    }
    function remove(frame){
      if(saving||m.busy)return;frame=typeof frame==='number'?frame:m.current;
      var index=state.marks.indexOf(frame);if(index<0)return;
      interrupt();m.undo={type:'remove',frame:frame,selected:selected(frame),keeper:m.keeper};if(m.keeper===frame)m.keeper=null;state.marks.splice(index,1);m.selected=m.selected.filter(function(f){return f!==frame;});releaseThumb(frame);
      var frames=list();status('Mark removed.');
      if(!frames.length){if(m.open)close();paint();return;}
      if(m.current===frame)m.current=frames[Math.min(index,frames.length-1)];
      if(m.open&&m.view!=='grid')inspect(m.current,m.view==='review'?'review':'inspect');else paint();
    }
    function decisionSnapshot(type){return {type:type,keeper:m.keeper,pair:m.pair.slice(),candidates:m.candidates.slice(),candidateAt:m.candidateAt,candidateReady:m.candidateReady,current:m.current,view:m.view,beforePair:m.beforePair,zoom:{z:m.zoom.z,x:m.zoom.x,y:m.zoom.y}};}
    function undo(){
      if(!m.undo||saving||m.busy)return;var old=m.undo;m.undo=null;
      if(old.type==='decision'||old.type==='pin'){
        m.keeper=contains(old.keeper)?old.keeper:null;m.pair=old.pair.filter(contains);m.candidates=old.candidates.filter(contains);m.candidateAt=old.candidateAt;m.candidateReady=old.candidateReady;m.beforePair=old.beforePair;
        m.zoom=old.zoom;
        if(m.open&&contains(old.current))return inspectNotice(old.current,old.view,'Decision undone.');
        status('Decision undone.');paint();return;
      }
      if(!contains(old.frame))state.marks.push(old.frame);state.marks.sort(function(a,b){return a-b;});
      if(old.selected&&!selected(old.frame))m.selected.push(old.frame);m.keeper=old.keeper;
      status('Mark restored.');paint();
      if(state.frame===old.frame&&!state.seeking&&!video.seeking)captureMarked(old.frame);
      scheduleThumbs();
    }
    function setFilter(filter){if(saving||m.busy||m.view!=='grid')return;m.filter=filter==='selected'?'selected':'all';m.boardScroll=0;node('markreviewbody').scrollTop=0;paint();}
    function pin(){
      if(m.mode!=='board'||saving||m.busy||m.loading||!m.frameReady||!contains(m.current))return;
      m.undo=decisionSnapshot('pin');m.keeper=m.keeper===m.current?null:m.current;
      status(m.keeper===null?'Keeper unpinned.':'Keeper pinned. Your save selection is unchanged.');paint();
    }
    function select(frame){if(!contains(frame)||saving||m.busy||(m.open&&m.view!=='grid'&&!m.frameReady))return;interrupt();var i=m.selected.indexOf(frame);if(i<0)m.selected.push(frame);else m.selected.splice(i,1);status('');paint();}
    function setMode(mode){
      if(!validMode(mode)||saving||m.busy)return Promise.resolve();
      var done=m.open?close():Promise.resolve();m.mode=mode;
      try{if(location.hash!=='#'+mode)history.replaceState(null,'','#'+mode);}catch(_){}
      paint();return done.then(function(){if(m.mode==='filmstrip')scheduleThumbs();});
    }
    function mount(){
      parent=vframe.parentNode;nextSibling=vframe.nextSibling;frameStyle=vframe.style.cssText||'';videoStyle=video.style.cssText||'';
      node('markviewer').appendChild(vframe);m.zoom={z:1,x:0,y:0};
    }
    function unmount(){
      if(parent){if(nextSibling&&nextSibling.parentNode===parent&&parent.insertBefore)parent.insertBefore(vframe,nextSibling);else parent.appendChild(vframe);}
      vframe.style.cssText=frameStyle;video.style.cssText=videoStyle;parent=null;nextSibling=null;layoutViewer();
    }
    function open(view){
      if(!state.ready||!state.marks.length||saving||m.busy)return Promise.resolve();
      if(m.open){if(view==='grid'){interrupt();m.view='grid';paint();scheduleThumbs();}return Promise.resolve();}
      closeBoundaryReview(true);cancelSceneScan(true);setVideoInfo(false);closeAllSheets();video.pause();interrupt();
      m.returnFrame=state.frame;m.returnSection=sceneNav.active;returnFocus=document.activeElement;
      m.open=true;m.focusId='markclose';m.current=contains(state.frame)?state.frame:list()[0];m.view=view|| (m.mode==='review'?'review':'grid');status('');mount();paint();node('markclose').focus();
      node('markreviewbody').scrollTop=0;
      if(m.view==='grid'){scheduleThumbs();return Promise.resolve();}
      return inspect(m.current,m.view);
    }
    function close(target){
      if(saving||m.busy)return Promise.resolve();if(!m.open)return Promise.resolve();
      interrupt();m.open=false;m.pair=[];node('markreview').hidden=true;node('markreview').className='markreview';unmount();paint();
      var frame=typeof target==='number'?target:m.returnFrame,section=m.returnSection,source=state.url,generation=m.generation,operation=m.operation;
      if(typeof target==='number'){
        var range=sceneNav.items[section];if(!range||target/state.fps<range.start||target/state.fps>=range.end)section=-1;
      }
      var ready=state.ready?goToFrame(frame):Promise.resolve();
      return ready.then(function(){if(source!==state.url||generation!==m.generation||operation!==m.operation||m.open)return;sceneNav.active=section;paintSceneFocus();onFrame();if(node('markedentry')&&!node('markedentry').hidden)node('markedentry').focus();else btns.bmark.focus();});
    }
    function inspect(frame,view){
      if(!contains(frame)||saving||m.busy)return Promise.resolve();
      if(!m.open){m.current=frame;return open('grid').then(function(){return inspect(frame,view||'inspect');});}
      interrupt();var operation=m.operation,generation=m.generation,source=state.url;
      if(m.view==='grid')m.boardScroll=node('markreviewbody').scrollTop||0;
      if(m.frameReady){snapshotFrame(m.current);heldFrame=stills[m.current];}
      m.current=frame;m.view=view||'inspect';m.loading=true;m.frameReady=false;if(m.view!=='compare')status('Loading frame…');paint();
      node('markreviewbody').scrollTop=0;
      return goToFrame(frame).then(function(how){
        if(operation!==m.operation||generation!==m.generation||source!==state.url||!m.open)return;
        m.loading=false;
        if(['seeked','frame'].indexOf(how)<0||state.frame!==frame||state.seeking||video.seeking){status('Could not load this frame. Choose it again to retry.');paint();return;}
        m.frameReady=true;snapshotFrame(frame);if(m.mode==='board'&&m.view==='compare'&&frame===m.pair[1])m.candidateReady=true;if(m.view!=='compare')status('');paint();return drawThumb(frame);
      });
    }
    function jump(frame){if(!contains(frame)||saving||m.busy)return;interrupt();if(m.open)return close(frame);video.pause();return goToFrame(frame).then(function(how){if(['seeked','frame'].indexOf(how)>=0&&state.frame===frame)return drawThumb(frame);});}
    function move(delta){var frames=list(),at=frames.indexOf(m.current);if(at<0)at=0;var next=Math.max(0,Math.min(frames.length-1,at+delta));if(frames.length)return inspect(frames[next],m.view==='review'?'review':'inspect');}
    function keep(){if(saving||m.busy||m.loading||!m.frameReady||!contains(m.current))return;if(!selected(m.current))m.selected.push(m.current);var frames=list();if(frames.indexOf(m.current)<frames.length-1)return move(1);status('Review complete · '+m.selected.length+' selected.');paint();}
    function skip(){if(saving||m.busy||m.loading||!m.frameReady)return;m.selected=m.selected.filter(function(f){return f!==m.current;});var frames=list();if(frames.indexOf(m.current)<frames.length-1)return move(1);status('Review complete · '+m.selected.length+' selected.');paint();}
    function compare(){
      if(saving||m.busy||m.loading)return Promise.resolve();var pair;
      if(m.mode==='board')return startCandidates();
      if(m.view==='review'){
        var others=m.selected.filter(function(f){return f!==m.current&&contains(f);});if(!others.length)return Promise.resolve();pair=[others[others.length-1],m.current];
      }else{if(m.selected.length!==2)return Promise.resolve();pair=m.selected.slice();}
      m.beforePair=m.view;m.pair=pair;return inspect(pair[1],'compare');
    }
    function inspectNotice(frame,view,message){
      var promise=inspect(frame,view),operation=m.operation,generation=m.generation;
      return promise.then(function(){if(m.open&&m.frameReady&&operation===m.operation&&generation===m.generation){status(message);paint();}});
    }
    function startCandidates(){
      if(m.view!=='grid'&&!m.frameReady)return Promise.resolve();
      var frames=list(),queue,first=m.keeper;
      if(m.view==='grid'&&m.selected.length===2){
        first=m.selected.indexOf(m.keeper)>=0?m.keeper:m.selected[0];queue=[m.selected[0]===first?m.selected[1]:m.selected[0]];
      }else{
        if(!contains(m.keeper))return Promise.resolve();
        queue=frames.filter(function(f){return f!==m.keeper;});
        if(m.view==='inspect'&&m.current!==m.keeper){var at=queue.indexOf(m.current);queue=queue.slice(at).concat(queue.slice(0,at));}
      }
      if(!queue.length)return Promise.resolve();
      m.beforePair=m.view;m.candidates=queue;m.candidateAt=0;m.candidateReady=false;m.pair=[first,queue[0]];
      return inspectNotice(queue[0],'compare',first===m.keeper?'A is your pinned keeper. Your save selection stays unchanged.':'Choose A or B to pin a keeper. Your save selection stays unchanged.');
    }
    function showSide(side){
      if(m.pair.length!==2||saving||m.busy||m.loading)return Promise.resolve();
      return inspect(m.pair[side==='a'?0:1],'compare');
    }
    function advanceCandidate(message){
      var next=m.candidateAt+1;
      while(next<m.candidates.length&&(!contains(m.candidates[next])||m.candidates[next]===m.keeper))next++;
      if(next>=m.candidates.length){
        m.pair=[];
        if(contains(m.keeper))return inspectNotice(m.keeper,'inspect',message+' End of candidates. All marks are still available.');
        interrupt();m.view='grid';status(message+' No keeper pinned. All marks are still available.');paint();node('markreviewbody').scrollTop=m.boardScroll;scheduleThumbs();return Promise.resolve();
      }
      m.candidateAt=next;m.candidateReady=false;m.pair=[m.keeper,m.candidates[next]];
      return inspectNotice(m.pair[1],'compare',message);
    }
    function decide(side){
      if(m.mode!=='board'||m.pair.length!==2||saving||m.busy||m.loading||!m.frameReady||!m.candidateReady)return Promise.resolve();
      m.undo=decisionSnapshot('decision');m.keeper=m.pair[side==='b'?1:0];
      return advanceCandidate(side==='b'?'B promoted to keeper.':'A kept.');
    }
    function nextCandidate(){
      if(m.mode!=='board'||m.pair.length!==2||saving||m.busy||m.loading)return Promise.resolve();
      m.undo=decisionSnapshot('decision');return advanceCandidate('Candidate skipped.');
    }
    function resolvePair(choice){
      if(m.mode==='board'||saving||m.busy||m.loading||!m.frameReady||m.pair.length!==2)return;
      var pair=m.pair.slice(),keep=choice==='both'?pair:[m.current];
      m.selected=m.selected.filter(function(f){return pair.indexOf(f)<0;}).concat(keep);m.pair=[];
      var back=m.beforePair;m.view=back;status(choice==='both'?'Both selected.':'Frame selected.');paint();if(back==='grid')scheduleThumbs();
    }
    function flip(){if(m.pair.length!==2||saving||m.busy||m.loading||!m.frameReady)return;return inspect(m.current===m.pair[0]?m.pair[1]:m.pair[0],'compare');}
    function back(){
      if(saving||m.busy)return;
      if(m.mode==='board'){interrupt();m.view='grid';m.pair=[];status('');paint();node('markreviewbody').scrollTop=m.boardScroll;scheduleThumbs();return;}
      if(m.view==='compare'){m.view=m.beforePair;m.pair=[];paint();if(m.view==='grid')scheduleThumbs();return;}
      if(m.view==='grid')return inspect(contains(m.current)?m.current:list()[0],'review');
      interrupt();m.view='grid';status('');paint();scheduleThumbs();
    }
    function saveFrames(frames){
      if(!frames.length||saving||m.busy||m.loading)return Promise.resolve();
      interrupt();var generation=m.generation;m.busy=true;paint();
      node('markreviewbody').scrollTop=0;
      return saveFrameList(frames,{restoreFrame:state.frame,restoreSection:sceneNav.active,
        onBusy:function(on){if(generation!==m.generation)return;m.busy=on;paint();},
        onProgress:function(message){if(generation===m.generation)status(message);}
      }).then(function(result){if(generation===m.generation){m.busy=false;status('');paint();}return result;});
    }
    function save(){return saveFrames(m.selected.slice().sort(function(a,b){return a-b;}));}
    function saveKeeper(){return contains(m.keeper)?saveFrames([m.keeper]):Promise.resolve();}
    function layout(){
      if(!m.open||!video.videoWidth)return;var box=node('markviewer'),r=cropRect();if(!r||box.hidden)return;
      var zoom=m.mode==='board'&&m.view==='grid'?{z:1,x:0,y:0}:m.zoom;
      var W=video.videoWidth,H=video.videoHeight,swap=state.rot===90||state.rot===270;
      var cw=box.clientWidth||320,cap=Math.max(100,(window.innerHeight||700)*(m.mode==='board'?0.5:m.mode==='review'?0.38:0.24));
      if(m.mode==='board'&&m.view==='grid')cap=100;
      var height=Math.min(cap,Math.max(100,cw*(swap?r.w:r.h)/(swap?r.h:r.w)));
      box.style.height=height+'px';
      var ch=box.clientHeight||height,fit=Math.min(cw/(swap?r.h:r.w),ch/(swap?r.w:r.h));
      if(!(fit>0))return;m.fitScale=fit;
      video.style.maxWidth='none';video.style.maxHeight='none';video.style.width=(W*fit)+'px';video.style.height=(H*fit)+'px';
      var maxX=Math.max(0,((swap?r.h:r.w)*fit*zoom.z-cw)/2),maxY=Math.max(0,((swap?r.w:r.h)*fit*zoom.z-ch)/2);
      zoom.x=clamp(zoom.x,-maxX,maxX);zoom.y=clamp(zoom.y,-maxY,maxY);
      var offset=rotatePoint((r.sx+r.w/2-W/2)*fit*zoom.z,(r.sy+r.h/2-H/2)*fit*zoom.z);
      vframe.style.clipPath='inset('+(r.sy/H*100)+'% '+((W-r.sx-r.w)/W*100)+'% '+((H-r.sy-r.h)/H*100)+'% '+(r.sx/W*100)+'%)';
      vframe.style.transform='translate('+(zoom.x-offset.x)+'px,'+(zoom.y-offset.y)+'px) scale('+zoom.z+')'+(state.rot?' rotate('+state.rot+'deg)':'');renderOverlay();
    }
    function onTransform(){stills={};invalidateThumbs();paint();if(m.mode==='filmstrip')scheduleThumbs();}
    function reset(){
      m.gridKey=null;stills={};heldFrame=null;overlay.width=1;overlay.height=1;reveal=false;m.generation++;interrupt();m.busy=false;m.loading=false;
      if(m.open){m.open=false;node('markreview').hidden=true;unmount();}
      invalidateThumbs();m.selected=[];m.pair=[];m.keeper=null;m.candidates=[];m.candidateAt=0;m.candidateReady=false;m.filter='all';m.boardScroll=0;m.undo=null;m.current=0;m.message='';m.view='grid';state.marks=[];paint();
    }
    function fit(){m.zoom={z:1,x:0,y:0};layout();}
    function actual(){m.zoom={z:clamp(1/(m.fitScale*(window.devicePixelRatio||1)),1,12),x:0,y:0};layout();}
    var dividerDragging=false,divider=node('markrevealhandle');
    divider.addEventListener('pointerdown',function(e){e.stopPropagation();if(saving||m.busy)return;dividerDragging=true;divider.setPointerCapture(e.pointerId);});
    divider.addEventListener('pointermove',function(e){e.stopPropagation();if(!dividerDragging)return;var box=node('markviewer').getBoundingClientRect();node('markrevealrange').value=clamp((e.clientX-box.left)/box.width*100,0,100);renderOverlay();});
    ['pointerup','pointercancel'].forEach(function(type){divider.addEventListener(type,function(e){e.stopPropagation();dividerDragging=false;});});
    divider.addEventListener('keydown',function(e){if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();node('markrevealrange').value=clamp(Number(node('markrevealrange').value)+(e.key==='ArrowLeft'?-5:5),0,100);renderOverlay();}});
    ['pointerdown','pointermove','pointerup','pointercancel'].forEach(function(type){node('markrevealrange').addEventListener(type,function(e){e.stopPropagation();});});
    node('markreveal').addEventListener('click',enableReveal);node('markrevealrange').addEventListener('input',renderOverlay);node('markzoomrange').addEventListener('input',function(){m.zoom.z=Number(this.value);layout();});node('markresetzoom').addEventListener('click',fit);
    node('markpin').addEventListener('click',pin);
    node('markshowa').addEventListener('click',function(){showSide('a');});node('markshowb').addEventListener('click',function(){showSide('b');});
    node('markaccepta').addEventListener('click',function(){decide('a');});node('markacceptb').addEventListener('click',function(){decide('b');});
    node('marknextcandidate').addEventListener('click',nextCandidate);node('marksavekeeper').addEventListener('click',saveKeeper);
    node('markfilterall').addEventListener('click',function(){setFilter('all');});node('markfilterselected').addEventListener('click',function(){setFilter('selected');});
    node('markworkflow').addEventListener('change',function(){setMode(this.value);});
    node('markedentry').addEventListener('click',function(){open();});
    node('markclose').addEventListener('click',function(){close();});
    if(node('markbackdrop'))node('markbackdrop').addEventListener('click',function(){close();});
    node('markprev').addEventListener('click',function(){move(-1);});node('marknext').addEventListener('click',function(){move(1);});
    node('markkeep').addEventListener('click',function(){if(m.view==='compare')resolvePair('both');else keep();});
    node('markskip').addEventListener('click',skip);node('markremove').addEventListener('click',function(){remove();});
    node('markundo').addEventListener('click',undo);if(node('markundoinline'))node('markundoinline').addEventListener('click',undo);
    node('markcompare').addEventListener('click',compare);node('markflip').addEventListener('click',flip);node('markback').addEventListener('click',back);node('marksave').addEventListener('click',save);
    node('markselect').addEventListener('click',function(){if(m.view==='compare')resolvePair('current');else select(m.current);});
    node('markfit').addEventListener('click',fit);node('markactual').addEventListener('click',actual);
    function focusableControls(){
      var candidates=node('markreview').querySelectorAll('button,select,input,summary,[tabindex]'),items=[];
      for(var i=0;i<candidates.length;i++)if(!candidates[i].disabled&&!candidates[i].hidden&&(!candidates[i].getClientRects||candidates[i].getClientRects().length))items.push(candidates[i]);
      var menu=node('bsavemenu');
      if(menu&&!menu.hidden&&!menu.disabled&&node('savetoast').className.indexOf('on')>=0)items.push(menu);
      return items;
    }
    node('markreview').addEventListener('keydown',function(e){
      if(e.target&&e.target.tagName==='INPUT'&&e.key.indexOf('Arrow')===0){e.stopPropagation();return;}
      if(e.key==='Escape'){e.preventDefault();close();}
      else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();if(m.view==='compare')flip();else if(m.view!=='grid')move(e.key==='ArrowLeft'?-1:1);}
      else if(e.key==='Tab'){
        var focusable=focusableControls();
        var first=focusable[0],last=focusable[focusable.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
      e.stopPropagation();
    });
    node('bsavemenu').addEventListener('keydown',function(e){
      if(!m.open||e.key!=='Tab')return;
      var controls=focusableControls(),paneControls=controls.filter(function(item){return item!==node('bsavemenu');});
      if(!paneControls.length)return;e.preventDefault();e.stopPropagation();
      (e.shiftKey?paneControls[paneControls.length-1]:paneControls[0]).focus();
    });
    node('markreviewbody').addEventListener('scroll',function(){if(this.scrollTop>0&&(m.queueRunning||cancelledPreview)){interrupt();cancelledPreview=false;status('');paint();}});
    function distance(){var keys=Object.keys(ptr);if(keys.length<2)return 0;var a=ptr[keys[0]],b=ptr[keys[1]];return Math.sqrt((a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y));}
    var viewer=node('markviewer');
    viewer.addEventListener('pointerdown',function(e){
      if(!m.open||m.busy||saving)return;ptr[e.pointerId]={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};
      if(viewer.setPointerCapture)try{viewer.setPointerCapture(e.pointerId);}catch(_){}
      if(Object.keys(ptr).length===2){pinch={d:distance(),z:m.zoom.z};Object.keys(ptr).forEach(function(id){ptr[id].moved=true;});}
    });
    viewer.addEventListener('pointermove',function(e){
      var p=ptr[e.pointerId];if(!p)return;e.preventDefault();var dx=e.clientX-p.x,dy=e.clientY-p.y;
      ptr[e.pointerId]={x:e.clientX,y:e.clientY,startX:p.startX,startY:p.startY,moved:p.moved||Math.abs(e.clientX-p.startX)>3||Math.abs(e.clientY-p.startY)>3};
      if(Object.keys(ptr).length>=2&&pinch&&pinch.d>6)m.zoom.z=clamp(pinch.z*distance()/pinch.d,1,12);
      else{m.zoom.x+=dx;m.zoom.y+=dy;}layout();
    });
    ['pointerup','pointercancel'].forEach(function(type){viewer.addEventListener(type,function(e){var p=ptr[e.pointerId],single=Object.keys(ptr).length===1;delete ptr[e.pointerId];if(Object.keys(ptr).length<2)pinch=null;if(type==='pointerup'&&single&&p&&!p.moved&&m.view==='compare')flip();});});
    viewer.addEventListener('wheel',function(e){if(!m.open||m.busy||saving)return;e.preventDefault();m.zoom.z=clamp(m.zoom.z*Math.exp(-e.deltaY*0.002),1,12);layout();},{passive:false});
    viewer.addEventListener('touchmove',function(e){if(e.touches.length>1)e.preventDefault();},{passive:false});
    document.addEventListener('pointerdown',function(e){
      if(m.queueRunning){interrupt();status('');cancelledPreview=true;}
    },true);
    ['pointerup','pointercancel'].forEach(function(type){document.addEventListener(type,function(){
      if(!cancelledPreview)return;cancelledPreview=false;var generation=m.generation;
      // Let a tapped card receive its click before rebuilding the board.
      setTimeout(function(){if(generation===m.generation&&m.open&&m.view==='grid'&&!m.queueRunning)paint();},0);
    });});
    document.addEventListener('visibilitychange',function(){if(document.hidden){var stopped=m.queueRunning||cancelledPreview;interrupt();ptr={};pinch=null;cancelledPreview=false;if(stopped){status('');paint();}}});
    window.addEventListener('hashchange',function(){var mode=String(location.hash||'').slice(1);if(validMode(mode))setMode(mode);});
    var initial=String(location.hash||'').slice(1);if(validMode(initial))m.mode=initial;
    var api={state:m,paint:paint,toggle:toggle,reset:reset,open:open,close:close,interrupt:interrupt,
      onFrame:onFrame,onTransform:onTransform,layout:layout,setMode:setMode,select:select,inspect:inspect,
      move:move,keep:keep,skip:skip,compare:compare,resolvePair:resolvePair,remove:remove,undo:undo,
      pin:pin,showSide:showSide,decide:decide,nextCandidate:nextCandidate,saveKeeper:saveKeeper,setFilter:setFilter,back:back,
      save:save,flip:flip,jump:jump,fit:fit,actual:actual,queueThumbs:queueThumbs};
    Object.defineProperty(api,'opened',{get:function(){return m.open;}});
    paint();return api;
  })();
