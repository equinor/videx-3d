var _n=Object.defineProperty;var Mn=(e,r,n)=>r in e?_n(e,r,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[r]=n;var k=(e,r,n)=>Mn(e,typeof r!="symbol"?r+"":r,n);import{j as l}from"./jsx-runtime-CmIOflP4.js";import{r as t}from"./index-KqYmeiyw.js";import{$ as Sn,k as Q,a0 as Cn,Z as Rn,X as wn,l as be,m as En,c as J,i as We,h as Fn,a1 as Tn,a2 as Vn,a3 as Qe,F as De,G as Dn,j as kn,D as On,a4 as qn,J as Ye,V as we,o as Ln,T as An,a5 as ke}from"./CameraManager-BuezL_By.js";import{n as Ke,s as Oe,c as Pn,a as Ze,u as $e}from"./AnnotationsLayer-CAyRgV7V.js";import{E as jn,W as zn,u as In,H as Nn,C as Un,a as Bn}from"./well-map-decorator-DRNheAau.js";import{D as qe}from"./Distance-CrwyHwf-.js";import{B as Gn,O as Hn}from"./BoxGrid-Cpsp9mxT.js";import{u as Wn,O as Qn,a as Yn}from"./output-panel-decorator-DXohYIJy.js";import{a as Ee,b as Kn,u as Xe}from"./useWellboreContext-DkvsaS95.js";import{c as xe,L as _e}from"./layers-DoaKWXpU.js";import{q as Fe}from"./limiter-DhBcc_yH.js";import{e as Je,f as en,R as nn,C as rn,r as Zn,g as de,h as $n,i as Xn,u as Jn,o as er}from"./WellMapCasingShoes-Z2z1IpOr.js";import{t as nr}from"./numbers-DM6OWwIG.js";import{r as rr}from"./index.esm-BMr5xbKZ.js";import"./index-BsNHLAmC.js";import"./uv-material-DyQCcDTL.js";import{u as ar,G as tr,W as Le,w as Ae,a as or}from"./generators-provider-decorator-C-zBAaMo.js";import{U as ir,a as Pe}from"./UtmPosition-BC0fz5hA.js";import{B as sr}from"./BasicTrajectory-BNR446RI.js";import{C as lr}from"./Casings-on--jxdC.js";import{C as ur}from"./CompletionTools-C83-GUh6.js";import{D as cr}from"./DepthMarkers-CCgp_rBX.js";import{S as an,P as dr}from"./Perforations-Ia0BvXYp.js";import{a as tn,T as je}from"./TubeTrajectory-DYfgMCJK.js";import{W as fr}from"./WellboreBounds-BOqTmlAb.js";import{W as mr}from"./WellboreLabel-C9LsxgQV.js";import{A as pr}from"./annotations-decorator-bIsFvPEY.js";import{C as hr,a as gr}from"./canvas-3d-decorator-BhyssXtK.js";import{D as vr}from"./data-provider-decorator-BF4MaAx0.js";import{l as yr,u as br}from"./useWellboreHeaders-7DqYhevo.js";import{s as ee}from"./story-args-Cgt5gSNS.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./react-Mgt78q4a.js";import"./Grid-Dwex0QcV.js";import"./Text-BN5iLNcs.js";import"./CasingLabel-7b3hFzXc.js";import"./curve-3d-B0j10gmN.js";const xr=Math.PI/180,_r=180/Math.PI,ne=18,on=.96422,sn=1,ln=.82521,un=4/29,G=6/29,cn=3*G*G,Mr=G*G*G;function dn(e){if(e instanceof q)return new q(e.l,e.a,e.b,e.opacity);if(e instanceof j)return fn(e);e instanceof nn||(e=Zn(e));var r=he(e.r),n=he(e.g),a=he(e.b),i=fe((.2225045*r+.7168786*n+.0606169*a)/sn),u,c;return r===n&&n===a?u=c=i:(u=fe((.4360747*r+.3850649*n+.1430804*a)/on),c=fe((.0139322*r+.0971045*n+.7141733*a)/ln)),new q(116*i-16,500*(u-i),200*(i-c),e.opacity)}function Sr(e,r,n,a){return arguments.length===1?dn(e):new q(e,r,n,a??1)}function q(e,r,n,a){this.l=+e,this.a=+r,this.b=+n,this.opacity=+a}Je(q,Sr,en(rn,{brighter(e){return new q(this.l+ne*(e??1),this.a,this.b,this.opacity)},darker(e){return new q(this.l-ne*(e??1),this.a,this.b,this.opacity)},rgb(){var e=(this.l+16)/116,r=isNaN(this.a)?e:e+this.a/500,n=isNaN(this.b)?e:e-this.b/200;return r=on*me(r),e=sn*me(e),n=ln*me(n),new nn(pe(3.1338561*r-1.6168667*e-.4906146*n),pe(-.9787684*r+1.9161415*e+.033454*n),pe(.0719453*r-.2289914*e+1.4052427*n),this.opacity)}}));function fe(e){return e>Mr?Math.pow(e,1/3):e/cn+un}function me(e){return e>G?e*e*e:cn*(e-un)}function pe(e){return 255*(e<=.0031308?12.92*e:1.055*Math.pow(e,1/2.4)-.055)}function he(e){return(e/=255)<=.04045?e/12.92:Math.pow((e+.055)/1.055,2.4)}function Cr(e){if(e instanceof j)return new j(e.h,e.c,e.l,e.opacity);if(e instanceof q||(e=dn(e)),e.a===0&&e.b===0)return new j(NaN,0<e.l&&e.l<100?0:NaN,e.l,e.opacity);var r=Math.atan2(e.b,e.a)*_r;return new j(r<0?r+360:r,Math.sqrt(e.a*e.a+e.b*e.b),e.l,e.opacity)}function Me(e,r,n,a){return arguments.length===1?Cr(e):new j(e,r,n,a??1)}function j(e,r,n,a){this.h=+e,this.c=+r,this.l=+n,this.opacity=+a}function fn(e){if(isNaN(e.h))return new q(e.l,0,0,e.opacity);var r=e.h*xr;return new q(e.l,Math.cos(r)*e.c,Math.sin(r)*e.c,e.opacity)}Je(j,Me,en(rn,{brighter(e){return new j(this.h,this.c,this.l+ne*(e??1),this.opacity)},darker(e){return new j(this.h,this.c,this.l-ne*(e??1),this.opacity)},rgb(){return fn(this).rgb()}}));function Rr(e){return function(r,n){var a=e((r=Me(r)).h,(n=Me(n)).h),i=de(r.c,n.c),u=de(r.l,n.l),c=de(r.opacity,n.opacity);return function(v){return r.h=a(v),r.c=i(v),r.l=u(v),r.opacity=c(v),r+""}}}const wr=Rr($n);function Er(e,r){r===void 0&&(r=e,e=Xn);for(var n=0,a=r.length-1,i=r[0],u=new Array(a<0?0:a);n<a;)u[n]=e(i,i=r[++n]);return function(c){var v=Math.max(0,Math.min(a-1,Math.floor(c*=a)));return u[v](c-v)}}const Fr="surfaceGeometry";var Tr=`#define MESH_SURFACE_MATERIAL

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
}`,Vr=`#define MESH_SURFACE_MATERIAL

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

  

}`;function Dr(e,r){const n=e.length,a=document.createElement("canvas");a.width=r,a.height=n,a.style.imageRendering="-moz-crisp-edges",a.style.imageRendering="pixelated";const i=a.getContext("2d");if(i)for(let u=0;u<e.length;u++)e[u](i,u);return a}function O(e,r){return(n,a)=>{const i=n.canvas.width,u=n.canvas.width/(i-1);for(let c=0;c<i;++c)n.fillStyle=e(c/(i-1)),n.fillRect(c*u,a,u+1,1)}}const L=e=>r=>Er(wr,e)(Math.min(Math.max(0,r),1)),kr=L(["#5d198e","#2319a1","#185db6","#16c1ca","#14e083","#19ef20","#88f427","#f5f835","#fca245","#ff5555"]),Or=L(["#000083","#001e97","#003caa","#0163bb","#028acc","#03b1dd","#04d8ee","#05ffff","#37ffcc","#69ff99","#9bff66","#cdff33","#ffff00","#fecc00","#fd9900","#fc6600","#fb3300","#fa0000","#bd0000","#800000"]),qr=L(["#0c3383","#0c448e","#0b5599","#0b66a4","#0a77af","#0a88ba","#3897a0","#67a686","#95b56c","#c4c452","#f2d338","#f2c238","#f2b138","#f2a038","#f28f38","#ed7833","#e8622e","#e34b28","#de3523","#d91e1e"]),Lr=L(["#000082","#005a9b","#00b4b4","#14c36e","#28d228","#58d72b","#87dc2d","#b7e130","#e6e632","#c1b128","#9d7b1e","#784614","#895d31","#9a744f","#ab8b6c","#bca38a","#ccbaa7","#ddd1c4","#eee8e2","#ffffff"]),Ar=L(["#0d0887","#2c0694","#4b03a1","#5c03a3","#6c03a6","#7d03a8","#93139f","#a82296","#b42e8c","#bf3a83","#cb4679","#d8596b","#e56b5d","#ef804f","#f89441","#faa439","#fbb330","#fdc328","#f7de25","#f0f921"]),Pr=L(["#2a186c","#262587","#2132a2","#1b3f9c","#154d97","#0f5a91","#1c688d","#287689","#2e7f88","#358988","#3b9287","#45a183","#4faf7e","#64bd73","#78cb68","#90d167","#a9d765","#c1dd64","#dfe67f","#fdef9a"]),jr=L(["#ffe700","#ffdf00","#ffd600","#ffce00","#ffc500","#ffbc00","#ffb400","#ffab00","#ffa200","#ff9a00","#ff9100","#ff8900","#ff8000","#ff7700","#ff6f00","#ff6600","#ff5e00","#ff5500","#f55400","#ea5200","#e05100","#d55000","#cb4e00","#c04d00","#b64b00","#ab4a00","#a14900","#964700","#8c4600","#925213","#975d25","#9d6938","#a2744a","#a8805d","#ad8b6f","#b39782","#b8a294","#beaea7","#c3b9b9","#b7aeae","#aaa2a2","#9e9797","#918b8b","#858080","#787474","#6c6969","#5f5d5d","#535252","#464646","#404057","#393968","#333378","#2d2d89","#26269a","#2020ab","#1919bc","#1313cd","#0d0ddd","#0606ee","#0000ff","#000cff","#0018ff","#0024ff","#0030ff","#003cff","#0048ff","#0054ff","#0060ff","#006cff","#0078ff","#0084ff","#0090ff","#009cff","#00a8ff","#00b4ff","#00c0ff","#00ccff","#00d8ff","#00e4ff","#00f0ff"]),zr=L(["#00004c","#000092","#0000db","#3131ff","#9999ff","#fdfdff","#ff9999","#ff3535","#e60000","#b30000","#800000"]),Ir=L(["#ffffff","#FFFFBD","#FFFF71","#FFFF24","#FFE300","#FF9100","#F90600","#DB2400","#C03F00","#A45B00","#6D9200","#3AD500","#00FF00","#00EA1E","#00C03F","#009F60","#00AF87","#00CCB3","#00ECD9","#03FBFF","#19F0FF","#2ED1FF","#44BBFF","#4F9EFF","#3870FF","#2143FF","#0B15FF","#180CFF","#4623FF","#7038FF","#A150FF","#BA45FF","#D12EFF","#E817FF","#FF00FF","#CD00D7","#9900AE","#660085","#300059","#0B003C"]),Nr=L(["#000","#fff"]),mn=[O(e=>kr(1-e)),O(e=>Or(1-e)),O(e=>qr(1-e)),O(e=>Lr(1-e)),O(e=>Ar(1-e)),O(e=>Pr(1-e)),O(e=>jr(1-e)),O(e=>zr(1-e)),O(e=>Ir(1-e)),O(e=>Nr(1-e))],Ur=Dr(mn,512),I=new Sn(Ur);I.magFilter=Q;I.minFilter=Cn;I.flipY=!1;I.generateMipmaps=!1;I.colorSpace=Rn;I.format=wn;I.anisotropy=4;var Te=(e=>(e[e.darken=0]="darken",e[e.lighten=1]="lighten",e[e.mixed=2]="mixed",e))(Te||{});const Z={name:"MeshSurfaceShader",defines:{USE_COLOR_RAMP:!1,USE_CONTOURS:!1,USE_UV:!0},uniforms:be.merge([be.clone(En.lambert.uniforms),{colorRampIndex:{value:0},colorRamps:{value:mn.length},colorRampReverse:{value:!0},colorRampMin:{value:800},colorRampMax:{value:1e3},colorRampTexture:{value:null},referenceDepth:{value:1e3},saturation:{value:1},brightness:{value:0},depthTexture:{value:null},normalTexture:{value:null},contoursInterval:{value:100},contoursColorMode:{value:0},contoursColorModeFactor:{value:.5},contoursColor:{value:new J("black")},contoursThickness:{value:.8},size:{value:new We}}]),vertexShader:Tr,fragmentShader:Vr};class Br extends Fn{constructor(n){super();k(this,"isMeshSurfaceShader",!0);k(this,"normalScale");k(this,"map");k(this,"normalMap");k(this,"wireframeLinecap");k(this,"wireframeLinejoin");k(this,"flatShading");k(this,"combine");k(this,"normalMapType");this.defines=Object.assign({},Z.defines),this.uniforms=be.clone(Z.uniforms),this.vertexShader=Z.vertexShader,this.fragmentShader=Z.fragmentShader,this.combine=Tn,this.normalMapType=Vn,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.lights=!0,this.clipping=!0,this.fog=!0;const a=["map","lightMap","lightMapIntensity","aoMap","aoMapIntensity","emissive","emissiveIntensity","emissiveMap","specularMap","alphaMap","envMap","reflectivity","refractionRatio","opacity","diffuse","normalMap","normalScale","referenceDepth","colorRampIndex","colorRampMin","colorRampMax","colorRampReverse","saturation","brightness","contoursInterval","contoursColorMode","contoursColorModeFactor","contoursThickness","normalTexture","depthTexture"];for(const i of a)Object.defineProperty(this,i,{get:function(){return this.uniforms[i].value},set:function(u){this.uniforms[i].value=u}});this.normalScale=new We(.25,.25),this.color="white",this.setValues(n)}get color(){return"#"+this.uniforms.diffuse.value.getHexString()}set color(n){this.uniforms.diffuse.value=new J(n)}get contoursColor(){return"#"+this.uniforms.contoursColor.value.getHexString()}set contoursColor(n){this.uniforms.contoursColor.value=new J(n)}get useColorRamp(){return this.defines.USE_COLOR_RAMP||!1}set useColorRamp(n){this.defines.USE_COLOR_RAMP=!!n,this.uniforms.colorRampTexture.value=this.defines.USE_COLOR_RAMP?I:null,this.needsUpdate=!0}get showContours(){return this.defines.USE_CONTOURS||!1}set showContours(n){this.defines.USE_CONTOURS=!!n,this.needsUpdate=!0}dispose(){var n;super.dispose(),(n=this.uniforms.depthTexture.value)==null||n.dispose()}onBeforeCompile(){this.map&&(this.map.matrixAutoUpdate===!0&&this.map.updateMatrix(),this.uniforms.mapTransform.value.copy(this.map.matrix)),this.normalMap&&(this.normalMap.matrixAutoUpdate===!0&&this.normalMap.updateMatrix(),this.uniforms.normalMapTransform.value.copy(this.normalMap.matrix))}}function $(e,r,n){const a=Oe(e,r),i=Oe(e,n);return Ke(Pn(a,i))}function Gr(e,r,n,a,i=-1){const u=e.length/r,c=r-1,v=u-1;let b=0;const h=(p,y)=>e[y*r+p],x=new Array(c*v);for(let p=0;p<v;p++){const y=p+1,S=p+.5;for(let g=0;g<c;g++){const d=g+1,o=g+.5,_=h(g,p);if(_!==i){const s=h(g,y),R=h(d,p),w=h(d,y),M=(_+s+R+w)/4,m=[g*n,p*a,_],V=[g*n,y*a,s],E=[d*n,p*a,R],A=[d*n,y*a,w],z=[o*n,S*a,M],D=$(z,m,E),N=$(z,E,A),U=$(z,A,V),B=$(z,V,m),H=Ke([D[0]+N[0]+U[0]+B[0],D[2]+N[2]+U[2]+B[2],D[1]+N[1]+U[1]+B[1]]);x[b++]=H}else x[b++]=[0,0,0]}}return{normals:x,columns:c}}function Hr(e,r,n,a,i,u=-1){const{normals:c,columns:v}=Gr(e,r,n,a,u),b=new Uint8Array(c.length*4);for(let p=0;p<c.length;p++){const y=rr(c[p],[0,1,0],i*(Math.PI/180)),S=Math.floor((y[0]+1)/2*255),g=Math.floor((y[1]+1)/2*255),d=Math.floor((y[2]+1)/2*255),o=p*4;b[o]=S,b[o+1]=g,b[o+2]=d,b[o+3]=255}const h=c.length/v,x=new Qe(b,v,h);return x.minFilter=Q,x.magFilter=Q,x.flipY=!0,x.anisotropy=4,x.needsUpdate=!0,x}const Se=({meta:e,color:r,colorRamp:n=0,rampMin:a,rampMax:i,reverseRamp:u=!1,useColorRamp:c=!0,showContours:v=!1,contoursInterval:b=100,contoursColorMode:h=Te.darken,contoursColorModeFactor:x=.5,contoursThickness:p=.8,contoursColor:y="black",opacity:S=1,priority:g=0,maxError:d=5,doubleSide:o=S===1||!1,wireframe:_=!1,normalMap:s,normalScale:R,name:w,userData:M,receiveShadow:m,castShadow:V,layers:E=xe(_e.OCCLUDER),position:A,renderOrder:z=10,visible:D=!0,onPointerClick:N,onPointerEnter:U,onPointerLeave:B,onPointerMove:H})=>{const Y=t.useRef(null),re=Ee(Fr),ae=Jn(),[te,Ve]=t.useState(!1),[oe,hn]=t.useState(null),[ie,gn]=t.useState(null),[se,vn]=t.useState(null),yn=t.useMemo(()=>xe(_e.NOT_EMITTER),[]),f=t.useMemo(()=>new Br({useColorRamp:!0,forceSinglePass:!0,saturation:1,brightness:0,colorRampIndex:0,colorRampReverse:!1,colorRampMin:e.displayMin,colorRampMax:e.displayMax,referenceDepth:e.max,normalMap:s,side:De,wireframe:!1,flatShading:!1,transparent:!0,opacity:1}),[e,s]),bn=t.useMemo(()=>new Dn({transparent:!0,side:kn,colorWrite:!1,depthWrite:!0}),[]),le=ar();return t.useEffect(()=>{let C=null;if(te&&le&&Y.current){const F={};N&&(F.click=N),U&&(F.enter=U),B&&(F.leave=B),H&&(F.move=H),Object.keys(F).length&&(C=le.register(Y.current,F,e.id))}return()=>{C&&C()}},[le,N,U,B,H,te,e.id]),t.useEffect(()=>{f.uniforms.colorRampIndex.value=n,f.uniforms.opacity.value=S,f.uniforms.contoursColorMode.value=h,f.uniforms.contoursColorModeFactor.value=x,f.uniforms.contoursInterval.value=b,f.uniforms.contoursThickness.value=p,f.uniforms.colorRampMin.value=a,f.uniforms.colorRampMax.value=i,f.uniforms.colorRampReverse.value=u,R&&f.uniforms.normalScale.value.set(...R)},[f,n,S,v,h,x,b,p,a,i,u,R]),t.useEffect(()=>{f.wireframe=_,f.showContours=v,f.contoursColor=y,f.useColorRamp=c,f.color=r||f.color,f.side=o?On:De},[f,c,v,_,y,r,o]),t.useEffect(()=>{ae&&ae.get("surface-values",e.id).then(C=>{if(C&&C instanceof Float32Array){const F=new Uint8Array(C.length*4);for(let T=0;T<C.length;T++){const ue=C[T],ce=ue===-1?[0,0,0]:nr(ue),K=T*4;F[K]=ce[0],F[K+1]=ce[1],F[K+2]=ce[2],F[K+3]=ue===-1?0:255}const P=new Qe(F,e.header.nx,e.header.ny);P.minFilter=Q,P.magFilter=Q,P.needsUpdate=!0,P.flipY=!0;const xn=Hr(C,e.header.nx,e.header.xinc,e.header.yinc,e.header.rot);vn(T=>(T&&T.dispose(),xn||T)),gn(T=>(T&&T.dispose(),P||T))}})},[ae,e.id,e.header.nx,e.header.ny,e.header.xinc,e.header.yinc,e.header.rot]),t.useEffect(()=>{Ve(!1),re&&Fe(()=>re(e.id,d).then(C=>{let F=null;C&&(F=Kn(C)),hn(P=>(P&&P.dispose(),F||P)),Ve(!0)}),g)},[re,e,d,g]),t.useEffect(()=>{ie&&f&&(f.uniforms.depthTexture.value=ie)},[ie,f]),t.useEffect(()=>{se&&f&&(f.uniforms.normalTexture.value=se)},[se,f]),t.useEffect(()=>()=>{var C;(C=f.normalMap)==null||C.dispose(),f.dispose()},[f]),!te||!oe||!e?null:l.jsxs("group",{name:w,userData:M,visible:D,renderOrder:z,position:A,children:[S<1&&l.jsx("mesh",{ref:Y,geometry:oe,material:bn,renderOrder:1,layers:yn}),l.jsx("mesh",{ref:Y,castShadow:V,receiveShadow:m,geometry:oe,material:f,layers:E,renderOrder:2})]})};try{Se.displayName="Surface",Se.__docgenInfo={description:`This component renderes a TIN model from an elevation map, according to the \`SurfaceMeta\` and \`SurfaveValues\` data types.

It has several customization options for rendering the surfaces, including color ramps, contour lines and transparency.

Surface values are expected to be in a regular grid. An optimized triangulation is used for the geometry, but color ramp 
values and contour lines are always using the full resolution of the data for accuracy. 

The surface requires the \`SurfaceMeta\` type as input data. It will fetch the \`SurfaceValues\` on the component side
from the store. This is because the component will need this data to generate a data texture and calculate normals at a 
higher resolution than the generated geometry.`,displayName:"Surface",props:{name:{defaultValue:null,description:"",name:"name",required:!1,type:{name:"string | undefined"}},visible:{defaultValue:{value:"true"},description:"",name:"visible",required:!1,type:{name:"boolean | undefined"}},userData:{defaultValue:null,description:"",name:"userData",required:!1,type:{name:"Record<string, any> | undefined"}},position:{defaultValue:null,description:"",name:"position",required:!1,type:{name:"Vec3 | undefined"}},castShadow:{defaultValue:null,description:"",name:"castShadow",required:!1,type:{name:"boolean | undefined"}},receiveShadow:{defaultValue:null,description:"",name:"receiveShadow",required:!1,type:{name:"boolean | undefined"}},renderOrder:{defaultValue:{value:"10"},description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}},layers:{defaultValue:{value:"createLayers(LAYERS.OCCLUDER)"},description:"",name:"layers",required:!1,type:{name:"Layers | undefined"}},onPointerEnter:{defaultValue:null,description:"",name:"onPointerEnter",required:!1,type:{name:"EventEmitterCallback | undefined"}},onPointerLeave:{defaultValue:null,description:"",name:"onPointerLeave",required:!1,type:{name:"EventEmitterCallback | undefined"}},onPointerMove:{defaultValue:null,description:"",name:"onPointerMove",required:!1,type:{name:"EventEmitterCallback | undefined"}},onPointerClick:{defaultValue:null,description:"",name:"onPointerClick",required:!1,type:{name:"EventEmitterCallback | undefined"}},meta:{defaultValue:null,description:"",name:"meta",required:!0,type:{name:"SurfaceMeta"}},color:{defaultValue:null,description:"",name:"color",required:!1,type:{name:"string | undefined"}},colorRamp:{defaultValue:{value:"0"},description:"",name:"colorRamp",required:!1,type:{name:"number | undefined"}},rampMin:{defaultValue:null,description:"",name:"rampMin",required:!1,type:{name:"number | undefined"}},rampMax:{defaultValue:null,description:"",name:"rampMax",required:!1,type:{name:"number | undefined"}},reverseRamp:{defaultValue:{value:"false"},description:"",name:"reverseRamp",required:!1,type:{name:"boolean | undefined"}},useColorRamp:{defaultValue:{value:"true"},description:"",name:"useColorRamp",required:!1,type:{name:"boolean | undefined"}},showContours:{defaultValue:{value:"false"},description:"",name:"showContours",required:!1,type:{name:"boolean | undefined"}},contoursInterval:{defaultValue:{value:"100"},description:"",name:"contoursInterval",required:!1,type:{name:"number | undefined"}},contoursColorMode:{defaultValue:{value:"ContourColorMode.darken"},description:"",name:"contoursColorMode",required:!1,type:{name:"ContourColorMode | undefined"}},contoursColorModeFactor:{defaultValue:{value:"0.5"},description:"",name:"contoursColorModeFactor",required:!1,type:{name:"number | undefined"}},contoursThickness:{defaultValue:{value:"0.8"},description:"",name:"contoursThickness",required:!1,type:{name:"number | undefined"}},contoursColor:{defaultValue:{value:"black"},description:"",name:"contoursColor",required:!1,type:{name:"string | undefined"}},opacity:{defaultValue:{value:"1"},description:"",name:"opacity",required:!1,type:{name:"number | undefined"}},priority:{defaultValue:{value:"0"},description:"",name:"priority",required:!1,type:{name:"number | undefined"}},maxError:{defaultValue:{value:"5"},description:"",name:"maxError",required:!1,type:{name:"number | undefined"}},doubleSide:{defaultValue:{value:"opacity === 1 || false"},description:"",name:"doubleSide",required:!1,type:{name:"boolean | undefined"}},wireframe:{defaultValue:{value:"false"},description:"",name:"wireframe",required:!1,type:{name:"boolean | undefined"}},normalMap:{defaultValue:null,description:"",name:"normalMap",required:!1,type:{name:"Texture | undefined"}},normalScale:{defaultValue:null,description:"",name:"normalScale",required:!1,type:{name:"Vec2 | undefined"}}}}}catch{}const Wr="pickSymbols",ze=new Ye,ge=new we,Ie=new J,Ce=t.forwardRef(({name:e,userData:r,position:n,visible:a,renderOrder:i,layers:u=xe(_e.NOT_EMITTER),castShadow:c,receiveShadow:v,radialSegments:b=8,baseRadius:h=10,priority:x=0,showAnnotations:p=!0},y)=>{const S=t.useRef(null),{id:g,fromMsl:d}=Xe(),o=Ee(Wr),{addAnnotations:_}=Ze("picks",g),[s,R]=t.useState(null);t.useImperativeHandle(y,()=>S.current);const w=t.useMemo(()=>new qn(1,1,.1,b,1,!1),[b]),M=t.useMemo(()=>new tn,[]);return t.useEffect(()=>{o&&g&&Fe(()=>o(g,d,h).then(m=>{R(m)}),x)},[o,g,d,h,x]),t.useEffect(()=>{let m=null;if(p&&s&&s.data&&_){const V=s.data.map((E,A)=>{var D;return ze.fromArray(s.transformations,A*16),ge.setFromMatrixPosition(ze),(D=S.current)==null||D.localToWorld(ge),Ie.fromArray(s.colors,A*3),{id:E.id,name:E.name,position:ge.toArray(),direction:E.direction,priority:E.level,data:{depth:E.depth,tvd:E.tvd,color:Ie.getHexString()}}});m=_(V)}return()=>{m&&m()}},[s,_,p]),l.jsx("group",{ref:S,children:s&&l.jsx(an,{name:e,userData:r,renderOrder:i,visible:a,position:n,data:s,geometry:w,material:M,layers:u,castShadow:c,receiveShadow:v})})});try{Ce.displayName="Picks",Ce.__docgenInfo={description:"Render pick markers along a wellbore trajectory. This uses the `Symbols` component internally.",displayName:"Picks",props:{name:{defaultValue:null,description:"",name:"name",required:!1,type:{name:"string | undefined"}},visible:{defaultValue:null,description:"",name:"visible",required:!1,type:{name:"boolean | undefined"}},userData:{defaultValue:null,description:"",name:"userData",required:!1,type:{name:"Record<string, any> | undefined"}},position:{defaultValue:null,description:"",name:"position",required:!1,type:{name:"Vec3 | undefined"}},castShadow:{defaultValue:null,description:"",name:"castShadow",required:!1,type:{name:"boolean | undefined"}},receiveShadow:{defaultValue:null,description:"",name:"receiveShadow",required:!1,type:{name:"boolean | undefined"}},renderOrder:{defaultValue:null,description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}},layers:{defaultValue:{value:"createLayers(LAYERS.NOT_EMITTER)"},description:"",name:"layers",required:!1,type:{name:"Layers | undefined"}},radialSegments:{defaultValue:{value:"8"},description:"",name:"radialSegments",required:!1,type:{name:"number | undefined"}},baseRadius:{defaultValue:{value:"10"},description:"",name:"baseRadius",required:!1,type:{name:"number | undefined"}},priority:{defaultValue:{value:"0"},description:"",name:"priority",required:!1,type:{name:"number | undefined"}},showAnnotations:{defaultValue:{value:"true"},description:"",name:"showAnnotations",required:!1,type:{name:"boolean | undefined"}}}}}catch{}const Qr="shoeSymbols",Ne=new Ye,ve=new we,Re=t.forwardRef(({name:e,userData:r,position:n,visible:a,renderOrder:i,layers:u,castShadow:c,receiveShadow:v,radialSegments:b=16,sizeMultiplier:h=10,color:x="#ffbb00",priority:p=0},y)=>{const S=t.useRef(null),{id:g,fromMsl:d}=Xe(),o=Ee(Qr),{addAnnotations:_}=Ze("shoes",g),[s,R]=t.useState(null);t.useImperativeHandle(y,()=>S.current);const w=t.useMemo(()=>{const m=new Ln(1,2,b||16,1,!1);return m.translate(0,1,0),m},[b]),M=t.useMemo(()=>{const m=new tn;return m.color.set(x),m},[x]);return t.useEffect(()=>{o&&g&&Fe(()=>o(g,d,h).then(m=>{R(m)}),p)},[o,g,d,h,p]),t.useEffect(()=>{let m=null;if(s){const V=s.data.map((E,A)=>{var D;return Ne.fromArray(s.transformations,A*16),ve.setFromMatrixPosition(Ne),(D=S.current)==null||D.localToWorld(ve),{id:E.id,name:E.name,position:ve.toArray(),direction:E.direction}});m=_(V)}return()=>{m&&m()}},[s,_]),l.jsx("group",{ref:S,children:s&&l.jsx(an,{name:e,userData:r,renderOrder:i,visible:a,position:n,data:s,geometry:w,material:M,layers:u,castShadow:c,receiveShadow:v})})});try{Re.displayName="Shoes",Re.__docgenInfo={description:"Render shoe markers along a wellbore trajectory. This uses the `Symbols` component internally.",displayName:"Shoes",props:{name:{defaultValue:null,description:"",name:"name",required:!1,type:{name:"string | undefined"}},visible:{defaultValue:null,description:"",name:"visible",required:!1,type:{name:"boolean | undefined"}},userData:{defaultValue:null,description:"",name:"userData",required:!1,type:{name:"Record<string, any> | undefined"}},position:{defaultValue:null,description:"",name:"position",required:!1,type:{name:"Vec3 | undefined"}},castShadow:{defaultValue:null,description:"",name:"castShadow",required:!1,type:{name:"boolean | undefined"}},receiveShadow:{defaultValue:null,description:"",name:"receiveShadow",required:!1,type:{name:"boolean | undefined"}},renderOrder:{defaultValue:null,description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}},layers:{defaultValue:null,description:"",name:"layers",required:!1,type:{name:"Layers | undefined"}},radialSegments:{defaultValue:{value:"16"},description:"",name:"radialSegments",required:!1,type:{name:"number | undefined"}},sizeMultiplier:{defaultValue:{value:"10"},description:"",name:"sizeMultiplier",required:!1,type:{name:"number | undefined"}},color:{defaultValue:{value:"#ffbb00"},description:"",name:"color",required:!1,type:{name:"string | number | Color | undefined"}},priority:{defaultValue:{value:"0"},description:"",name:"priority",required:!1,type:{name:"number | undefined"}}}}}catch{}const Yr=()=>{const[e,r]=t.useState({});return t.useEffect(()=>{yr().then(n=>{n&&r(n)})},[]),e},Kr=new An,W=Kr.load("normal_map.jpg");W.anisotropy=4;const pn=er(["tomato","#4e79a7","#f28e2c","#76b7b2","#59a14f","#edc949","#af7aa1","#ff9da7","#9c755f","#86a68c","darkgreen","purple","#c3b380"]),Zr=ee.utmZone,ye=ee.origin,Ue=new we,$r=e=>{const[r,n]=t.useState(e.selected),a=t.useRef(null),[i,u]=t.useState([0,0,0]),[c,v]=t.useState([0,0,0]),b=In(),h=Yn(),{camera:x}=gr(),p=$e(o=>o.toggleVisibility),y=br(),S=Yr(),g=t.useMemo(()=>y.map(o=>o.id),[y]),d=t.useMemo(()=>e.surfaceId?S[e.surfaceId]:null,[e.surfaceId,S]);return t.useEffect(()=>{d&&(W.repeat.set(Math.ceil(d.header.nx*d.header.xinc/500),Math.ceil(d.header.ny*d.header.yinc/500)),W.wrapS=ke,W.wrapT=ke)},[d]),t.useEffect(()=>{function o(_){_.code==="Space"&&p()}return addEventListener("keypress",o),()=>removeEventListener("keypress",o)},[p]),t.useEffect(()=>{h.has("selected")||h.add("selected",{label:"Selected",value:"(none)",color:"tomato",order:2,details:{status:{label:"Status",value:"-"},depth:{label:"Total Depth (Md Msl)",value:"-"},kickoff:{label:"Kickoff (Md Msl)",value:"-"},easting:{label:"Easting (wellhead)",value:"-"},northing:{label:"Northing (wellhead)",value:"-"},depthRef:{label:"Depth ref. (Msl)",value:"-"}}}),h.has("readout")||h.add("readout",{label:"Readout",color:"orange",value:"(none)",order:1,details:{easting:{label:"Easting",value:"-"},northing:{label:"Northing",value:"-"},depth:{label:"TVD (Msl)",value:"-"},distance:{label:"Distance (m)",value:"-"}}})},[h]),t.useEffect(()=>{e.selected&&dispatchEvent(new Le({id:e.selected}))},[e.selected]),t.useEffect(()=>{function o(_){var R;n(_.detail.id);const s=y.find(w=>w.id===_.detail.id);s&&h.update("selected",s.name,{status:s.status,depth:s.depthMdMsl.toFixed(1),kickoff:((R=s.kickoffDepthMsl)==null?void 0:R.toFixed(1))||"-",easting:s.easting.toFixed(1),northing:s.northing.toFixed(1),depthRef:s.depthReferenceElevation.toFixed(1)})}return addEventListener(Ae,o),()=>removeEventListener(Ae,o)},[h,y]),t.useEffect(()=>()=>{b.removeAll()},[b]),l.jsxs(l.Fragment,{children:[l.jsx(Nn,{}),l.jsxs(ir,{ref:a,origin:ye,utmZone:Zr,children:[e.showCameraTarget&&l.jsx(Un,{}),!d&&l.jsx(Gn,{size:i,cellSize:e.gridCellSize,originValue:[ye[0],0,ye[1]],gridScale:[1,-1,-1],position:c,gridLineWidth:6/e.gridCellSize,backgroundOpacity:.5,axesColor:"#eee",renderOrder:0}),d&&l.jsx(Pe,{easting:d.header.xori,northing:d.header.yori,children:l.jsx(Se,{meta:d,color:e.color,useColorRamp:e.useColorRamp,reverseRamp:e.reverseRamp,colorRamp:e.colorRamp,rampMin:d.displayMin,rampMax:d.displayMax,opacity:e.opacity,priority:0,maxError:e.maxError,wireframe:e.wireframe,showContours:e.showContours,contoursColorMode:e.contoursColorMode,contoursColorModeFactor:e.contoursColorModeFactor,contoursInterval:e.contoursInterval,contoursThickness:e.contoursThickness,contoursColor:e.contoursColor,normalMap:W,normalScale:[.1,.1]})}),l.jsx(Hn,{updateRate:1e3,snapTo:e.gridCellSize,padding:{x0:1e3,x1:1e3,z0:1e3,z1:1e3,y0:500},onChange:o=>{v(o.center),u(o.size)},children:l.jsx(Bn,{wellbores:y,included:g,selected:r,renderWellbore:(o,_,s,R)=>{const w=R?pn(o.name.replace(o.well,"")||"Main"):"#aaa";return l.jsx(Pe,{easting:o.easting,northing:o.northing,children:l.jsxs(or,{id:o.id,fromMsl:_,onPointerClick:async M=>{n(M.ref),dispatchEvent(new Le({id:M.ref,position:M.position,flyTo:!M.keys.ctrlKey})),console.log(o.id)},onPointerEnter:async M=>{s||b.highlight(M.target)},onPointerLeave:async()=>{b.removeAll(),h.update("readout","(none)",{easting:"-",northing:"-",depth:"-",distance:"-"})},onPointerMove:async M=>{if(a.current&&M.position){const m=a.current.worldToUtm(...M.position);let V="-";M.position&&(Ue.set(M.position[0],M.position[1],M.position[2]),V=Ue.distanceTo(x.position).toFixed(1)),h.update("readout",o.name,{easting:m.easting.toFixed(1),northing:m.northing.toFixed(1),depth:(-m.altitude).toFixed(1),distance:V})}},children:[l.jsxs(fr,{id:o.id,fromMsl:_,children:[l.jsx(sr,{color:w,priority:9}),l.jsxs(qe,{min:e.showCasingAndCompletion?10:0,max:2e3,children:[l.jsx(je,{radius:.1*e.sizeMultiplier,color:w,priority:8,radialSegments:8}),e.showShoes&&l.jsx(Re,{radialSegments:32,sizeMultiplier:e.sizeMultiplier*1.3,color:s?w:"orange"})]}),e.showCasingAndCompletion&&l.jsxs(qe,{min:0,max:10,onDemand:!0,children:[l.jsx(lr,{radialSegments:16,sizeMultiplier:e.sizeMultiplier,shoeFactor:1.3,opacity:e.casingOpacity}),l.jsx(ur,{radialSegments:16,sizeMultiplier:e.sizeMultiplier,fallback:()=>l.jsx(je,{radius:.1*e.sizeMultiplier,color:w,priority:8,radialSegments:16})})]})]}),e.showPerforations&&l.jsx(dr,{sizeMultiplier:e.sizeMultiplier}),e.showDepthMarkers&&R&&l.jsx(cr,{interval:e.depthMarkerInterval,priority:10,depthReferencePoint:"MSL"}),e.showPicks&&l.jsx(Ce,{radialSegments:16,baseRadius:e.sizeMultiplier*.4,showAnnotations:R}),l.jsx(mr,{color:"cyan",size:16})]})})}})})]})]})},Pa={title:"examples/Wells",loaders:[async()=>{$e.getState().clear(),Wn.setState({groups:{}})}],component:$r,argTypes:{surfaceId:{options:[void 0,...Object.keys(ee.surfaceOptions)],control:{type:"select",labels:{undefined:"(none)",...ee.surfaceOptions}}},colorRamp:{options:[0,1,2,3,4,5,6,7,8,9],control:{type:"select",labels:{0:"rainbow",1:"jet",2:"portland",3:"earth",4:"plasma",5:"salinity",6:"seismic",7:"seismic2",8:"spectrum",9:"gray"}}},color:{control:{type:"color"}},opacity:{control:{type:"range",min:0,max:1,step:.01}},maxError:{control:{type:"range",min:.1,max:10,step:.01}},contoursInterval:{options:[1,2,5,10,25,50,100,250,500],control:{type:"select"}},contoursColorMode:{options:[0,1,2],control:{type:"radio",labels:{0:"darken",1:"lighten",2:"mixed"}}},contoursThickness:{control:{type:"range",min:.5,max:5,step:.1}},contoursColor:{control:{type:"color"}},casingOpacity:{control:{type:"range",min:0,max:1,step:.01}},gridCellSize:{options:[250,500,1e3],control:{type:"select"}}},parameters:{scale:1e3,cameraPosition:[0,15e3,2e4],cameraTarget:[0,0,0],colorScale:pn},decorators:[jn,pr,hr,tr,zn,Qn,vr]},X={args:{surfaceId:void 0,useColorRamp:!0,reverseRamp:!1,color:"white",colorRamp:0,opacity:.98,maxError:5,wireframe:!1,showContours:!1,contoursColorMode:Te.darken,contoursColorModeFactor:.5,contoursInterval:10,contoursThickness:.8,contoursColor:"#000000",depthMarkerInterval:250,showPicks:!1,showShoes:!0,showDepthMarkers:!1,showCasingAndCompletion:!1,showPerforations:!0,showCameraTarget:!0,sizeMultiplier:3,casingOpacity:1,gridCellSize:500}};var Be,Ge,He;X.parameters={...X.parameters,docs:{...(Be=X.parameters)==null?void 0:Be.docs,source:{originalSource:`{
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
}`,...(He=(Ge=X.parameters)==null?void 0:Ge.docs)==null?void 0:He.source}}};const ja=["Default"];export{X as Default,ja as __namedExportsOrder,Pa as default};
