/* Test-only raster audit, shared by the native runner and browser QA page.
   Injected after the unmodified shipped rectsFor/drawInto functions. */
async function runSeamAudit(io) {
  var report={cases:0,pixelsChecked:0,badPixels:0,maxChannelError:0,failures:[],pngRoundTrips:0,jpegRoundTrips:0,jpegMaxChannelError:0};
  var dims=[[1,1],[17,29],[640,480],[1080,1920],[1920,1080],[4033,3023],[4096,2160],[1001,667]];
  var views=[[1,0.5,0.5],[1.001,0.001,0.999],[1.333333,0.999,0.001],[3.719,0.173,0.817],[10,0.5,0.5]];
  var W=1080,H=1920, canvas=io.canvas(W,H),g=canvas.getContext('2d');
  function inspect(pixels,expected,label,lossy){
    var bad=0,max=0;
    for(var n=0;n<pixels.length;n+=4){
      var err=Math.max(Math.abs(pixels[n]-expected),Math.abs(pixels[n+1]-expected),Math.abs(pixels[n+2]-expected),255-pixels[n+3]);
      max=Math.max(max,err);if(err)bad++;
    }
    if(lossy){report.jpegMaxChannelError=Math.max(report.jpegMaxChannelError,max);return;}
    report.pixelsChecked+=pixels.length/4; report.badPixels+=bad;
    report.maxChannelError=Math.max(report.maxChannelError,max);
    if(bad && report.failures.length<12) report.failures.push({label,bad,max});
  }
  // Equal flat panels make even a single dimmed boundary pixel measurable.
  for(var d of dims){
    var src=io.canvas(d[0],d[1]),sg=src.getContext('2d');
    for(var alpha of [false,true]){
      sg.clearRect(0,0,d[0],d[1]);sg.fillStyle=alpha?'rgba(255,255,255,0.5)':'#fff';sg.fillRect(0,0,d[0],d[1]);
      // Derive the engine's alpha rounding from an isolated reference pixel.
      var ref=io.canvas(1,1),rg=ref.getContext('2d');rg.fillStyle='#000';rg.fillRect(0,0,1,1);rg.drawImage(src,0,0,1,1);
      var expected=rg.getImageData(0,0,1,1).data[0];
      for(var layout of ['2','3','4']) for(var v of views){
        state.layout=layout;
        state.cells=Array.from({length:4},function(){return {w:d[0],h:d[1],el:src,ready:true,view:{s:v[0],cx:v[1],cy:v[2]}};});
        drawInto(g,W,H);
        var label=[layout,d.join('x'),alpha?'alpha':'opaque',v.join(',')].join(' / ');
        inspect(g.getImageData(0,0,W,H).data,expected,label,false);report.cases++;
        if(v===views[0]){
          for(var mime of ['image/png','image/jpeg']){
            var decoded=await io.roundTrip(canvas,mime),dc=io.canvas(W,H),dg=dc.getContext('2d');dg.drawImage(decoded,0,0);
            inspect(dg.getImageData(0,0,W,H).data,expected,label+' '+mime,mime==='image/jpeg');
            if(mime==='image/png')report.pngRoundTrips++;else report.jpegRoundTrips++;
          }
        }
      }
    }
    if(io.progress)io.progress(report.cases);
    await io.yield();
  }
  // Detailed high-frequency images: compare the full composition with each
  // cell drawn independently, including all pixels along every join.
  report.patternCases=0;report.patternBadPixels=0;
  for(var kind of ['checker','gradient','transparent-edge']){
    var src=io.canvas(1001,667),sg=src.getContext('2d');
    if(kind==='gradient'){
      var gradient=sg.createLinearGradient(0,0,1001,667);gradient.addColorStop(0,'#f022a8');gradient.addColorStop(1,'#29ef57');sg.fillStyle=gradient;sg.fillRect(0,0,1001,667);
    }else{
      sg.fillStyle=kind==='checker'?'#fff':'rgba(255,255,255,0.4)';sg.fillRect(0,0,1001,667);
      sg.fillStyle='#d52189';for(var y=0;y<667;y+=31)for(var x=0;x<1001;x+=37)if((Math.floor(y/31)+Math.floor(x/37))%2)sg.fillRect(x,y,37,31);
      if(kind==='transparent-edge')sg.clearRect(0,0,1,667);
    }
    for(var layout of ['2','3','4'])for(var v of views){
      state.layout=layout;state.cells=Array.from({length:4},()=>({w:1001,h:667,el:src,ready:true,view:{s:v[0],cx:v[1],cy:v[2]}}));
      drawInto(g,W,H);var actual=g.getImageData(0,0,W,H).data;
      for(var r of rectsFor(W,H)){
        var isolated=io.canvas(W,H),ig=isolated.getContext('2d');ig.fillStyle='#000';ig.fillRect(0,0,W,H);
        var scale=Math.max(r.w/1001,r.h/667)*v[0],sw=r.w/scale,sh=r.h/scale;
        ig.drawImage(src,clamp(v[1]*1001-sw/2,0,Math.max(0,1001-sw)),clamp(v[2]*667-sh/2,0,Math.max(0,667-sh)),sw,sh,r.x,r.y,r.w,r.h);
        var expected=ig.getImageData(r.x,r.y,r.w,r.h).data;
        for(var y=0;y<r.h;y++)for(var x=0;x<r.w;x++){
          var a=((y+r.y)*W+x+r.x)*4,b=(y*r.w+x)*4;
          if(actual[a]!==expected[b]||actual[a+1]!==expected[b+1]||actual[a+2]!==expected[b+2]||actual[a+3]!==expected[b+3])report.patternBadPixels++;
        }
      }
      report.patternCases++;
    }
    await io.yield();
  }
  report.pass=report.badPixels===0 && report.patternBadPixels===0;
  return report;
}
