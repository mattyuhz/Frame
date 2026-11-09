/* Frame — offline shell.
   Caches this app's own files so the page opens with no network at all.
   It handles only same-origin GET requests and never touches any other
   origin; the page itself remains blocked from all network contact by
   its Content-Security-Policy. */

var CACHE_PREFIX = 'frame:' + self.registration.scope + ':';
var CACHE = CACHE_PREFIX + 'v42-live-photo-worker';
var SHELL = ['./', './index.html', './compose.html', './photo-worker.js'];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c){ return c.addAll(SHELL); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys
        .filter(function(k){ return k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE; })
        .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);
  if(url.origin !== location.origin || url.href.indexOf(self.registration.scope) !== 0 ||
     e.request.method !== 'GET' || e.request.headers.has('range')) return;
  e.respondWith(
    caches.open(CACHE).then(function(cache){ return cache.match(e.request, {ignoreSearch:true}); }).then(function(hit){
      var refresh = fetch(e.request).then(function(res){
        if(res && res.ok){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
        }
        return res;
      }).catch(function(){ return hit; });
      /* Keep HTML workspaces on the same current release when online.
         The cached shell remains available offline. */
      return e.request.mode === 'navigate' || /\.html$/.test(url.pathname) ? refresh : (hit || refresh);
    })
  );
});
