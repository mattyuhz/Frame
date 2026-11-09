/* Three hand-tuned rendering studies. Already-rendered sRGB input, not RAW/log.
 * Pure pixel transforms: no decoding, resizing, masks, model, network, or I/O. */
(function(root, factory){
  var api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.TasteRendering=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var VERSION='taste-rendering-2';
  var WEIGHTS=[0.2126,0.7152,0.0722];
  function freeze(value){
    if(value && typeof value==='object' && !Object.isFrozen(value)){
      Object.keys(value).forEach(function(key){freeze(value[key]);});
      Object.freeze(value);
    }
    return value;
  }
  var PROFILES=freeze([
    {id:'original',label:'Original',version:VERSION,description:'Unchanged decoded source pixels.'},
    {id:'a',label:'Correction',version:VERSION,description:'A manually chosen tonal correction for this photograph; neutral gray stays neutral.'},
    {id:'b',label:'Rendering',version:VERSION,description:'The same correction followed by intentional tone and color shaping.'}
  ]);
  var RECIPES=freeze({
    snow:{
      id:'snow',version:VERSION,description:'Open the snowy portrait, retain dark clothing, and give the rendering clearer tonal separation.',
      correctionCurve:[[0,0],[0.025,0.028],[0.08,0.095],[0.18,0.22],[0.35,0.405],[0.55,0.615],[0.75,0.82],[0.9,0.945],[1,1]],
      rendering:{
        curve:[[0,0],[0.025,0.017],[0.08,0.052],[0.18,0.135],[0.35,0.325],[0.55,0.58],[0.75,0.81],[0.9,0.94],[1,1]],
        saturation:0.98,blueChroma:0.92,greenChroma:0.94,
        shadowTint:[-0.008,0.001,0.014],highlightTint:[0.006,0.003,-0.005],warmTintProtection:0.65
      }
    },
    backlight:{
      id:'backlight',version:VERSION,description:'Open the shadowed portrait while keeping the sunlit peak bright; retain early-light color relationships.',
      correctionCurve:[[0,0],[0.025,0.04],[0.08,0.13],[0.18,0.27],[0.35,0.445],[0.55,0.63],[0.75,0.8],[0.9,0.925],[1,1]],
      rendering:{
        curve:[[0,0],[0.025,0.02],[0.08,0.07],[0.18,0.185],[0.35,0.38],[0.55,0.6],[0.75,0.81],[0.9,0.935],[1,1]],
        saturation:1,blueChroma:0.85,greenChroma:0.94,
        shadowTint:[-0.008,0.001,0.013],highlightTint:[0.012,0.004,-0.008],warmTintProtection:0.8
      }
    },
    cloud:{
      id:'cloud',version:VERSION,description:'Open the mountain scene; shape terrain and cloud tones while retaining atmospheric haze.',
      correctionCurve:[[0,0],[0.025,0.024],[0.08,0.09],[0.18,0.23],[0.35,0.41],[0.55,0.6],[0.75,0.78],[0.9,0.91],[1,1]],
      rendering:{
        curve:[[0,0],[0.025,0.015],[0.08,0.05],[0.18,0.14],[0.35,0.32],[0.55,0.565],[0.75,0.795],[0.9,0.93],[1,1]],
        saturation:0.97,blueChroma:0.91,greenChroma:0.88,
        shadowTint:[-0.009,0.001,0.014],highlightTint:[0.01,0.004,-0.007],warmTintProtection:0.65
      }
    }
  });
  function getProfile(id){
    for(var i=0;i<PROFILES.length;i++)if(PROFILES[i].id===id)return PROFILES[i];
    throw new RangeError('Unknown rendering profile: '+id);
  }
  function getRecipe(id){
    if(!Object.prototype.hasOwnProperty.call(RECIPES,id))throw new RangeError('Unknown rendering recipe: '+id);
    return RECIPES[id];
  }
  // Monotone cubic Hermite interpolation with harmonic interior slopes and
  // bounded endpoint slopes. It avoids kinks and overshoot at the control points.
  function compileCurve(points){
    var n=points.length,h=[],d=[],m=new Array(n),i;
    for(i=0;i<n-1;i++){h[i]=points[i+1][0]-points[i][0];d[i]=(points[i+1][1]-points[i][1])/h[i];}
    function endpoint(h0,h1,d0,d1){
      var slope=((2*h0+h1)*d0-h0*d1)/(h0+h1);
      if(slope*d0<=0)return 0;
      return Math.min(slope,3*d0);
    }
    m[0]=endpoint(h[0],h[1],d[0],d[1]);
    m[n-1]=endpoint(h[n-2],h[n-3],d[n-2],d[n-3]);
    for(i=1;i<n-1;i++){
      if(d[i-1]*d[i]<=0)m[i]=0;
      else{var a=2*h[i]+h[i-1],b=h[i]+2*h[i-1];m[i]=(a+b)/(a/d[i-1]+b/d[i]);}
    }
    var table=new Float64Array(4097),segment=0;
    for(i=0;i<=4096;i++){
      var x=i/4096;
      while(segment<n-2 && x>points[segment+1][0])segment++;
      var t=(x-points[segment][0])/h[segment],t2=t*t,t3=t2*t;
      table[i]=(2*t3-3*t2+1)*points[segment][1]+(t3-2*t2+t)*h[segment]*m[segment]+(-2*t3+3*t2)*points[segment+1][1]+(t3-t2)*h[segment]*m[segment+1];
    }
    table[0]=0;table[4096]=1;
    return table;
  }
  var compiled={};
  Object.keys(RECIPES).forEach(function(id){compiled[id]={a:compileCurve(RECIPES[id].correctionCurve),b:compileCurve(RECIPES[id].rendering.curve)};});
  function curve(table,value){
    if(value<=0)return 0;if(value>=1)return 1;
    var x=value*4096,index=Math.floor(x),part=x-index;
    return table[index]+part*(table[index+1]-table[index]);
  }
  function smooth(value,span){var t=Math.max(0,Math.min(1,value/span));return t*t*(3-2*t);}
  function renderPixels(pixels,profileId,recipeId){
    if(Object.prototype.toString.call(pixels)!=='[object Uint8ClampedArray]' || pixels.length%4)throw new TypeError('Expected complete unpremultiplied RGBA pixels.');
    var profile=getProfile(profileId),recipe=getRecipe(recipeId),lookup=compiled[recipeId],out=new Uint8ClampedArray(pixels);
    if(profile.id==='original')return out;
    var look=recipe.rendering;
    for(var i=0;i<pixels.length;i+=4){
      if(pixels[i+3]===0)continue;
      var r=pixels[i]/255,g=pixels[i+1]/255,b=pixels[i+2]/255;
      var y=WEIGHTS[0]*r+WEIGHTS[1]*g+WEIGHTS[2]*b;
      if(y<=0 || y>=1)continue;
      var corrected=curve(lookup.a,y),target=profile.id==='b'?curve(lookup.b,corrected):corrected;
      // Reserve one encoded value at each end for non-black/non-white pixels.
      // A common chroma contraction avoids independent channel clipping.
      target=Math.max(1/255,Math.min(254/255,target));
      var saturation=1,tr=0,tg=0,tb=0;
      if(profile.id==='b'){
        var blue=smooth(b-Math.max(r,g),0.12),green=smooth(g-Math.max(r,b),0.12);
        saturation=look.saturation*(1-blue*(1-look.blueChroma))*(1-green*(1-look.greenChroma));
        var warm=smooth(r-b,0.16);
        var envelope=16*target*target*(1-target)*(1-target)*(1-warm*look.warmTintProtection);
        var blend=smooth(target-0.25,0.5);
        tr=(look.shadowTint[0]*(1-blend)+look.highlightTint[0]*blend)*envelope;
        tg=(look.shadowTint[1]*(1-blend)+look.highlightTint[1]*blend)*envelope;
        tb=(look.shadowTint[2]*(1-blend)+look.highlightTint[2]*blend)*envelope;
        var tintLuma=WEIGHTS[0]*tr+WEIGHTS[1]*tg+WEIGHTS[2]*tb;
        tr-=tintLuma;tg-=tintLuma;tb-=tintLuma;
      }
      var gain=target/y*saturation;
      var cr=(r-y)*gain+tr,cg=(g-y)*gain+tg,cb=(b-y)*gain+tb;
      var low=1/255,high=254/255,scale=1;
      if(cr>0)scale=Math.min(scale,(high-target)/cr);else if(cr<0)scale=Math.min(scale,(target-low)/-cr);
      if(cg>0)scale=Math.min(scale,(high-target)/cg);else if(cg<0)scale=Math.min(scale,(target-low)/-cg);
      if(cb>0)scale=Math.min(scale,(high-target)/cb);else if(cb<0)scale=Math.min(scale,(target-low)/-cb);
      out[i]=Math.round(255*(target+scale*cr));out[i+1]=Math.round(255*(target+scale*cg));out[i+2]=Math.round(255*(target+scale*cb));
    }
    return out;
  }
  return freeze({
    VERSION:VERSION,PROFILES:PROFILES,getProfile:getProfile,getRecipe:getRecipe,renderPixels:renderPixels,
    METHOD:{input:'Unpremultiplied 8-bit RGBA, already rendered to sRGB.',lumaWeights:WEIGHTS,
      correction:'Per-photo, manually selected monotone cubic curves applied to weighted encoded luma; neutral grays remain neutral.',
      rendering:'Correction followed by a second monotone curve, hue-dependent chroma scaling, and luma-neutral tonal tinting. Common gamut contraction reserves endpoints.',
      interpolation:'Monotone cubic Hermite curves, 4097-point lookup with linear interpolation.',
      assumptions:'These curves operate on encoded display values, not scene-linear exposure. No RAW, log or HDR interpretation.',
      limits:'Hand-tuned examples; not learned or automatic, not camera emulation, not recovered detail. No masks, sharpening, grain, blur, vignette, or generated content.'}
  });
});

