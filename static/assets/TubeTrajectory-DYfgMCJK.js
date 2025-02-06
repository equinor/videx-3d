var M=Object.defineProperty;var q=(r,n,e)=>n in r?M(r,n,{enumerable:!0,configurable:!0,writable:!0,value:e}):r[n]=e;var x=(r,n,e)=>q(r,typeof n!="symbol"?n+"":n,e);import{j as P}from"./jsx-runtime-CmIOflP4.js";import{r as i}from"./index-KqYmeiyw.js";import{h as w,l as B,m as D,c as z}from"./CameraManager-BuezL_By.js";import{u as A,a as j,b as F}from"./useWellboreContext-DkvsaS95.js";import{c as O,L as Q}from"./layers-DoaKWXpU.js";import{q as N}from"./limiter-DhBcc_yH.js";var I=`#define TRAJECTORY_MATERIAL

varying vec3 vViewPosition;

#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_fragment>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {

	#include <uv_vertex>
	#include <color_vertex>
  #include <batching_vertex>
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <normal_vertex>

	#include <begin_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>

  vViewPosition = - mvPosition.xyz;

	#include <worldpos_vertex>
	#include <fog_vertex>
}`,U=`#define TRAJECTORY_MATERIAL

uniform vec3 diffuse;
uniform float opacity;

#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
varying vec3 vViewPosition;
varying vec3 vColor;

#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
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

void main() {
	#include <clipping_planes_fragment>

  vec3 color = diffuse.rgb;
  	
  vec4 diffuseColor = vec4(color.rgb, opacity);

	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
  #include <normal_fragment_begin>
  
  #ifdef DEPTH_SHADE
    float depthFactor = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
    float darkenFactor = clamp(vViewPosition.z / 5000.0, 0.1, 0.8);
    vec3 hsv = rgb2hsv(diffuseColor.rgb);
    hsv.z = hsv.z * darkenFactor;
    vec3 mixColor = hsv2rgb(hsv);
    diffuseColor.rgb = mix(mixColor, diffuseColor.rgb, pow(depthFactor, 0.8));
  #else
    float alphaFactor = clamp(vViewPosition.z / 100000.0, 0.0, 0.9);

    diffuseColor.a = 1.0 - alphaFactor;
  #endif
  
  gl_FragColor = diffuseColor.rgba;

	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>

	#ifdef OPAQUE

		gl_FragColor.a = 1.0;

	#endif
}`;class Y extends w{constructor(e){super({vertexShader:I,fragmentShader:U,uniforms:B.clone(D.basic.uniforms),defines:{DEPTH_SHADE:!0},clipping:!0,fog:!0});x(this,"isTubeMaterial",!0);e&&this.setValues(e)}get color(){return this.uniforms.diffuse.value}set color(e){this.uniforms.diffuse.value.set(e)}}const k="tubeTrajectory",V=({name:r,userData:n,position:e,castShadow:C,receiveShadow:R,layers:S=O(Q.OCCLUDER),renderOrder:H,visible:L,customDepthMaterial:T,customDistanceMaterial:E,customMaterial:u,onMaterialPropertiesChange:s,color:f="red",radius:t=.5,radialSegments:m=16,priority:p=0})=>{const{id:v,fromMsl:g,segmentsPerMeter:_,simplificationThreshold:b}=A(),d=j(k),[y,G]=i.useState(null),h=i.useMemo(()=>s||((l,o)=>{const a=o;a.color=new z(l.color)}),[s]),c=i.useMemo(()=>u||new Y,[u]);return i.useEffect(()=>{h({color:f,radius:t},c)},[f,t,c,h]),i.useEffect(()=>{d&&N(()=>d(v,_,b,g,t,m).then(l=>{let o=null;l&&(o=F(l)),G(a=>(a&&a.dispose(),o||a))}),p)},[d,v,g,_,b,t,m,p]),y?P.jsx("mesh",{name:r,position:e,userData:n,renderOrder:H,layers:S,castShadow:C,receiveShadow:R,visible:L,geometry:y,material:c,customDepthMaterial:T,customDistanceMaterial:E}):null};try{V.displayName="TubeTrajectory",V.__docgenInfo={description:"Renders a trajectory as a tube geometry.",displayName:"TubeTrajectory",props:{name:{defaultValue:null,description:"",name:"name",required:!1,type:{name:"string | undefined"}},visible:{defaultValue:null,description:"",name:"visible",required:!1,type:{name:"boolean | undefined"}},userData:{defaultValue:null,description:"",name:"userData",required:!1,type:{name:"Record<string, any> | undefined"}},position:{defaultValue:null,description:"",name:"position",required:!1,type:{name:"Vec3 | undefined"}},castShadow:{defaultValue:null,description:"",name:"castShadow",required:!1,type:{name:"boolean | undefined"}},receiveShadow:{defaultValue:null,description:"",name:"receiveShadow",required:!1,type:{name:"boolean | undefined"}},renderOrder:{defaultValue:null,description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}},layers:{defaultValue:{value:"createLayers(LAYERS.OCCLUDER)"},description:"",name:"layers",required:!1,type:{name:"Layers | undefined"}},customMaterial:{defaultValue:null,description:"",name:"customMaterial",required:!1,type:{name:"Material | Material[] | undefined"}},customDepthMaterial:{defaultValue:null,description:"",name:"customDepthMaterial",required:!1,type:{name:"Material | undefined"}},customDistanceMaterial:{defaultValue:null,description:"",name:"customDistanceMaterial",required:!1,type:{name:"Material | undefined"}},onMaterialPropertiesChange:{defaultValue:null,description:"",name:"onMaterialPropertiesChange",required:!1,type:{name:"((props: Record<string, any>, material: Material | Material[]) => void) | undefined"}},radius:{defaultValue:{value:"0.5"},description:"",name:"radius",required:!1,type:{name:"number | undefined"}},color:{defaultValue:{value:"red"},description:"",name:"color",required:!1,type:{name:"string | undefined"}},radialSegments:{defaultValue:{value:"16"},description:"",name:"radialSegments",required:!1,type:{name:"number | undefined"}},priority:{defaultValue:{value:"0"},description:"",name:"priority",required:!1,type:{name:"number | undefined"}}}}}catch{}export{V as T,Y as a};
