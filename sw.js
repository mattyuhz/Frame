/* Frame — verified, release-scoped offline shell. Generated release metadata is
   refreshed by python3 tools/prepare-release.py. Media never enters this cache. */

/* FRAME_RELEASE_BEGIN */
var RELEASE = {"id":"aff0f4bfb1206abf9662","files":{"index.html":"02c7f1a250c8b34abf83f08a8a83d94b3a5879d6167cb37c158441470f805ac7","compose.html":"250eb66485d36f9420e84b4ff0e8bb61ee31b65aa33f659672b113e5f8e5891a"}};
/* FRAME_RELEASE_END */

var CACHE_PREFIX = 'frame:' + self.registration.scope + ':release:';
var CACHE = CACHE_PREFIX + RELEASE.id;
var checking = null;

function shellPath(value){
  var url = new URL(value), scope = new URL(self.registration.scope);
  if(url.origin !== scope.origin) return null;
  if(url.pathname === scope.pathname) return 'index.html';
  var name = url.pathname.slice(scope.pathname.length);
  return url.pathname.indexOf(scope.pathname) === 0 &&
    Object.prototype.hasOwnProperty.call(RELEASE.files,name) ? name : null;
}

function shellURL(name){ return new URL(name,self.registration.scope).href; }

function verifiedResponse(name){
  return fetch(new Request(shellURL(name),{cache:'reload'})).then(function(response){
    if(!response.ok || response.redirected) throw new Error('App release unavailable');
    return response.clone().arrayBuffer().then(function(bytes){
      return crypto.subtle.digest('SHA-256',bytes);
    }).then(function(hash){
      var hex=Array.prototype.map.call(new Uint8Array(hash),function(b){return ('0'+b.toString(16)).slice(-2);}).join('');
      if(hex !== RELEASE.files[name]) throw new Error('App release is still publishing');
      return response;
    });
  });
}

self.addEventListener('install',function(event){
  var names=Object.keys(RELEASE.files);
  event.waitUntil(Promise.all(names.map(verifiedResponse)).then(function(responses){
    return caches.open(CACHE).then(function(cache){
      return Promise.all(names.map(function(name,index){return cache.put(shellURL(name),responses[index]);}));
    });
  }).catch(function(error){
    return caches.delete(CACHE).then(function(){throw error;});
  }));
  /* An update waits until every open app page agrees it has no work to lose.
     On first install, the browser activates normally without skipWaiting. */
});

self.addEventListener('activate',function(event){
  event.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(key){
      return (key.indexOf(CACHE_PREFIX)===0 && key!==CACHE) ||
        (new URL(self.registration.scope).pathname==='/Frame/' && key==='frame-v15');
    }).map(function(key){return caches.delete(key);}));
  }).then(function(){return self.clients.claim();}));
});

self.addEventListener('fetch',function(event){
  if(event.request.method!=='GET' || event.request.headers.has('range')) return;
  var name=shellPath(event.request.url);
  if(!name) return;
  event.respondWith(caches.open(CACHE).then(function(cache){
    return cache.match(shellURL(name)).then(function(hit){
      if(hit) return hit;
      /* Repair an evicted entry only with the exact bytes of this release. */
      return verifiedResponse(name).then(function(response){
        return cache.put(shellURL(name),response.clone()).then(function(){return response;});
      }).catch(function(){
        /* If the old release no longer exists, a normal online navigation can
           bootstrap the current release. Never write it into the old cache. */
        return fetch(new Request(event.request,{cache:'reload'}));
      });
    });
  }));
});

function appClients(){
  return self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(clients){
    return clients.filter(function(client){return !!shellPath(client.url);});
  });
}

function askReady(client,token,prepare){
  return new Promise(function(resolve){
    var channel=new MessageChannel(), finished=false;
    var timer=setTimeout(function(){finish(false);},1800);
    function finish(ready){
      if(finished)return;finished=true;clearTimeout(timer);channel.port1.close();resolve(ready);
    }
    channel.port1.onmessage=function(event){finish(!!(event.data && event.data.ready));};
    try{client.postMessage({type:prepare?'FRAME_PREPARE':'FRAME_PROBE',build:RELEASE.id,token:token},[channel.port2]);}
    catch(_){finish(false);}
  });
}

function activateWhenSafe(){
  var token=RELEASE.id+':'+Date.now(), participants=[];
  function cancel(){
    participants.forEach(function(client){
      try{client.postMessage({type:'FRAME_CANCEL',token:token});}catch(_){}
    });
  }
  return appClients().then(function(clients){
    participants=clients;
    return Promise.all(clients.map(function(client){return askReady(client,token,false);}));
  }).then(function(ready){
    /* Probe first: a suspended/legacy/dirty page must not freeze the controls
       in an otherwise idle page on every background update check. */
    if(!ready.every(Boolean))return false;
    return Promise.all(participants.map(function(client){return askReady(client,token,true);})).then(function(prepared){
      if(!prepared.every(Boolean)){cancel();return false;}
      return appClients().then(function(current){
        var ids=participants.map(function(client){return client.id;}).sort().join('|');
        if(current.map(function(client){return client.id;}).sort().join('|')!==ids){cancel();return false;}
        return self.skipWaiting().then(function(){return true;});
      });
    });
  }).catch(function(){cancel();return false;});
}

self.addEventListener('message',function(event){
  var data=event.data||{};
  if(data.type==='FRAME_BUILD'){
    if(event.ports[0]){event.ports[0].postMessage({build:RELEASE.id});event.ports[0].close();}
    return;
  }
  if(data.type!=='FRAME_CHECK' || !event.source || !shellPath(event.source.url))return;
  if(!checking)checking=activateWhenSafe().then(function(){checking=null;});
  event.waitUntil(checking);
});