/* Reference-informed Mineral study. The builder verifies the frozen v2 bytes.
 * A stays byte-identical to its earlier recipe; Mineral is a separate fixed look. */
(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory(require('./taste-rendering-v2.js'));
  else root.TasteRendering=factory(root.TasteRendering);
})(typeof globalThis!=='undefined'?globalThis:this,function(base){
  'use strict';
  if(!base || base.VERSION!=='taste-rendering-2' || typeof base.renderPixels!=='function' || typeof base.getRecipe!=='function')throw new Error('The Mineral study requires the verified v2 renderer.');
  var VERSION='taste-mineral-1';
  var BASE_RENDERER_SHA256='c37cc6b42de65fa32bb941c99fee8a252483bbbd73fb3b47c3ab7867d4ebc6d4';
  var WEIGHTS=[0.2126,0.7152,0.0722];
  function freeze(value){
    if(value && typeof value==='object' && !Object.isFrozen(value)){
      Object.keys(value).forEach(function(key){freeze(value[key]);});
      Object.freeze(value);
    }
    return value;
  }
  var PROFILES=freeze([
    {id:'original',label:'Original',version:VERSION,description:'Unchanged decoded source pixels.'},
    {id:'a',label:'Recipe A',version:VERSION,description:'The complete frozen backlight rendering from round two.'},
    {id:'b',label:'Mineral',version:VERSION,description:'A fixed interpretation of the selected references: weighted shadows, a gentle highlight shoulder, and restrained cool and warm color relationships.'}
  ]);
  var MINERAL=freeze({
    id:'mineral',version:VERSION,
    description:'Hand-authored color and tone experiment informed by the selected outdoor photographs. It is not a recovered brand LUT or camera emulation.',
    toneCurve:[[0,0],[0.025,0.023],[0.08,0.074],[0.18,0.169],[0.35,0.326],[0.55,0.531],[0.75,0.717],[0.9,0.851],[1,0.965]],
    saturation:1,greenChroma:0.80,yellowChroma:0.92,blueChroma:1,
    shadowTint:[-0.028,0.007,0.027],highlightTint:[0.03,0.01,-0.03],
    warmTintProtection:0.8,
    toneEndpoints:'Exact black remains black; white is compressed to 0.965 encoded luma. The shoulder reduces highlight brightness, without recovering clipped detail.',
    colorMasks:{greenSpan:0.15,yellowSpan:0.18,yellowWarmExclusionSpan:0.1,warmRedBlueSpan:0.14,warmRedGreenSpan:0.08},
    tintBlend:{start:0.28,span:0.5,envelope:'4 * target * (1 - target)'},
    gamut:'Common chroma contraction within [0, 1], preserving the target luma before rounding.'
  });
  var PAIR=freeze({
    id:'mineral-pair',version:VERSION,
    description:'The unchanged A recipe and one fixed Mineral recipe are applied to every photo.',
    baseRendererVersion:base.VERSION,baseRendererSha256:BASE_RENDERER_SHA256,
    mapping:{original:{profileId:'original',recipeId:'backlight'},a:{profileId:'b',recipeId:'backlight'},b:{profileId:'mineral',recipeId:'mineral'}},
    recipes:{backlight:base.getRecipe('backlight'),mineral:MINERAL}
  });
  function getProfile(id){
    for(var i=0;i<PROFILES.length;i++)if(PROFILES[i].id===id)return PROFILES[i];
    throw new RangeError('Unknown Mineral-study profile: '+id);
  }
  function getRecipe(id){
    if(id!=='mineral-pair')throw new RangeError('Unknown Mineral-study recipe: '+id);
    return PAIR;
  }
  // Monotone cubic Hermite interpolation. Unlike the frozen base renderer,
  // endpoint values belong to this recipe; the highlight endpoint is not 1.
  function compileCurve(points){
    var n=points.length,h=[],d=[],m=new Array(n),i;
    for(i=0;i<n-1;i++){h[i]=points[i+1][0]-points[i][0];d[i]=(points[i+1][1]-points[i][1])/h[i];}
    function endpoint(h0,h1,d0,d1){
      var slope=((2*h0+h1)*d0-h0*d1)/(h0+h1);
      if(slope*d0<=0)return 0;
      return Math.min(slope,3*d0);
    }
    m[0]=endpoint(h[0],h[1],d[0],d[1]);m[n-1]=endpoint(h[n-2],h[n-3],d[n-2],d[n-3]);
    for(i=1;i<n-1;i++){
      if(d[i-1]*d[i]<=0)m[i]=0;
      else{var a=2*h[i]+h[i-1],b=h[i]+2*h[i-1];m[i]=(a+b)/(a/d[i-1]+b/d[i]);}
    }
    var table=new Float64Array(4097),segment=0;
    for(i=0;i<=4096;i++){
      var x=i/4096;
      while(segment<n-2 && x>points[segment+1][0])segment++;
      var t=(x-points[segment][0])/h[segment],t2=t*t,t3=t2*t;
      table[i]=(2*t3-3*t2+1)*points[segment][1]+(t3-2*t2+t)*h[segment]*m[segment]+(-2*t3+3*t2)*points[segment+1][1]+(t3-t2)*h[segment]*m[segment+1];
    }
    table[0]=points[0][1];table[4096]=points[n-1][1];
    return table;
  }
  var lookup=compileCurve(MINERAL.toneCurve);
  function curve(value){
    if(value<=0)return lookup[0];if(value>=1)return lookup[4096];
    var x=value*4096,index=Math.floor(x),part=x-index;
    return lookup[index]+part*(lookup[index+1]-lookup[index]);
  }
  function smooth(value,span){var t=Math.max(0,Math.min(1,value/span));return t*t*(3-2*t);}
  function renderPixels(pixels,profileId,recipeId){
    getRecipe(recipeId);var profile=getProfile(profileId);
    if(profile.id==='original')return base.renderPixels(pixels,'original','backlight');
    if(profile.id==='a')return base.renderPixels(pixels,'b','backlight');
    if(Object.prototype.toString.call(pixels)!=='[object Uint8ClampedArray]' || pixels.length%4)throw new TypeError('Expected complete unpremultiplied RGBA pixels.');
    var out=new Uint8ClampedArray(pixels),mask=MINERAL.colorMasks;
    for(var i=0;i<pixels.length;i+=4){
      if(pixels[i+3]===0)continue;
      var r=pixels[i]/255,g=pixels[i+1]/255,b=pixels[i+2]/255;
      var y=WEIGHTS[0]*r+WEIGHTS[1]*g+WEIGHTS[2]*b;
      if(y<=0)continue;
      var target=curve(y);
      var green=smooth(g-Math.max(r,b),mask.greenSpan);
      var yellow=smooth(Math.min(r,g)-b,mask.yellowSpan)*(1-smooth(r-g,mask.yellowWarmExclusionSpan));
      var saturation=MINERAL.saturation*(1-green*(1-MINERAL.greenChroma))*(1-yellow*(1-MINERAL.yellowChroma));
      var warm=smooth(r-b,mask.warmRedBlueSpan)*smooth(r-g,mask.warmRedGreenSpan);
      var envelope=4*target*(1-target)*(1-warm*MINERAL.warmTintProtection);
      var blend=smooth(target-MINERAL.tintBlend.start,MINERAL.tintBlend.span);
      var tr=(MINERAL.shadowTint[0]*(1-blend)+MINERAL.highlightTint[0]*blend)*envelope;
      var tg=(MINERAL.shadowTint[1]*(1-blend)+MINERAL.highlightTint[1]*blend)*envelope;
      var tb=(MINERAL.shadowTint[2]*(1-blend)+MINERAL.highlightTint[2]*blend)*envelope;
      var tintLuma=WEIGHTS[0]*tr+WEIGHTS[1]*tg+WEIGHTS[2]*tb;
      var gain=target/y*saturation;
      var cr=(r-y)*gain+tr-tintLuma,cg=(g-y)*gain+tg-tintLuma,cb=(b-y)*gain+tb-tintLuma,scale=1;
      if(cr>0)scale=Math.min(scale,(1-target)/cr);else if(cr<0)scale=Math.min(scale,target/-cr);
      if(cg>0)scale=Math.min(scale,(1-target)/cg);else if(cg<0)scale=Math.min(scale,target/-cg);
      if(cb>0)scale=Math.min(scale,(1-target)/cb);else if(cb<0)scale=Math.min(scale,target/-cb);
      out[i]=Math.round(255*(target+scale*cr));out[i+1]=Math.round(255*(target+scale*cg));out[i+2]=Math.round(255*(target+scale*cb));
    }
    return out;
  }
  return freeze({
    VERSION:VERSION,BASE_RENDERER_SHA256:BASE_RENDERER_SHA256,
    PROFILES:PROFILES,getProfile:getProfile,getRecipe:getRecipe,renderPixels:renderPixels,
    METHOD:{
      input:'Unpremultiplied 8-bit RGBA, already rendered to sRGB.',lumaWeights:WEIGHTS,
      rendering:'A delegates to the complete frozen v2 backlight Rendering. Mineral applies its own monotone tone curve, selective green/yellow chroma reduction, luma-neutral tonal tints and common gamut contraction.',
      baseRendererVersion:base.VERSION,baseRendererSha256:BASE_RENDERER_SHA256,baseMethod:base.METHOD,
      assumptions:'The same fixed recipes apply to every supplied photo. No automatic scene selection, adaptive correction, or per-photo retuning. Curves operate on encoded display values, not RAW exposure.',
      limits:'A hand-authored reference-informed interpretation, not a recovered brand LUT, camera emulation, learned model or recovered detail. No masks, grain, blur, cropping, sharpening or generated scene content.'
    }
  });
});

