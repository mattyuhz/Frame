'use strict';
/* Real HTTPS/service-worker lifecycle test. Run with Playwright on NODE_PATH.
   All release variants, media and certificates stay in a temporary directory. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const https=require('node:https');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'frame-pwa-browser-'));
const chrome=process.env.FRAME_TEST_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let browser,server,serving;
const network=[];
function makeRelease(version){
  const dir=path.join(temp,version);fs.mkdirSync(path.join(dir,'tools'),{recursive:true});
  for(const name of ['index.html','compose.html','sw.js','tools/pwa-update-client.js','tools/prepare-release.py'])fs.copyFileSync(path.join(root,name),path.join(dir,name));
  for(const name of ['index.html','compose.html']){
    const file=path.join(dir,name);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/<title>(.*?)<\/title>/,'<title>$1 '+version+'</title>'));
  }
  execFileSync('python3',[path.join(dir,'tools/prepare-release.py')],{stdio:'pipe'});
  execFileSync('python3',[path.join(dir,'tools/prepare-release.py'),'--check'],{stdio:'pipe'});
  return {dir,id:JSON.parse(fs.readFileSync(path.join(dir,'sw.js'),'utf8').match(/var RELEASE = (.*);/)[1]).id};
}
async function activeBuild(page){
  return page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.getRegistration();
    if(!registration||!registration.active)return null;
    return new Promise((resolve,reject)=>{
      const channel=new MessageChannel(),timer=setTimeout(()=>reject(new Error('Worker build request timed out')),3000);
      channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data.build);};
      registration.active.postMessage({type:'FRAME_BUILD'},[channel.port2]);
    });
  });
}
async function waitTitle(page,version){await page.waitForFunction(value=>document.title.endsWith(value),version,{timeout:20000});}
async function checkUpdate(page){await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});}
(async()=>{
  const versions=['v1','v2','v3'].map(makeRelease);serving=versions[0].dir;
  execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(temp,'key.pem'),'-out',path.join(temp,'cert.pem'),'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
  server=https.createServer({key:fs.readFileSync(path.join(temp,'key.pem')),cert:fs.readFileSync(path.join(temp,'cert.pem'))},(request,response)=>{
    network.push({url:request.url,release:path.basename(serving),cache:request.headers['cache-control']});
    const url=new URL(request.url,'https://localhost'),name=url.pathname==='/Frame/'?'index.html':url.pathname.slice('/Frame/'.length);
    if(!url.pathname.startsWith('/Frame/')||!['index.html','compose.html','sw.js'].includes(name)){response.writeHead(404);response.end();return;}
    const content=fs.readFileSync(path.join(serving,name));response.writeHead(200,{'Content-Type':name.endsWith('.js')?'application/javascript':'text/html; charset=utf-8','Cache-Control':'max-age=600','Content-Length':content.length});response.end(content);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base='https://127.0.0.1:'+server.address().port+'/Frame/';
  browser=await chromium.launch({executablePath:chrome,headless:true,args:['--ignore-certificate-errors']});
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:430,height:900}});
  const frame=await context.newPage(),compose=await context.newPage();let frameLoads=0,composeLoads=0;
  const errors=[];
  for(const page of [frame,compose])page.on('pageerror',error=>errors.push(error.message));
  frame.on('framenavigated',f=>{if(f===frame.mainFrame())frameLoads++;});
  compose.on('framenavigated',f=>{if(f===compose.mainFrame())composeLoads++;});
  await frame.goto(base);await frame.evaluate(()=>navigator.serviceWorker.ready);await frame.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await compose.goto(base+'compose.html');await compose.evaluate(()=>navigator.serviceWorker.ready);
  await waitTitle(frame,'v1');await waitTitle(compose,'v1');
  assert.equal(await activeBuild(frame),versions[0].id);assert.equal(frameLoads,1);assert.equal(composeLoads,1);
  const previewCache='frame:'+base+'previews/marks/:release:unrelated';
  await frame.evaluate(async key=>{const cache=await caches.open(key);await cache.put('./sentinel',new Response('preserve me'));},previewCache);
  console.log('PASS first install: both pages controlled, no reload loop');

  serving=versions[1].dir;await checkUpdate(compose);await waitTitle(frame,'v2');await waitTitle(compose,'v2');
  assert.equal(await activeBuild(compose),versions[1].id);assert.equal(frameLoads,2);assert.equal(composeLoads,2);
  console.log('PASS both idle pages: verified v2 activates and each reloads exactly once');

  await frame.locator('#file').setInputFiles(path.join(root,'previews/scenes/tests/fixtures/scenes/07-subsecond.mp4'));
  await frame.waitForFunction(()=>{const v=document.querySelector('#video');return v&&v.videoWidth>0&&v.readyState>=2&&!document.querySelector('#bsave').disabled;},null,{timeout:30000});
  serving=versions[2].dir;await checkUpdate(compose);
  await compose.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting,null,{timeout:20000});
  await new Promise(resolve=>setTimeout(resolve,2500));
  assert.equal(await activeBuild(compose),versions[1].id);assert.equal(frameLoads,2);assert.equal(composeLoads,2);
  assert.ok(await frame.locator('#video').evaluate(video=>video.videoWidth>0));
  console.log('PASS loaded real video: v3 waits and neither page reloads');

  await frame.close();await compose.bringToFront();
  await context.setOffline(true);await context.setOffline(false);
  await waitTitle(compose,'v3');assert.equal(await activeBuild(compose),versions[2].id);assert.equal(composeLoads,3);
  assert.ok(await compose.evaluate(key=>caches.has(key),previewCache));
  console.log('PASS closing dirty page: remaining idle page updates; preview cache survives');

  await context.setOffline(true);await compose.reload();await waitTitle(compose,'v3');assert.equal(composeLoads,4);
  assert.equal(await activeBuild(compose),versions[2].id);
  assert.deepEqual(errors,[]);
  console.log('PASS offline reload: verified current release opens with no page errors');
  console.log('PWA browser integration: all 5 lifecycle scenarios passed.');
})().catch(async error=>{
  console.error(error);console.error('Network:',JSON.stringify(network));
  if(browser)for(const page of browser.contexts()[0].pages()){
    try{console.error('Page:',JSON.stringify(await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return {url:location.href,title:document.title,focus:document.activeElement.tagName,selection:window.getSelection().isCollapsed,active:r?.active?.state,waiting:r?.waiting?.state,installing:r?.installing?.state,caches:await caches.keys()};})));}catch(_){}
  }
  process.exitCode=1;
}).finally(async()=>{
  if(browser)await browser.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  fs.rmSync(temp,{recursive:true,force:true});
});
