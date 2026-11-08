  /* Kept inline by prepare-release.py so the app has no runtime dependency. */
  function startFrameUpdates(options){
    if(!('serviceWorker' in navigator) || location.protocol!=='https:')return;
    try{if(window.self!==window.top)return;}catch(_){return;}
    var registration=null, checking=false, lastCheck=0, targetBuild=null;
    var locked=false, lockToken=null, lockTimer=null, reloading=false;
    var workerURL=new URL('sw.js',location.href).href;
    function safe(){
      if(reloading)return false;
      try{
        var selection=window.getSelection && window.getSelection();
        if(selection && !selection.isCollapsed)return false;
        var el=document.activeElement;
        if(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))return false;
        return options.safeToReload()===true;
      }catch(_){return false;}
    }
    function blockInput(event){
      if(!locked)return;
      if(event.cancelable)event.preventDefault();event.stopImmediatePropagation();
    }
    ['pointerdown','touchstart','click','keydown','drop'].forEach(function(type){
      document.addEventListener(type,blockInput,{capture:true,passive:false});
    });
    function unlock(){locked=false;lockToken=null;clearTimeout(lockTimer);}
    function maybeReload(worker){
      if(!targetBuild || targetBuild===options.build || !worker)return;
      var channel=new MessageChannel(), timer=setTimeout(function(){channel.port1.close();},1800);
      channel.port1.onmessage=function(event){
        clearTimeout(timer);channel.port1.close();
        if(event.data && event.data.build===targetBuild && safe()){
          reloading=true;location.reload();
        }
      };
      try{worker.postMessage({type:'FRAME_BUILD'},[channel.port2]);}catch(_){clearTimeout(timer);channel.port1.close();}
    }
    navigator.serviceWorker.addEventListener('message',function(event){
      if(!event.source || event.source.scriptURL!==workerURL)return;
      var data=event.data||{}, port=event.ports && event.ports[0];
      if(data.type==='FRAME_PROBE' && port){
        port.postMessage({ready:safe() && !locked});port.close();
      }else if(data.type==='FRAME_PREPARE' && port){
        var ready=safe() && (!locked || lockToken===data.token);
        if(ready){
          locked=true;lockToken=data.token;targetBuild=data.build;
          clearTimeout(lockTimer);lockTimer=setTimeout(unlock,6000);
        }
        port.postMessage({ready:ready});port.close();
      }else if(data.type==='FRAME_CANCEL' && lockToken===data.token){
        targetBuild=null;unlock();
      }
    });
    navigator.serviceWorker.addEventListener('controllerchange',function(){
      unlock();maybeReload(navigator.serviceWorker.controller);
    });
    function tryWaiting(){
      /* A first installation activates by itself. Asking it to prepare can
         race its initial claim and leave an unnecessary input lock behind. */
      if(registration && registration.waiting && navigator.serviceWorker.controller && safe()){
        registration.waiting.postMessage({type:'FRAME_CHECK'});
      }
      maybeReload(navigator.serviceWorker.controller);
    }
    function watchInstalling(){
      var worker=registration && registration.installing;
      if(worker)worker.addEventListener('statechange',function(){
        if(worker.state==='installed')tryWaiting();
      });
    }
    function check(){
      if(!registration || document.hidden)return;
      tryWaiting();
      if(checking || Date.now()-lastCheck<60000 || navigator.onLine===false)return;
      checking=true;lastCheck=Date.now();
      registration.update().catch(function(){}).then(function(){checking=false;tryWaiting();});
    }
    navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(function(value){
      registration=value;registration.addEventListener('updatefound',watchInstalling);
      watchInstalling();check();
    }).catch(function(){/* Online use remains available if offline storage is denied. */});
    document.addEventListener('visibilitychange',function(){if(!document.hidden)check();});
    window.addEventListener('online',check);
    window.addEventListener('pageshow',check);
    setInterval(check,60000);
  }