var PhotoRendering=(function(frozen){
var grainMemo=null,balanceMemo=null,lookMemo=null;
'use strict';
  var WEIGHTS=[0.2126,0.7152,0.0722];
  var DEFAULTS=freeze({look:'mineral',amount:1,light:0,shadows:0,highlights:0,warmth:0,tint:0,grain:0,seed:1});
  var BALANCE=freeze({
    lightOddsScale:0.9,
    warmthVector:[0.05,0.005,-0.05],tintVector:[0.03,-0.015,0.03],
    colorEnvelope:'4 * targetLuma * (1 - targetLuma)',
    lumaWeights:WEIGHTS,
    tone:'target = exp(0.9 * light) * y / (1 + (exp(0.9 * light) - 1) * y)',
    rangeStrength:0.8,rangePower:3,
    ranges:'After Light: y += 0.8 * shadows * y * (1-y)^3; then y += 0.8 * highlights * y^3 * (1-y). Each mapping is monotone on [0,1] for controls in [-1,1], with fixed black and white endpoints.',
    color:'Warmth and tint vectors have weighted luma removed, then are multiplied by the envelope. Common chroma contraction preserves target luma before 8-bit rounding.'
  });
  var GRAIN=freeze({
    maxMidtoneRmsCodeValues:3.5,
    fineWeight:0.8,broadWeight:0.2,
    kernel:[0.25,0.5,0.25],finePasses:1,broadPasses:2,
    distribution:'Two signed uniform samples summed per pixel, followed by full-resolution separable binomial filtering at two scales. Their mixture is centered and normalized over the frame.',
    generator:'32-bit Weyl counter and two integer avalanche multiplications; seed and output dimensions fully determine the field.',
    generatorConstants:{increment:2654435769,multiplier1:569420461,multiplier2:1935289751},
    amplitude:'grain * 3.5 * sqrt(4 * encodedLuma * (1 - encodedLuma)) code values',
    headroom:'Signed delta is symmetrically limited by min(R, G, B, 255-R, 255-G, 255-B), avoiding one-sided clipping.',
    chroma:'The same signed delta is added to R, G and B; no independent color speckle.',
    limits:'An original dependency-free visual approximation, not a measured film stock or a physically validated simulation. Rounding and tone/headroom weighting can leave a small residual mean. Texture is defined at the final rendered pixel size and changes with dimensions.'
  });
  function freeze(value){
    if(value && typeof value==='object' && !Object.isFrozen(value)){
      Object.keys(value).forEach(function(key){freeze(value[key]);});Object.freeze(value);
    }
    return value;
  }
  function clamp(value,low,high){return Math.max(low,Math.min(high,value));}
  function normalizeOptions(input){
    if(input===undefined)input={};
    if(!input || typeof input!=='object' || Array.isArray(input))throw new TypeError('Expected a lab-options object.');
    var out={},keys=Object.keys(DEFAULTS);
    Object.keys(input).forEach(function(key){if(keys.indexOf(key)<0)throw new RangeError('Unknown lab option: '+key);});
    keys.forEach(function(key){out[key]=input[key]===undefined?DEFAULTS[key]:input[key];});
    if(['mineral','daylight','none'].indexOf(out.look)<0)throw new RangeError('Unknown lab look: '+out.look);
    ['amount','light','shadows','highlights','warmth','tint','grain'].forEach(function(key){
      if(typeof out[key]!=='number' || !Number.isFinite(out[key]))throw new TypeError('Expected a finite numeric '+key+'.');
      out[key]=clamp(out[key],key==='amount'||key==='grain'?0:-1,1);
    });
    if(typeof out.seed!=='number' || !Number.isInteger(out.seed) || out.seed<0 || out.seed>4294967295)throw new RangeError('Expected an unsigned 32-bit grain seed.');
    return out;
  }
  function validatePixels(pixels){
    if(Object.prototype.toString.call(pixels)!=='[object Uint8ClampedArray]' || pixels.length%4)throw new TypeError('Expected complete unpremultiplied RGBA pixels.');
  }
  function validateDimensions(pixels,width,height){
    validatePixels(pixels);
    if(!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width<1 || height<1 || !Number.isSafeInteger(width*height*4) || width*height*4!==pixels.length)throw new RangeError('Pixel dimensions must match the complete RGBA buffer.');
  }
  function balancePixels(pixels,input){
    validatePixels(pixels);var options=normalizeOptions(input),out=new Uint8ClampedArray(pixels);
    if(options.light===0 && options.shadows===0 && options.highlights===0 && options.warmth===0 && options.tint===0)return out;
    var k=Math.exp(BALANCE.lightOddsScale*options.light);
    var tr=BALANCE.warmthVector[0]*options.warmth+BALANCE.tintVector[0]*options.tint;
    var tg=BALANCE.warmthVector[1]*options.warmth+BALANCE.tintVector[1]*options.tint;
    var tb=BALANCE.warmthVector[2]*options.warmth+BALANCE.tintVector[2]*options.tint;
    var tintLuma=WEIGHTS[0]*tr+WEIGHTS[1]*tg+WEIGHTS[2]*tb;
    tr-=tintLuma;tg-=tintLuma;tb-=tintLuma;
    for(var i=0;i<pixels.length;i+=4){
      if(pixels[i+3]===0)continue;
      var r=pixels[i]/255,g=pixels[i+1]/255,b=pixels[i+2]/255;
      var y=WEIGHTS[0]*r+WEIGHTS[1]*g+WEIGHTS[2]*b;
      if(y<=0 || y>=1)continue;
      var target=k*y/(1+(k-1)*y);
      // Skip both operations when neutral to retain exact v1 floating-point behavior.
      if(options.shadows!==0)target+=BALANCE.rangeStrength*options.shadows*target*Math.pow(1-target,BALANCE.rangePower);
      if(options.highlights!==0)target+=BALANCE.rangeStrength*options.highlights*Math.pow(target,BALANCE.rangePower)*(1-target);
      var gain=target/y,envelope=4*target*(1-target);
      var cr=(r-y)*gain+tr*envelope,cg=(g-y)*gain+tg*envelope,cb=(b-y)*gain+tb*envelope,scale=1;
      if(cr>0)scale=Math.min(scale,(1-target)/cr);else if(cr<0)scale=Math.min(scale,target/-cr);
      if(cg>0)scale=Math.min(scale,(1-target)/cg);else if(cg<0)scale=Math.min(scale,target/-cg);
      if(cb>0)scale=Math.min(scale,(1-target)/cb);else if(cb<0)scale=Math.min(scale,target/-cb);
      out[i]=Math.round(255*(target+scale*cr));out[i+1]=Math.round(255*(target+scale*cg));out[i+2]=Math.round(255*(target+scale*cb));
    }
    return out;
  }
  function blur(field,temp,width,height){
    var x,y,i,left,right,up,down;
    for(y=0;y<height;y++)for(x=0;x<width;x++){
      i=y*width+x;left=x>0?i-1:i+(width>1?1:0);right=x+1<width?i+1:i-(width>1?1:0);
      temp[i]=0.25*field[left]+0.5*field[i]+0.25*field[right];
    }
    for(y=0;y<height;y++)for(x=0;x<width;x++){
      i=y*width+x;up=y>0?i-width:i+(height>1?width:0);down=y+1<height?i+width:i-(height>1?width:0);
      field[i]=0.25*temp[up]+0.5*temp[i]+0.25*temp[down];
    }
  }
  function grainField(width,height,seed){
    var n=width*height,field=new Float32Array(n),temp=new Float32Array(n),state=seed>>>0;
    function next(){
      state=(state+0x9e3779b9)>>>0;var z=state;
      z=Math.imul(z^(z>>>16),0x21f0aaad);z=Math.imul(z^(z>>>15),0x735a2d97);
      return ((z^(z>>>15))>>>0)/4294967296;
    }
    for(var i=0;i<n;i++)field[i]=next()+next()-1;
    blur(field,temp,width,height);
    var broad=new Float32Array(field);blur(broad,temp,width,height);
    var sum=0,sumSquares=0;
    for(i=0;i<n;i++){field[i]=GRAIN.fineWeight*field[i]+GRAIN.broadWeight*broad[i];sum+=field[i];}
    var mean=sum/n;
    for(i=0;i<n;i++){field[i]-=mean;sumSquares+=field[i]*field[i];}
    var deviation=Math.sqrt(sumSquares/n);
    if(deviation>1e-12)for(i=0;i<n;i++)field[i]/=deviation;
    return field;
  }
  function applyGrain(pixels,width,height,input){
    validateDimensions(pixels,width,height);var options=normalizeOptions(input),out=new Uint8ClampedArray(pixels);
    if(options.grain===0)return out;
    var fieldKey=width+":"+height+":"+options.seed;
    var field=grainMemo && grainMemo.key===fieldKey?grainMemo.field:grainField(width,height,options.seed);grainMemo={key:fieldKey,field:field};
    for(var p=0;p<field.length;p++){
      var i=p*4;if(pixels[i+3]===0)continue;
      var r=pixels[i],g=pixels[i+1],b=pixels[i+2],y=(WEIGHTS[0]*r+WEIGHTS[1]*g+WEIGHTS[2]*b)/255;
      var amplitude=options.grain*GRAIN.maxMidtoneRmsCodeValues*Math.sqrt(Math.max(0,4*y*(1-y)));
      var headroom=Math.min(r,g,b,255-r,255-g,255-b);
      var delta=clamp(field[p]*amplitude,-headroom,headroom);
      // Since source channels are integers, a common rounded delta keeps chroma exact.
      delta=Math.round(delta);out[i]=r+delta;out[i+1]=g+delta;out[i+2]=b+delta;
    }
    return out;
  }
  function renderPixels(pixels,width,height,input){
    validateDimensions(pixels,width,height);var options=normalizeOptions(input);
    var bk=JSON.stringify([options.light,options.shadows,options.highlights,options.warmth,options.tint]);
var balanced=balanceMemo && balanceMemo.pixels===pixels && balanceMemo.key===bk?balanceMemo.out:balancePixels(pixels,options),out=balanced;
balanceMemo={pixels:pixels,key:bk,out:balanced};
    if(options.look!=='none' && options.amount>0){
      var looked=lookMemo && lookMemo.pixels===balanced && lookMemo.look===options.look?lookMemo.out:frozen.renderPixels(balanced,options.look==='mineral'?'b':'a','mineral-pair');lookMemo={pixels:balanced,look:options.look,out:looked};
      if(options.amount===1)out=looked;
      else{
        out=new Uint8ClampedArray(balanced);
        for(var i=0;i<out.length;i+=4){
          if(out[i+3]===0)continue;
          out[i]=Math.round(balanced[i]+options.amount*(looked[i]-balanced[i]));
          out[i+1]=Math.round(balanced[i+1]+options.amount*(looked[i+1]-balanced[i+1]));
          out[i+2]=Math.round(balanced[i+2]+options.amount*(looked[i+2]-balanced[i+2]));
        }
      }
    }
    return options.grain>0?applyGrain(out,width,height,options):out;
  }
return Object.freeze({normalizeOptions:normalizeOptions,renderPixels:renderPixels});
})(TasteRendering);
var sourcePixels=null;
onmessage=function(e){var j=e.data;if(j.pixels)sourcePixels=new Uint8ClampedArray(j.pixels);var out=PhotoRendering.renderPixels(sourcePixels,j.w,j.h,j.options);postMessage({source:j.source,w:j.w,h:j.h,pixels:out.buffer},[out.buffer]);};
