var _n=Object.defineProperty;var Mn=(e,a,n)=>a in e?_n(e,a,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[a]=n;var k=(e,a,n)=>Mn(e,typeof a!="symbol"?a+"":a,n);import{j as l}from"./jsx-runtime-CmIOflP4.js";import{r as t}from"./index-KqYmeiyw.js";import{a8 as Sn,q as Q,a9 as Cn,a2 as Rn,a3 as wn,s as be,t as En,h as J,o as We,l as Fn,aa as Tn,ab as Vn,r as Dn,ac as Qe,F as De,_ as kn,p as On,D as qn,ad as Ln,$ as Ye,V as we,w as An,T as Pn,ae as ke}from"./CameraManager-BTlj_2qD.js";import{n as Ke,s as Oe,c as jn,a as $e,u as Ze}from"./AnnotationsLayer-Dj29EBht.js";import{E as zn,W as In,u as Nn,H as Un,C as Bn,a as Hn}from"./Wells-BiAlsh7x.js";import{D as qe}from"./Distance-Da7LZBFW.js";import{B as Gn,O as Wn}from"./BoxGrid-tOa6TNv3.js";import{u as Qn,O as Yn,a as Kn}from"./output-panel-decorator-DXohYIJy.js";import{a as Ee,b as $n,u as Xe}from"./useWellboreContext-l1cQXUDV.js";import{c as xe,L as _e}from"./uv-material-Cw8kPkQB.js";import{q as Fe}from"./limiter-DhBcc_yH.js";import{e as Je,f as en,R as nn,C as an,r as Zn,g as de,h as Xn,i as Jn,u as ea,o as na}from"./WellMapCasingShoes-wrjAVth2.js";import{t as aa}from"./numbers-DM6OWwIG.js";import{u as ra,G as ta,W as Le,w as Ae,a as oa}from"./generators-provider-decorator-BR7wOsTW.js";import{U as ia,a as Pe}from"./UtmPosition-D2cv2fVR.js";import{B as sa}from"./BasicTrajectory-2wYFDS2o.js";import{C as la}from"./Casings--iVSCNOQ.js";import{C as ua}from"./CompletionTools-DpgMl0yI.js";import{D as ca}from"./DepthMarkers-KMRPWUWH.js";import{S as rn,P as da}from"./Perforations-ChIdvImb.js";import{a as tn,T as je}from"./TubeTrajectory-DuMpWrKE.js";import{W as fa}from"./WellboreBounds-8fG3kb4k.js";import{W as ma}from"./WellboreLabel-CJKbspHD.js";import{A as pa}from"./annotations-decorator-35Z4NkoW.js";import{C as ha,a as ga}from"./canvas-3d-decorator-DXFES1_8.js";import{D as va}from"./data-provider-decorator-BCAx_xlJ.js";import{l as ya,u as ba}from"./useWellboreHeaders-GXAtugLG.js";import{s as ee}from"./story-args-Cgt5gSNS.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./react-Mgt78q4a.js";import"./Grid-BX9uDT_-.js";import"./Text-DbK8u8Ip.js";import"./CasingLabel-7b3hFzXc.js";import"./curve-3d-BSYPmKD_.js";const xa=Math.PI/180,_a=180/Math.PI,ne=18,on=.96422,sn=1,ln=.82521,un=4/29,H=6/29,cn=3*H*H,Ma=H*H*H;function dn(e){if(e instanceof q)return new q(e.l,e.a,e.b,e.opacity);if(e instanceof j)return fn(e);e instanceof nn||(e=Zn(e));var a=he(e.r),n=he(e.g),r=he(e.b),i=fe((.2225045*a+.7168786*n+.0606169*r)/sn),u,c;return a===n&&n===r?u=c=i:(u=fe((.4360747*a+.3850649*n+.1430804*r)/on),c=fe((.0139322*a+.0971045*n+.7141733*r)/ln)),new q(116*i-16,500*(u-i),200*(i-c),e.opacity)}function Sa(e,a,n,r){return arguments.length===1?dn(e):new q(e,a,n,r??1)}function q(e,a,n,r){this.l=+e,this.a=+a,this.b=+n,this.opacity=+r}Je(q,Sa,en(an,{brighter(e){return new q(this.l+ne*(e??1),this.a,this.b,this.opacity)},darker(e){return new q(this.l-ne*(e??1),this.a,this.b,this.opacity)},rgb(){var e=(this.l+16)/116,a=isNaN(this.a)?e:e+this.a/500,n=isNaN(this.b)?e:e-this.b/200;return a=on*me(a),e=sn*me(e),n=ln*me(n),new nn(pe(3.1338561*a-1.6168667*e-.4906146*n),pe(-.9787684*a+1.9161415*e+.033454*n),pe(.0719453*a-.2289914*e+1.4052427*n),this.opacity)}}));function fe(e){return e>Ma?Math.pow(e,1/3):e/cn+un}function me(e){return e>H?e*e*e:cn*(e-un)}function pe(e){return 255*(e<=.0031308?12.92*e:1.055*Math.pow(e,1/2.4)-.055)}function he(e){return(e/=255)<=.04045?e/12.92:Math.pow((e+.055)/1.055,2.4)}function Ca(e){if(e instanceof j)return new j(e.h,e.c,e.l,e.opacity);if(e instanceof q||(e=dn(e)),e.a===0&&e.b===0)return new j(NaN,0<e.l&&e.l<100?0:NaN,e.l,e.opacity);var a=Math.atan2(e.b,e.a)*_a;return new j(a<0?a+360:a,Math.sqrt(e.a*e.a+e.b*e.b),e.l,e.opacity)}function Me(e,a,n,r){return arguments.length===1?Ca(e):new j(e,a,n,r??1)}function j(e,a,n,r){this.h=+e,this.c=+a,this.l=+n,this.opacity=+r}function fn(e){if(isNaN(e.h))return new q(e.l,0,0,e.opacity);var a=e.h*xa;return new q(e.l,Math.cos(a)*e.c,Math.sin(a)*e.c,e.opacity)}Je(j,Me,en(an,{brighter(e){return new j(this.h,this.c,this.l+ne*(e??1),this.opacity)},darker(e){return new j(this.h,this.c,this.l-ne*(e??1),this.opacity)},rgb(){return fn(this).rgb()}}));function Ra(e){return function(a,n){var r=e((a=Me(a)).h,(n=Me(n)).h),i=de(a.c,n.c),u=de(a.l,n.l),c=de(a.opacity,n.opacity);return function(v){return a.h=r(v),a.c=i(v),a.l=u(v),a.opacity=c(v),a+""}}}const wa=Ra(Xn);function Ea(e,a){a===void 0&&(a=e,e=Jn);for(var n=0,r=a.length-1,i=a[0],u=new Array(r<0?0:r);n<r;)u[n]=e(i,i=a[++n]);return function(c){var v=Math.max(0,Math.min(r-1,Math.floor(c*=r)));return u[v](c-v)}}const Fa="surfaceGeometry";var Ta=`#define MESH_SURFACE_MATERIAL

varying vec3 vViewPosition;

#include <common>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>

	#include <beginnormal_vertex>
  #include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>

	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>

	vViewPosition = - mvPosition.xyz;

	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Va=`#define MESH_SURFACE_MATERIAL

uniform sampler2D normalTexture;
uniform mat3 normalMatrix;
uniform float referenceDepth;
uniform sampler2D depthTexture;

#ifdef USE_COLOR_RAMP

uniform sampler2D colorRampTexture;
uniform int colorRampIndex;
uniform float colorRampMin;
uniform float colorRampMax;
uniform bool colorRampReverse;
uniform int colorRamps;

#endif

#ifdef USE_CONTOURS

uniform float contoursInterval;
uniform int contoursColorMode;
uniform float contoursColorModeFactor;
uniform float contoursThickness;
uniform vec3 contoursColor;

#endif

uniform float saturation;
uniform float brightness;
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;

#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>

#ifndef FLAT_SHADED
  
	#ifdef USE_TANGENT
varying vec3 vTangent;
varying vec3 vBitangent;
	#endif
#endif
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

vec3 hue2rgb(in float H) {
  float R = abs(H * 6. - 3.) - 1.;
  float G = 2. - abs(H * 6. - 2.);
  float B = 2. - abs(H * 6. - 4.);
  return saturate(vec3(R, G, B));
}

vec3 hsl2rgb(in vec3 HSL) {
  vec3 RGB = hue2rgb(HSL.x);
  float C = (1. - abs(2. * HSL.z - 1.)) * HSL.y;
  return (RGB - 0.5) * C + HSL.z;
}

vec3 rgb2hsv(in vec3 RGB) {
  
  vec4 P = (RGB.g < RGB.b) ? vec4(RGB.bg, -1.0, 2.0 / 3.0) : vec4(RGB.gb, 0.0, -1.0 / 3.0);
  vec4 Q = (RGB.r < P.x) ? vec4(P.xyw, RGB.r) : vec4(RGB.r, P.yzx);
  float C = Q.x - min(Q.w, Q.y);
  float H = abs((Q.w - Q.y) / (6. * C + EPSILON) + Q.z);
  return vec3(H, C, Q.x);
}

vec3 rgb2hsl(in vec3 RGB) {
  vec3 HCV = rgb2hsv(RGB);
  float L = HCV.z - HCV.y * 0.5;
  float S = HCV.y / (1. - abs(L * 2. - 1.) + EPSILON);
  return vec3(HCV.x, S, L);
}

vec3 hsv2rgb(in vec3 HSV) {
  vec3 RGB = hue2rgb(HSV.x);
  return ((RGB - 1.) * HSV.y + 1.) * HSV.z;
}

vec3 adjustColor(vec3 color, float saturation, float brightness) {
  vec3 hsl = rgb2hsl(color);
  hsl.y = hsl.y * saturation; 
  vec3 rgb = hsl2rgb(hsl);
  rgb += vec3(brightness);
  return clamp(rgb, 0.0, 1.0);
}

#ifdef USE_COLOR_RAMP

vec3 getColor(float v) {
  float min = colorRampMin;
  float max = colorRampMax;

  float t = clamp((v - min) / (max - min), 0.0, 1.0);
  if(colorRampReverse) {
    t = 1.0 - t;
  }
  vec4 texel = texture2D(colorRampTexture, vec2(t, (float(colorRampIndex) + 0.5) / float(colorRamps)));
  return texel.rgb;
}

#endif

float getPointValue(vec2 pos) {
  vec4 pixel = texture2D(depthTexture, pos);
  if(pixel.a == 0.)
    return -1.;
  return (referenceDepth - ((pixel.r * 256. * 256. * 256.) + (pixel.g * 256. * 256.) + (pixel.b * 256.)) / 1000.);
}

#ifdef USE_CONTOURS

float contourLine(float v) {
  float f = abs(fract(v) - .5);
  float df = fwidth(v) * contoursThickness;
  return smoothstep(0., df, f);
}

#endif

void main() {

  vec3 textureNormal = texture2D(normalTexture, vUv).rgb * 2. - 1.;
  vec3 vNormal = normalize(normalMatrix * textureNormal);
 
	#include <clipping_planes_fragment>

  vec4 diffuseColor = vec4(diffuse, opacity);
  
  float texDepth = getPointValue(vUv.xy);
  
  if(texDepth <= -1.) {
     discard;
  }
  
  #ifdef USE_COLOR_RAMP
  
  vec3 sampledColor = getColor(texDepth);
  diffuseColor = vec4(sampledColor, opacity);

  #endif

  #ifdef USE_CONTOURS
  float h = (texDepth + contoursInterval / 2.) / contoursInterval;

  float t = contourLine(h);
  
  float colorMod = 1.;

  if (contoursColorMode == 0) { 
    colorMod = 1. - (1. - t) * contoursColorModeFactor;
  } else if (contoursColorMode == 1) { 
    colorMod = 1.0 + (1. - t) * contoursColorModeFactor;
  }

  #endif

  ReflectedLight reflectedLight = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
  vec3 totalEmissiveRadiance = emissive;

	#include <logdepthbuf_fragment>
	#include <map_fragment>

  
  diffuseColor = vec4(adjustColor(diffuseColor.rgb, saturation, brightness), diffuseColor.w);

	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>

	
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>

	
	#include <aomap_fragment>

  vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;

  #ifdef USE_CONTOURS
  outgoingLight *= colorMod;
  
  if (contoursColorMode == 2) { 
    outgoingLight = mix(outgoingLight, contoursColor, (1. - t) * contoursColorModeFactor);
  }

  #endif
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>

  

}`;function Da(e,a){const n=e.length,r=document.createElement("canvas");r.width=a,r.height=n,r.style.imageRendering="-moz-crisp-edges",r.style.imageRendering="pixelated";const i=r.getContext("2d");if(i)for(let u=0;u<e.length;u++)e[u](i,u);return r}function O(e,a){return(n,r)=>{const i=n.canvas.width,u=n.canvas.width/(i-1);for(let c=0;c<i;++c)n.fillStyle=e(c/(i-1)),n.fillRect(c*u,r,u+1,1)}}const L=e=>a=>Ea(wa,e)(Math.min(Math.max(0,a),1)),ka=L(["#5d198e","#2319a1","#185db6","#16c1ca","#14e083","#19ef20","#88f427","#f5f835","#fca245","#ff5555"]),Oa=L(["#000083","#001e97","#003caa","#0163bb","#028acc","#03b1dd","#04d8ee","#05ffff","#37ffcc","#69ff99","#9bff66","#cdff33","#ffff00","#fecc00","#fd9900","#fc6600","#fb3300","#fa0000","#bd0000","#800000"]),qa=L(["#0c3383","#0c448e","#0b5599","#0b66a4","#0a77af","#0a88ba","#3897a0","#67a686","#95b56c","#c4c452","#f2d338","#f2c238","#f2b138","#f2a038","#f28f38","#ed7833","#e8622e","#e34b28","#de3523","#d91e1e"]),La=L(["#000082","#005a9b","#00b4b4","#14c36e","#28d228","#58d72b","#87dc2d","#b7e130","#e6e632","#c1b128","#9d7b1e","#784614","#895d31","#9a744f","#ab8b6c","#bca38a","#ccbaa7","#ddd1c4","#eee8e2","#ffffff"]),Aa=L(["#0d0887","#2c0694","#4b03a1","#5c03a3","#6c03a6","#7d03a8","#93139f","#a82296","#b42e8c","#bf3a83","#cb4679","#d8596b","#e56b5d","#ef804f","#f89441","#faa439","#fbb330","#fdc328","#f7de25","#f0f921"]),Pa=L(["#2a186c","#262587","#2132a2","#1b3f9c","#154d97","#0f5a91","#1c688d","#287689","#2e7f88","#358988","#3b9287","#45a183","#4faf7e","#64bd73","#78cb68","#90d167","#a9d765","#c1dd64","#dfe67f","#fdef9a"]),ja=L(["#ffe700","#ffdf00","#ffd600","#ffce00","#ffc500","#ffbc00","#ffb400","#ffab00","#ffa200","#ff9a00","#ff9100","#ff8900","#ff8000","#ff7700","#ff6f00","#ff6600","#ff5e00","#ff5500","#f55400","#ea5200","#e05100","#d55000","#cb4e00","#c04d00","#b64b00","#ab4a00","#a14900","#964700","#8c4600","#925213","#975d25","#9d6938","#a2744a","#a8805d","#ad8b6f","#b39782","#b8a294","#beaea7","#c3b9b9","#b7aeae","#aaa2a2","#9e9797","#918b8b","#858080","#787474","#6c6969","#5f5d5d","#535252","#464646","#404057","#393968","#333378","#2d2d89","#26269a","#2020ab","#1919bc","#1313cd","#0d0ddd","#0606ee","#0000ff","#000cff","#0018ff","#0024ff","#0030ff","#003cff","#0048ff","#0054ff","#0060ff","#006cff","#0078ff","#0084ff","#0090ff","#009cff","#00a8ff","#00b4ff","#00c0ff","#00ccff","#00d8ff","#00e4ff","#00f0ff"]),za=L(["#00004c","#000092","#0000db","#3131ff","#9999ff","#fdfdff","#ff9999","#ff3535","#e60000","#b30000","#800000"]),Ia=L(["#ffffff","#FFFFBD","#FFFF71","#FFFF24","#FFE300","#FF9100","#F90600","#DB2400","#C03F00","#A45B00","#6D9200","#3AD500","#00FF00","#00EA1E","#00C03F","#009F60","#00AF87","#00CCB3","#00ECD9","#03FBFF","#19F0FF","#2ED1FF","#44BBFF","#4F9EFF","#3870FF","#2143FF","#0B15FF","#180CFF","#4623FF","#7038FF","#A150FF","#BA45FF","#D12EFF","#E817FF","#FF00FF","#CD00D7","#9900AE","#660085","#300059","#0B003C"]),Na=L(["#000","#fff"]),mn=[O(e=>ka(1-e)),O(e=>Oa(1-e)),O(e=>qa(1-e)),O(e=>La(1-e)),O(e=>Aa(1-e)),O(e=>Pa(1-e)),O(e=>ja(1-e)),O(e=>za(1-e)),O(e=>Ia(1-e)),O(e=>Na(1-e))],Ua=Da(mn,512),I=new Sn(Ua);I.magFilter=Q;I.minFilter=Cn;I.flipY=!1;I.generateMipmaps=!1;I.colorSpace=Rn;I.format=wn;I.anisotropy=4;var Te=(e=>(e[e.darken=0]="darken",e[e.lighten=1]="lighten",e[e.mixed=2]="mixed",e))(Te||{});const $={name:"MeshSurfaceShader",defines:{USE_COLOR_RAMP:!1,USE_CONTOURS:!1,USE_UV:!0},uniforms:be.merge([be.clone(En.lambert.uniforms),{colorRampIndex:{value:0},colorRamps:{value:mn.length},colorRampReverse:{value:!0},colorRampMin:{value:800},colorRampMax:{value:1e3},colorRampTexture:{value:null},referenceDepth:{value:1e3},saturation:{value:1},brightness:{value:0},depthTexture:{value:null},normalTexture:{value:null},contoursInterval:{value:100},contoursColorMode:{value:0},contoursColorModeFactor:{value:.5},contoursColor:{value:new J("black")},contoursThickness:{value:.8},size:{value:new We}}]),vertexShader:Ta,fragmentShader:Va};class Ba extends Fn{constructor(n){super();k(this,"isMeshSurfaceShader",!0);k(this,"normalScale");k(this,"map");k(this,"normalMap");k(this,"wireframeLinecap");k(this,"wireframeLinejoin");k(this,"flatShading");k(this,"combine");k(this,"normalMapType");this.defines=Object.assign({},$.defines),this.uniforms=be.clone($.uniforms),this.vertexShader=$.vertexShader,this.fragmentShader=$.fragmentShader,this.combine=Tn,this.normalMapType=Vn,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.lights=!0,this.clipping=!0,this.fog=!0;const r=["map","lightMap","lightMapIntensity","aoMap","aoMapIntensity","emissive","emissiveIntensity","emissiveMap","specularMap","alphaMap","envMap","reflectivity","refractionRatio","opacity","diffuse","normalMap","normalScale","referenceDepth","colorRampIndex","colorRampMin","colorRampMax","colorRampReverse","saturation","brightness","contoursInterval","contoursColorMode","contoursColorModeFactor","contoursThickness","normalTexture","depthTexture"];for(const i of r)Object.defineProperty(this,i,{get:function(){return this.uniforms[i].value},set:function(u){this.uniforms[i].value=u}});this.normalScale=new We(.25,.25),this.color="white",this.setValues(n)}get color(){return"#"+this.uniforms.diffuse.value.getHexString()}set color(n){this.uniforms.diffuse.value=new J(n)}get contoursColor(){return"#"+this.uniforms.contoursColor.value.getHexString()}set contoursColor(n){this.uniforms.contoursColor.value=new J(n)}get useColorRamp(){return this.defines.USE_COLOR_RAMP||!1}set useColorRamp(n){this.defines.USE_COLOR_RAMP=!!n,this.uniforms.colorRampTexture.value=this.defines.USE_COLOR_RAMP?I:null,this.needsUpdate=!0}get showContours(){return this.defines.USE_CONTOURS||!1}set showContours(n){this.defines.USE_CONTOURS=!!n,this.needsUpdate=!0}dispose(){var n;super.dispose(),(n=this.uniforms.depthTexture.value)==null||n.dispose()}onBeforeCompile(){this.map&&(this.map.matrixAutoUpdate===!0&&this.map.updateMatrix(),this.uniforms.mapTransform.value.copy(this.map.matrix)),this.normalMap&&(this.normalMap.matrixAutoUpdate===!0&&this.normalMap.updateMatrix(),this.uniforms.normalMapTransform.value.copy(this.normalMap.matrix))}}function Z(e,a,n){const r=Oe(e,a),i=Oe(e,n);return Ke(jn(r,i))}function Ha(e,a,n,r,i=-1){const u=e.length/a,c=a-1,v=u-1;let b=0;const h=(p,y)=>e[y*a+p],x=new Array(c*v);for(let p=0;p<v;p++){const y=p+1,S=p+.5;for(let g=0;g<c;g++){const d=g+1,o=g+.5,_=h(g,p);if(_!==i){const s=h(g,y),R=h(d,p),w=h(d,y),M=(_+s+R+w)/4,m=[g*n,p*r,_],V=[g*n,y*r,s],E=[d*n,p*r,R],A=[d*n,y*r,w],z=[o*n,S*r,M],D=Z(z,m,E),N=Z(z,E,A),U=Z(z,A,V),B=Z(z,V,m),G=Ke([D[0]+N[0]+U[0]+B[0],D[2]+N[2]+U[2]+B[2],D[1]+N[1]+U[1]+B[1]]);x[b++]=G}else x[b++]=[0,0,0]}}return{normals:x,columns:c}}function Ga(e,a,n,r,i,u=-1){const{normals:c,columns:v}=Ha(e,a,n,r,u),b=new Uint8Array(c.length*4);for(let p=0;p<c.length;p++){const y=Dn(c[p],[0,1,0],i*(Math.PI/180)),S=Math.floor((y[0]+1)/2*255),g=Math.floor((y[1]+1)/2*255),d=Math.floor((y[2]+1)/2*255),o=p*4;b[o]=S,b[o+1]=g,b[o+2]=d,b[o+3]=255}const h=c.length/v,x=new Qe(b,v,h);return x.minFilter=Q,x.magFilter=Q,x.flipY=!0,x.anisotropy=4,x.needsUpdate=!0,x}const Se=({meta:e,color:a,colorRamp:n=0,rampMin:r,rampMax:i,reverseRamp:u=!1,useColorRamp:c=!0,showContours:v=!1,contoursInterval:b=100,contoursColorMode:h=Te.darken,contoursColorModeFactor:x=.5,contoursThickness:p=.8,contoursColor:y="black",opacity:S=1,priority:g=0,maxError:d=5,doubleSide:o=S===1||!1,wireframe:_=!1,normalMap:s,normalScale:R,name:w,userData:M,receiveShadow:m,castShadow:V,layers:E=xe(_e.OCCLUDER),position:A,renderOrder:z=10,visible:D=!0,onPointerClick:N,onPointerEnter:U,onPointerLeave:B,onPointerMove:G})=>{const Y=t.useRef(null),ae=Ee(Fa),re=ea(),[te,Ve]=t.useState(!1),[oe,hn]=t.useState(null),[ie,gn]=t.useState(null),[se,vn]=t.useState(null),yn=t.useMemo(()=>xe(_e.NOT_EMITTER),[]),f=t.useMemo(()=>new Ba({useColorRamp:!0,forceSinglePass:!0,saturation:1,brightness:0,colorRampIndex:0,colorRampReverse:!1,colorRampMin:e.displayMin,colorRampMax:e.displayMax,referenceDepth:e.max,normalMap:s,side:De,wireframe:!1,flatShading:!1,transparent:!0,opacity:1}),[e,s]),bn=t.useMemo(()=>new kn({transparent:!0,side:On,colorWrite:!1,depthWrite:!0}),[]),le=ra();return t.useEffect(()=>{let C=null;if(te&&le&&Y.current){const F={};N&&(F.click=N),U&&(F.enter=U),B&&(F.leave=B),G&&(F.move=G),Object.keys(F).length&&(C=le.register(Y.current,F,e.id))}return()=>{C&&C()}},[le,N,U,B,G,te,e.id]),t.useEffect(()=>{f.uniforms.colorRampIndex.value=n,f.uniforms.opacity.value=S,f.uniforms.contoursColorMode.value=h,f.uniforms.contoursColorModeFactor.value=x,f.uniforms.contoursInterval.value=b,f.uniforms.contoursThickness.value=p,f.uniforms.colorRampMin.value=r,f.uniforms.colorRampMax.value=i,f.uniforms.colorRampReverse.value=u,R&&f.uniforms.normalScale.value.set(...R)},[f,n,S,v,h,x,b,p,r,i,u,R]),t.useEffect(()=>{f.wireframe=_,f.showContours=v,f.contoursColor=y,f.useColorRamp=c,f.color=a||f.color,f.side=o?qn:De},[f,c,v,_,y,a,o]),t.useEffect(()=>{re&&re.get("surface-values",e.id).then(C=>{if(C&&C instanceof Float32Array){const F=new Uint8Array(C.length*4);for(let T=0;T<C.length;T++){const ue=C[T],ce=ue===-1?[0,0,0]:aa(ue),K=T*4;F[K]=ce[0],F[K+1]=ce[1],F[K+2]=ce[2],F[K+3]=ue===-1?0:255}const P=new Qe(F,e.header.nx,e.header.ny);P.minFilter=Q,P.magFilter=Q,P.needsUpdate=!0,P.flipY=!0;const xn=Ga(C,e.header.nx,e.header.xinc,e.header.yinc,e.header.rot);vn(T=>(T&&T.dispose(),xn||T)),gn(T=>(T&&T.dispose(),P||T))}})},[re,e.id,e.header.nx,e.header.ny,e.header.xinc,e.header.yinc,e.header.rot]),t.useEffect(()=>{Ve(!1),ae&&Fe(()=>ae(e.id,d).then(C=>{let F=null;C&&(F=$n(C)),hn(P=>(P&&P.dispose(),F||P)),Ve(!0)}),g)},[ae,e,d,g]),t.useEffect(()=>{ie&&f&&(f.uniforms.depthTexture.value=ie)},[ie,f]),t.useEffect(()=>{se&&f&&(f.uniforms.normalTexture.value=se)},[se,f]),t.useEffect(()=>()=>{var C;(C=f.normalMap)==null||C.dispose(),f.dispose()},[f]),!te||!oe||!e?null:l.jsxs("group",{name:w,userData:M,visible:D,renderOrder:z,position:A,children:[S<1&&l.jsx("mesh",{ref:Y,geometry:oe,material:bn,renderOrder:1,layers:yn}),l.jsx("mesh",{ref:Y,castShadow:V,receiveShadow:m,geometry:oe,material:f,layers:E,renderOrder:2})]})};try{Se.displayName="Surface",Se.__docgenInfo={description:`This component renderes a TIN model from an elevation map, according to the \`SurfaceMeta\` and \`SurfaveValues\` data types.

It has several customization options for rendering the surfaces, including color ramps, contour lines and transparency.

Surface values are expected to be in a regular grid. An optimized triangulation is used for the geometry, but color ramp 
values and contour lines are always using the full resolution of the data for accuracy. 

The surface requires the \`SurfaceMeta\` type as input data. It will fetch the \`SurfaceValues\` on the component side
from the store. This is because the component will need this data to generate a data texture and calculate normals at a 
higher resolution than the generated geometry.`,displayName:"Surface",props:{name:{defaultValue:null,description:"",name:"name",required:!1,type:{name:"string | undefined"}},visible:{defaultValue:{value:"true"},description:"",name:"visible",required:!1,type:{name:"boolean | undefined"}},userData:{defaultValue:null,description:"",name:"userData",required:!1,type:{name:"Record<string, any> | undefined"}},position:{defaultValue:null,description:"",name:"position",required:!1,type:{name:"Vec3 | undefined"}},castShadow:{defaultValue:null,description:"",name:"castShadow",required:!1,type:{name:"boolean | undefined"}},receiveShadow:{defaultValue:null,description:"",name:"receiveShadow",required:!1,type:{name:"boolean | undefined"}},renderOrder:{defaultValue:{value:"10"},description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}},layers:{defaultValue:{value:"createLayers(LAYERS.OCCLUDER)"},description:"",name:"layers",required:!1,type:{name:"Layers | undefined"}},onPointerEnter:{defaultValue:null,description:"",name:"onPointerEnter",required:!1,type:{name:"EventEmitterCallback | undefined"}},onPointerLeave:{defaultValue:null,description:"",name:"onPointerLeave",required:!1,type:{name:"EventEmitterCallback | undefined"}},onPointerMove:{defaultValue:null,description:"",name:"onPointerMove",required:!1,type:{name:"EventEmitterCallback | undefined"}},onPointerClick:{defaultValue:null,description:"",name:"onPointerClick",required:!1,type:{name:"EventEmitterCallback | undefined"}},meta:{defaultValue:null,description:"",name:"meta",required:!0,type:{name:"SurfaceMeta"}},color:{defaultValue:null,description:"",name:"color",required:!1,type:{name:"string | undefined"}},colorRamp:{defaultValue:{value:"0"},description:"",name:"colorRamp",required:!1,type:{name:"number | undefined"}},rampMin:{defaultValue:null,description:"",name:"rampMin",required:!1,type:{name:"number | undefined"}},rampMax:{defaultValue:null,description:"",name:"rampMax",required:!1,type:{name:"number | undefined"}},reverseRamp:{defaultValue:{value:"false"},description:"",name:"reverseRamp",required:!1,type:{name:"boolean | undefined"}},useColorRamp:{defaultValue:{value:"true"},description:"",name:"useColorRamp",required:!1,type:{name:"boolean | undefined"}},showContours:{defaultValue:{value:"false"},description:"",name:"showContours",required:!1,type:{name:"boolean | undefined"}},contoursInterval:{defaultValue:{value:"100"},description:"",name:"contoursInterval",required:!1,type:{name:"number | undefined"}},contoursColorMode:{defaultValue:{value:"ContourColorMode.darken"},description:"",name:"contoursColorMode",required:!1,type:{name:"ContourColorMode | undefined"}},contoursColorModeFactor:{defaultValue:{value:"0.5"},description:"",name:"contoursColorModeFactor",required:!1,type:{name:"number | undefined"}},contoursThickness:{defaultValue:{value:"0.8"},description:"",name:"contoursThickness",required:!1,type:{name:"number | undefined"}},contoursColor:{defaultValue:{value:"black"},description:"",name:"contoursColor",required:!1,type:{name:"string | undefined"}},opacity:{defaultValue:{value:"1"},description:"",name:"opacity",required:!1,type:{name:"number | undefined"}},priority:{defaultValue:{value:"0"},description:"",name:"priority",required:!1,type:{name:"number | undefined"}},maxError:{defaultValue:{value:"5"},description:"",name:"maxError",required:!1,type:{name:"number | undefined"}},doubleSide:{defaultValue:{value:"opacity === 1 || false"},description:"",name:"doubleSide",required:!1,type:{name:"boolean | undefined"}},wireframe:{defaultValue:{value:"false"},description:"",name:"wireframe",required:!1,type:{name:"boolean | undefined"}},normalMap:{defaultValue:null,description:"",name:"normalMap",required:!1,type:{name:"Texture | undefined"}},normalScale:{defaultValue:null,description:"",name:"normalScale",required:!1,type:{name:"Vec2 | undefined"}}}}}catch{}const Wa="pickSymbols",ze=new Ye,ge=new we,Ie=new J,Ce=t.forwardRef(({name:e,userData:a,position:n,visible:r,renderOrder:i,layers:u=xe(_e.NOT_EMITTER),castShadow:c,receiveShadow:v,radialSegments:b=8,baseRadius:h=10,priority:x=0,showAnnotations:p=!0},y)=>{const S=t.useRef(null),{id:g,fromMsl:d}=Xe(),o=Ee(Wa),{addAnnotations:_}=$e("picks",g),[s,R]=t.useState(null);t.useImperativeHandle(y,()=>S.current);const w=t.useMemo(()=>new Ln(1,1,.1,b,1,!1),[b]),M=t.useMemo(()=>new tn,[]);return t.useEffect(()=>{o&&g&&Fe(()=>o(g,d,h).then(m=>{R(m)}),x)},[o,g,d,h,x]),t.useEffect(()=>{let m=null;if(p&&s&&s.data&&_){const V=s.data.map((E,A)=>{var D;return ze.fromArray(s.transformations,A*16),ge.setFromMatrixPosition(ze),(D=S.current)==null||D.localToWorld(ge),Ie.fromArray(s.colors,A*3),{id:E.id,name:E.name,position:ge.toArray(),direction:E.direction,priority:E.level,data:{depth:E.depth,tvd:E.tvd,color:Ie.getHexString()}}});m=_(V)}return()=>{m&&m()}},[s,_,p]),l.jsx("group",{ref:S,children:s&&l.jsx(rn,{name:e,userData:a,renderOrder:i,visible:r,position:n,data:s,geometry:w,material:M,layers:u,castShadow:c,receiveShadow:v})})});try{Ce.displayName="Picks",Ce.__docgenInfo={description:"Render pick markers along a wellbore trajectory. This uses the `Symbols` component internally.",displayName:"Picks",props:{name:{defaultValue:null,description:"",name:"name",required:!1,type:{name:"string | undefined"}},visible:{defaultValue:null,description:"",name:"visible",required:!1,type:{name:"boolean | undefined"}},userData:{defaultValue:null,description:"",name:"userData",required:!1,type:{name:"Record<string, any> | undefined"}},position:{defaultValue:null,description:"",name:"position",required:!1,type:{name:"Vec3 | undefined"}},castShadow:{defaultValue:null,description:"",name:"castShadow",required:!1,type:{name:"boolean | undefined"}},receiveShadow:{defaultValue:null,description:"",name:"receiveShadow",required:!1,type:{name:"boolean | undefined"}},renderOrder:{defaultValue:null,description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}},layers:{defaultValue:{value:"createLayers(LAYERS.NOT_EMITTER)"},description:"",name:"layers",required:!1,type:{name:"Layers | undefined"}},radialSegments:{defaultValue:{value:"8"},description:"",name:"radialSegments",required:!1,type:{name:"number | undefined"}},baseRadius:{defaultValue:{value:"10"},description:"",name:"baseRadius",required:!1,type:{name:"number | undefined"}},priority:{defaultValue:{value:"0"},description:"",name:"priority",required:!1,type:{name:"number | undefined"}},showAnnotations:{defaultValue:{value:"true"},description:"",name:"showAnnotations",required:!1,type:{name:"boolean | undefined"}}}}}catch{}const Qa="shoeSymbols",Ne=new Ye,ve=new we,Re=t.forwardRef(({name:e,userData:a,position:n,visible:r,renderOrder:i,layers:u,castShadow:c,receiveShadow:v,radialSegments:b=16,sizeMultiplier:h=10,color:x="#ffbb00",priority:p=0},y)=>{const S=t.useRef(null),{id:g,fromMsl:d}=Xe(),o=Ee(Qa),{addAnnotations:_}=$e("shoes",g),[s,R]=t.useState(null);t.useImperativeHandle(y,()=>S.current);const w=t.useMemo(()=>{const m=new An(1,2,b||16,1,!1);return m.translate(0,1,0),m},[b]),M=t.useMemo(()=>{const m=new tn;return m.color.set(x),m},[x]);return t.useEffect(()=>{o&&g&&Fe(()=>o(g,d,h).then(m=>{R(m)}),p)},[o,g,d,h,p]),t.useEffect(()=>{let m=null;if(s){const V=s.data.map((E,A)=>{var D;return Ne.fromArray(s.transformations,A*16),ve.setFromMatrixPosition(Ne),(D=S.current)==null||D.localToWorld(ve),{id:E.id,name:E.name,position:ve.toArray(),direction:E.direction}});m=_(V)}return()=>{m&&m()}},[s,_]),l.jsx("group",{ref:S,children:s&&l.jsx(rn,{name:e,userData:a,renderOrder:i,visible:r,position:n,data:s,geometry:w,material:M,layers:u,castShadow:c,receiveShadow:v})})});try{Re.displayName="Shoes",Re.__docgenInfo={description:"Render shoe markers along a wellbore trajectory. This uses the `Symbols` component internally.",displayName:"Shoes",props:{name:{defaultValue:null,description:"",name:"name",required:!1,type:{name:"string | undefined"}},visible:{defaultValue:null,description:"",name:"visible",required:!1,type:{name:"boolean | undefined"}},userData:{defaultValue:null,description:"",name:"userData",required:!1,type:{name:"Record<string, any> | undefined"}},position:{defaultValue:null,description:"",name:"position",required:!1,type:{name:"Vec3 | undefined"}},castShadow:{defaultValue:null,description:"",name:"castShadow",required:!1,type:{name:"boolean | undefined"}},receiveShadow:{defaultValue:null,description:"",name:"receiveShadow",required:!1,type:{name:"boolean | undefined"}},renderOrder:{defaultValue:null,description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}},layers:{defaultValue:null,description:"",name:"layers",required:!1,type:{name:"Layers | undefined"}},radialSegments:{defaultValue:{value:"16"},description:"",name:"radialSegments",required:!1,type:{name:"number | undefined"}},sizeMultiplier:{defaultValue:{value:"10"},description:"",name:"sizeMultiplier",required:!1,type:{name:"number | undefined"}},color:{defaultValue:{value:"#ffbb00"},description:"",name:"color",required:!1,type:{name:"string | number | Color | undefined"}},priority:{defaultValue:{value:"0"},description:"",name:"priority",required:!1,type:{name:"number | undefined"}}}}}catch{}const Ya=()=>{const[e,a]=t.useState({});return t.useEffect(()=>{ya().then(n=>{n&&a(n)})},[]),e},Ka=new Pn,W=Ka.load("normal_map.jpg");W.anisotropy=4;const pn=na(["tomato","#4e79a7","#f28e2c","#76b7b2","#59a14f","#edc949","#af7aa1","#ff9da7","#9c755f","#86a68c","darkgreen","purple","#c3b380"]),$a=ee.utmZone,ye=ee.origin,Ue=new we,Za=e=>{const[a,n]=t.useState(e.selected),r=t.useRef(null),[i,u]=t.useState([0,0,0]),[c,v]=t.useState([0,0,0]),b=Nn(),h=Kn(),{camera:x}=ga(),p=Ze(o=>o.toggleVisibility),y=ba(),S=Ya(),g=t.useMemo(()=>y.map(o=>o.id),[y]),d=t.useMemo(()=>e.surfaceId?S[e.surfaceId]:null,[e.surfaceId,S]);return t.useEffect(()=>{d&&(W.repeat.set(Math.ceil(d.header.nx*d.header.xinc/500),Math.ceil(d.header.ny*d.header.yinc/500)),W.wrapS=ke,W.wrapT=ke)},[d]),t.useEffect(()=>{function o(_){_.code==="Space"&&p()}return addEventListener("keypress",o),()=>removeEventListener("keypress",o)},[p]),t.useEffect(()=>{h.has("selected")||h.add("selected",{label:"Selected",value:"(none)",color:"tomato",order:2,details:{status:{label:"Status",value:"-"},depth:{label:"Total Depth (Md Msl)",value:"-"},kickoff:{label:"Kickoff (Md Msl)",value:"-"},easting:{label:"Easting (wellhead)",value:"-"},northing:{label:"Northing (wellhead)",value:"-"},depthRef:{label:"Depth ref. (Msl)",value:"-"}}}),h.has("readout")||h.add("readout",{label:"Readout",color:"orange",value:"(none)",order:1,details:{easting:{label:"Easting",value:"-"},northing:{label:"Northing",value:"-"},depth:{label:"TVD (Msl)",value:"-"},distance:{label:"Distance (m)",value:"-"}}})},[h]),t.useEffect(()=>{e.selected&&dispatchEvent(new Le({id:e.selected}))},[e.selected]),t.useEffect(()=>{function o(_){var R;n(_.detail.id);const s=y.find(w=>w.id===_.detail.id);s&&h.update("selected",s.name,{status:s.status,depth:s.depthMdMsl.toFixed(1),kickoff:((R=s.kickoffDepthMsl)==null?void 0:R.toFixed(1))||"-",easting:s.easting.toFixed(1),northing:s.northing.toFixed(1),depthRef:s.depthReferenceElevation.toFixed(1)})}return addEventListener(Ae,o),()=>removeEventListener(Ae,o)},[h,y]),t.useEffect(()=>()=>{b.removeAll()},[b]),l.jsxs(l.Fragment,{children:[l.jsx(Un,{}),l.jsxs(ia,{ref:r,origin:ye,utmZone:$a,children:[e.showCameraTarget&&l.jsx(Bn,{}),!d&&l.jsx(Gn,{size:i,cellSize:e.gridCellSize,originValue:[ye[0],0,ye[1]],gridScale:[1,-1,-1],position:c,gridLineWidth:6/e.gridCellSize,backgroundOpacity:.5,axesColor:"#eee",renderOrder:0}),d&&l.jsx(Pe,{easting:d.header.xori,northing:d.header.yori,children:l.jsx(Se,{meta:d,color:e.color,useColorRamp:e.useColorRamp,reverseRamp:e.reverseRamp,colorRamp:e.colorRamp,rampMin:d.displayMin,rampMax:d.displayMax,opacity:e.opacity,priority:0,maxError:e.maxError,wireframe:e.wireframe,showContours:e.showContours,contoursColorMode:e.contoursColorMode,contoursColorModeFactor:e.contoursColorModeFactor,contoursInterval:e.contoursInterval,contoursThickness:e.contoursThickness,contoursColor:e.contoursColor,normalMap:W,normalScale:[.1,.1]})}),l.jsx(Wn,{updateRate:1e3,snapTo:e.gridCellSize,padding:{x0:1e3,x1:1e3,z0:1e3,z1:1e3,y0:500},onChange:o=>{v(o.center),u(o.size)},children:l.jsx(Hn,{wellbores:y,included:g,selected:a,renderWellbore:(o,_,s,R)=>{const w=R?pn(o.name.replace(o.well,"")||"Main"):"#aaa";return l.jsx(Pe,{easting:o.easting,northing:o.northing,children:l.jsxs(oa,{id:o.id,fromMsl:_,onPointerClick:async M=>{n(M.ref),dispatchEvent(new Le({id:M.ref,position:M.position,flyTo:!M.keys.ctrlKey})),console.log(o.id)},onPointerEnter:async M=>{s||b.highlight(M.target)},onPointerLeave:async()=>{b.removeAll(),h.update("readout","(none)",{easting:"-",northing:"-",depth:"-",distance:"-"})},onPointerMove:async M=>{if(r.current&&M.position){const m=r.current.worldToUtm(...M.position);let V="-";M.position&&(Ue.set(M.position[0],M.position[1],M.position[2]),V=Ue.distanceTo(x.position).toFixed(1)),h.update("readout",o.name,{easting:m.easting.toFixed(1),northing:m.northing.toFixed(1),depth:(-m.altitude).toFixed(1),distance:V})}},children:[l.jsxs(fa,{id:o.id,fromMsl:_,children:[l.jsx(sa,{color:w,priority:9}),l.jsxs(qe,{min:e.showCasingAndCompletion?10:0,max:2e3,children:[l.jsx(je,{radius:.1*e.sizeMultiplier,color:w,priority:8,radialSegments:8}),e.showShoes&&l.jsx(Re,{radialSegments:32,sizeMultiplier:e.sizeMultiplier*1.3,color:s?w:"orange"})]}),e.showCasingAndCompletion&&l.jsxs(qe,{min:0,max:10,onDemand:!0,children:[l.jsx(la,{radialSegments:16,sizeMultiplier:e.sizeMultiplier,shoeFactor:1.3,opacity:e.casingOpacity}),l.jsx(ua,{radialSegments:16,sizeMultiplier:e.sizeMultiplier,fallback:()=>l.jsx(je,{radius:.1*e.sizeMultiplier,color:w,priority:8,radialSegments:16})})]})]}),e.showPerforations&&l.jsx(da,{sizeMultiplier:e.sizeMultiplier}),e.showDepthMarkers&&R&&l.jsx(ca,{interval:e.depthMarkerInterval,priority:10,depthReferencePoint:"MSL"}),e.showPicks&&l.jsx(Ce,{radialSegments:16,baseRadius:e.sizeMultiplier*.4,showAnnotations:R}),l.jsx(ma,{color:"cyan",size:16})]})})}})})]})]})},qr={title:"examples/Wells",loaders:[async()=>{Ze.getState().clear(),Qn.setState({groups:{}})}],component:Za,argTypes:{surfaceId:{options:[void 0,...Object.keys(ee.surfaceOptions)],control:{type:"select",labels:{undefined:"(none)",...ee.surfaceOptions}}},colorRamp:{options:[0,1,2,3,4,5,6,7,8,9],control:{type:"select",labels:{0:"rainbow",1:"jet",2:"portland",3:"earth",4:"plasma",5:"salinity",6:"seismic",7:"seismic2",8:"spectrum",9:"gray"}}},color:{control:{type:"color"}},opacity:{control:{type:"range",min:0,max:1,step:.01}},maxError:{control:{type:"range",min:.1,max:10,step:.01}},contoursInterval:{options:[1,2,5,10,25,50,100,250,500],control:{type:"select"}},contoursColorMode:{options:[0,1,2],control:{type:"radio",labels:{0:"darken",1:"lighten",2:"mixed"}}},contoursThickness:{control:{type:"range",min:.5,max:5,step:.1}},contoursColor:{control:{type:"color"}},casingOpacity:{control:{type:"range",min:0,max:1,step:.01}},gridCellSize:{options:[250,500,1e3],control:{type:"select"}}},parameters:{scale:1e3,cameraPosition:[0,15e3,2e4],cameraTarget:[0,0,0],colorScale:pn},decorators:[zn,pa,ha,ta,In,Yn,va]},X={args:{surfaceId:void 0,useColorRamp:!0,reverseRamp:!1,color:"white",colorRamp:0,opacity:.98,maxError:5,wireframe:!1,showContours:!1,contoursColorMode:Te.darken,contoursColorModeFactor:.5,contoursInterval:10,contoursThickness:.8,contoursColor:"#000000",depthMarkerInterval:250,showPicks:!1,showShoes:!0,showDepthMarkers:!1,showCasingAndCompletion:!1,showPerforations:!0,showCameraTarget:!0,sizeMultiplier:3,casingOpacity:1,gridCellSize:500}};var Be,He,Ge;X.parameters={...X.parameters,docs:{...(Be=X.parameters)==null?void 0:Be.docs,source:{originalSource:`{
  args: {
    surfaceId: undefined,
    useColorRamp: true,
    reverseRamp: false,
    color: 'white',
    colorRamp: 0,
    opacity: 0.98,
    maxError: 5,
    wireframe: false,
    showContours: false,
    contoursColorMode: ContourColorMode.darken,
    contoursColorModeFactor: 0.5,
    contoursInterval: 10,
    contoursThickness: 0.8,
    contoursColor: '#000000',
    depthMarkerInterval: 250,
    showPicks: false,
    showShoes: true,
    showDepthMarkers: false,
    showCasingAndCompletion: false,
    showPerforations: true,
    showCameraTarget: true,
    sizeMultiplier: 3,
    casingOpacity: 1,
    gridCellSize: 500
  }
}`,...(Ge=(He=X.parameters)==null?void 0:He.docs)==null?void 0:Ge.source}}};const Lr=["Default"];export{X as Default,Lr as __namedExportsOrder,qr as default};
