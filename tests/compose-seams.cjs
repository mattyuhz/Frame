// Run with NODE_PATH pointing at a dev installation of @napi-rs/canvas.
// This dependency is test-only; nothing is added to the shipped app.
const fs=require('node:fs'),path=require('node:path');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const source=fs.readFileSync(path.join(__dirname,'../compose.html'),'utf8');
const fn=name=>source.match(new RegExp('  function '+name+'\\([^]*?\\n  }'))[0];
const audit=new Function('var state={};function clamp(v,a,b){return Math.max(a,Math.min(b,v));}function cellCount(){return Number(state.layout);}' + fn('rectsFor')+'\n'+fn('drawInto')+'\n'+fs.readFileSync(path.join(__dirname,'compose-seam-runner.js'),'utf8')+';return runSeamAudit;')();
audit({canvas:createCanvas,roundTrip:(c,m)=>loadImage(c.toBuffer(m)),yield:()=>new Promise(r=>setImmediate(r))}).then(report=>{
  console.log(JSON.stringify(report,null,2));
  fs.writeFileSync('/tmp/compose-seam-native-report.json',JSON.stringify(report,null,2));
  process.exitCode=report.pass?0:1;
}).catch(e=>{console.error(e);process.exitCode=1;});
