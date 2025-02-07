import{j as _}from"./jsx-runtime-CmIOflP4.js";import{r as a}from"./index-KqYmeiyw.js";import{u as O,a as j,b as G}from"./useWellboreContext-l1cQXUDV.js";import{h as M,l as U,D as N,U as t}from"./CameraManager-BTlj_2qD.js";import{l as A}from"./limiter-DhBcc_yH.js";import{c as B,L as I}from"./uv-material-Cw8kPkQB.js";import{u as Y}from"./canvas-3d-decorator-DXFES1_8.js";var k=`attribute float curveLength;

varying float vLength;
varying vec2 vUv;
varying vec3 vModelPosition;

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vec4 modelPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelPosition;

  #include <logdepthbuf_vertex>  

  vModelPosition = vModelPosition.xyz;
  vLength = curveLength;
  vUv = uv;
}`,z=`uniform float uTime;
uniform float uFrom;
uniform float uTo;
uniform float uOpacity;
uniform vec3 uColor;

varying float vLength;
varying vec2 vUv;

#include <common>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>

void main() {

  #include <logdepthbuf_fragment>

  float uDensity = 300.0;
  
  
  float modulatedLength = mod(vLength - uFrom, uDensity); 
  
  float coord1 = modulatedLength / 10.0;
  float coord2 = vUv.y * 20.0;
  float line1 = abs(fract(coord1 - 0.5) - 0.5) / fwidth(coord1);
  float line2 = abs(fract(coord2 - 0.5) - 0.5) / fwidth(coord2);

  float line = min(line1, line2);

  float strength = 1.0 - min(line, 1.0);
  strength = pow(strength, 1.0 / 2.2);
  

  
  if (vLength < uFrom || vLength > uTo || uOpacity < 0.01) discard;

  vec3 color = uColor;
  if (!gl_FrontFacing) {
    color = mix(color, vec3(0.0), 0.75);
  }

  gl_FragColor = vec4(color * strength, uOpacity);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;const W="perimeterGeometry",w=({color:o="#56af3b",radius:v,from:l,to:d,opacity:s=.5,name:V,userData:q,visible:x,layers:L=B(I.NOT_EMITTER),position:T,renderOrder:P=3,castShadow:E,receiveShadow:S,customDepthMaterial:D,customDistanceMaterial:R,customMaterial:m,onMaterialPropertiesChange:f})=>{const{id:y,segmentsPerMeter:g,simplificationThreshold:h}=O(),C=a.useRef(null),r=a.useRef({color:o,opacity:s,from:l,to:d,time:0}),c=j(W),[b,F]=a.useState(null);a.useEffect(()=>{c&&A(()=>c(y,v,g,h)).then(e=>{if(e){const u=G(e);u.computeBoundingBox(),F(n=>(n&&n.dispose(),u))}})},[c,y,v,g,h]);const p=a.useMemo(()=>f||((e,u)=>{const n=u;n.uniforms.uColor.value=new M(e.color),n.uniforms.uFrom.value=e.from,n.uniforms.uTo.value=e.to,n.uniforms.uOpacity.value=e.opacity,n.uniforms.uTime.value=e.time}),[f]),i=a.useMemo(()=>m||new U({transparent:!0,side:N,vertexShader:k,fragmentShader:z,uniforms:{uTime:new t(0),uFrom:new t(0),uTo:new t(0),uOpacity:new t(0),uColor:new t(new M("#56af3b"))}}),[m]);return a.useEffect(()=>{r.current.color=o,r.current.opacity=s,r.current.from=l,r.current.to=d,p(r.current,i)},[l,d,s,o,i,p]),Y(({clock:e})=>{r.current.time=e.getElapsedTime(),p(r.current,i)}),b?_.jsx("group",{ref:C,name:V,userData:q,visible:x,position:T,renderOrder:P,children:_.jsx("mesh",{geometry:b,material:i,customDepthMaterial:D,customDistanceMaterial:R,layers:L,castShadow:E,receiveShadow:S})}):null};try{w.displayName="Perimeter",w.__docgenInfo={description:`A simple cylindrical perimeter that can be rendered on top of a wellbore trajectory, with a given
start and end depth as well as a radius.`,displayName:"Perimeter",props:{name:{defaultValue:null,description:"",name:"name",required:!1,type:{name:"string | undefined"}},visible:{defaultValue:null,description:"",name:"visible",required:!1,type:{name:"boolean | undefined"}},userData:{defaultValue:null,description:"",name:"userData",required:!1,type:{name:"Record<string, any> | undefined"}},position:{defaultValue:null,description:"",name:"position",required:!1,type:{name:"Vec3 | undefined"}},castShadow:{defaultValue:null,description:"",name:"castShadow",required:!1,type:{name:"boolean | undefined"}},receiveShadow:{defaultValue:null,description:"",name:"receiveShadow",required:!1,type:{name:"boolean | undefined"}},renderOrder:{defaultValue:{value:"3"},description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}},layers:{defaultValue:{value:"createLayers(LAYERS.NOT_EMITTER)"},description:"",name:"layers",required:!1,type:{name:"Layers | undefined"}},customMaterial:{defaultValue:null,description:"",name:"customMaterial",required:!1,type:{name:"Material | Material[] | undefined"}},customDepthMaterial:{defaultValue:null,description:"",name:"customDepthMaterial",required:!1,type:{name:"Material | undefined"}},customDistanceMaterial:{defaultValue:null,description:"",name:"customDistanceMaterial",required:!1,type:{name:"Material | undefined"}},onMaterialPropertiesChange:{defaultValue:null,description:"",name:"onMaterialPropertiesChange",required:!1,type:{name:"((props: Record<string, any>, material: Material | Material[]) => void) | undefined"}},color:{defaultValue:{value:"#56af3b"},description:"",name:"color",required:!1,type:{name:"string | number | Color | undefined"}},radius:{defaultValue:null,description:"",name:"radius",required:!0,type:{name:"number"}},from:{defaultValue:null,description:"",name:"from",required:!0,type:{name:"number"}},to:{defaultValue:null,description:"",name:"to",required:!0,type:{name:"number"}},opacity:{defaultValue:{value:"0.5"},description:"",name:"opacity",required:!1,type:{name:"number | undefined"}}}}}catch{}export{w as P};
