import{j as M}from"./jsx-runtime-CmIOflP4.js";import{r as n}from"./index-KqYmeiyw.js";import{I as z,n as j,L as A,o as N,h as O,U as P,A as U}from"./CameraManager-BuezL_By.js";import{u as B,a as G}from"./useWellboreContext-DkvsaS95.js";import{q as F}from"./limiter-DhBcc_yH.js";import{u as H}from"./generators-provider-decorator-C-zBAaMo.js";import{c as W,L as Y}from"./layers-DoaKWXpU.js";import{u as Z}from"./canvas-3d-decorator-BhyssXtK.js";const J="perforationSymbols",R=n.forwardRef(({name:c,position:V,userData:q,castShadow:y,receiveShadow:v,renderOrder:x,visible:_,data:s,geometry:f,material:g,layers:l,onPointerClick:o,onPointerEnter:u,onPointerLeave:r,onPointerMove:t},h)=>{const d=H(),m=n.useMemo(()=>{const i=s.transformations.length/16,e=new z(f,g,i);if(e.instanceMatrix.set(s.transformations),e.instanceMatrix.needsUpdate=!0,s.colors&&(e.instanceColor=new j(s.colors,3),e.instanceColor.needsUpdate=!0),l){const p=l instanceof A?l.mask:l;e.layers.mask=p}return e.castShadow=!!y,e.receiveShadow=!!v,e},[f,g,s,l,y,v]);return n.useImperativeHandle(h,()=>m),n.useEffect(()=>{let i=null;if(d){const e={};o&&(e.click=o),u&&(e.enter=u),r&&(e.leave=r),t&&(e.move=t),Object.keys(e).length&&(i=d.register(m,e))}return()=>{i&&i()}},[d,m,o,u,r,t]),n.useEffect(()=>{},[]),M.jsx("group",{name:c,userData:q,renderOrder:x,position:V,visible:_,children:M.jsx("primitive",{object:m})})});try{R.displayName="Symbols",R.__docgenInfo={description:"A generic component used for simplifying mesh instancing. Use this component if you need a large number of\nmeshes sharing the same base geometry and material, but that may be transformed or colored individually.\n\nTypical use case is for visualizations of data along a wellbore, such as in the `Shoes` and `Picks` component.",displayName:"Symbols",props:{geometry:{defaultValue:null,description:"",name:"geometry",required:!0,type:{name:"BufferGeometry<NormalBufferAttributes>"}},material:{defaultValue:null,description:"",name:"material",required:!0,type:{name:"Material | Material[]"}},data:{defaultValue:null,description:"",name:"data",required:!0,type:{name:"SymbolsType"}},customDepthMaterial:{defaultValue:null,description:"",name:"customDepthMaterial",required:!1,type:{name:"Material | undefined"}},customDistanceMaterial:{defaultValue:null,description:"",name:"customDistanceMaterial",required:!1,type:{name:"Material | undefined"}},onPointerEnter:{defaultValue:null,description:"",name:"onPointerEnter",required:!1,type:{name:"EventEmitterCallback | undefined"}},onPointerLeave:{defaultValue:null,description:"",name:"onPointerLeave",required:!1,type:{name:"EventEmitterCallback | undefined"}},onPointerMove:{defaultValue:null,description:"",name:"onPointerMove",required:!1,type:{name:"EventEmitterCallback | undefined"}},onPointerClick:{defaultValue:null,description:"",name:"onPointerClick",required:!1,type:{name:"EventEmitterCallback | undefined"}},name:{defaultValue:null,description:"",name:"name",required:!1,type:{name:"string | undefined"}},visible:{defaultValue:null,description:"",name:"visible",required:!1,type:{name:"boolean | undefined"}},userData:{defaultValue:null,description:"",name:"userData",required:!1,type:{name:"Record<string, any> | undefined"}},position:{defaultValue:null,description:"",name:"position",required:!1,type:{name:"Vec3 | undefined"}},castShadow:{defaultValue:null,description:"",name:"castShadow",required:!1,type:{name:"boolean | undefined"}},receiveShadow:{defaultValue:null,description:"",name:"receiveShadow",required:!1,type:{name:"boolean | undefined"}},renderOrder:{defaultValue:null,description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}},layers:{defaultValue:null,description:"",name:"layers",required:!1,type:{name:"Layers | undefined"}}}}}catch{}var K=`#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vPosition;
varying vec3 vCamera;

void main() {  
  mat4 instanceModelMatrix = modelMatrix * instanceMatrix;
  vec4 modelPosition = instanceModelMatrix * vec4(position.xyz, 1.0);
  vec4 cameraPosition = inverse(instanceModelMatrix) * vec4(cameraPosition, 1.0);
  vec4 viewPosition = viewMatrix * modelPosition;

  gl_Position = projectionMatrix * viewPosition;
  
  #include <logdepthbuf_vertex>

  vPosition = position.xyz;
  vCamera = cameraPosition.xyz;
}`,Q=`#include <common>

#include <logdepthbuf_pars_fragment>

uniform float uTime;
uniform float uRadius;
uniform float uLength;

varying vec3 vPosition;
varying vec3 vCamera;

vec3 outer = vec3(1.0, 0.2, 0.0);
vec3 inner = vec3(1.0, 1.0, .8);

bool isInside(vec3 pos, float radius) {
  if(pos.y < 0.0 || pos.y > uLength)
    return false;
  return length(pos.xz) < radius;
}

float energyAtPosition(vec3 pos, float radius) {
  return pow(1.0 - (length(pos.xz) / radius), 2.0) * smoothstep(1.0, 0.8, pos.y);
}

void main() {
  #include <logdepthbuf_fragment>
  float STEP_SIZE = uRadius / 20.0;

  vec3 viewVector = vPosition - vCamera;

  if(length(viewVector) > 500.0) {
    gl_FragColor = vec4(mix(vec3(0.8, 0.5, 0.5), vec3(1.0), 0.5), 0.25);
  } else {

    vec3 direction = normalize(viewVector);

    vec3 pos = vPosition.xyz;
    float t = 0.0;
    float e = 0.0;
    float radius = ((uLength - pos.y) / uLength) * uRadius;

    do {
    
      float calculatedE = energyAtPosition(pos, radius);
      if(calculatedE < e)
        break;
      e = calculatedE;
      t += STEP_SIZE;
      pos = vPosition.xyz + direction * t;
      radius = ((uLength - pos.y) / uLength) * uRadius;
    } while(isInside(pos, radius) && e < 1.0);

    e = e + (sin((-vPosition.y + uTime) * 20.0) * 0.003);

    float strength = clamp(e, 0.0, 1.0); 

    vec3 col = mix(outer, inner, strength);
    gl_FragColor = vec4(col, strength);
  }
  
  
}`;const C=n.forwardRef(({name:c,userData:V,renderOrder:q=11,layers:y=W(Y.NOT_EMITTER),position:v,visible:x,castShadow:_,receiveShadow:s,customMaterial:f,customDepthMaterial:g,customDistanceMaterial:l,onMaterialPropertiesChange:o,radialSegments:u=8,baseRadius:r=.1,length:t=1,sizeMultiplier:h=1,priority:d=0},m)=>{const i=n.useRef(null),e=n.useRef({time:0,baseRadius:0,lenght:0}),{id:p,fromMsl:L}=B(),E=G(J),[T,D]=n.useState(null);n.useImperativeHandle(m,()=>i.current);const I=n.useMemo(()=>{const a=new N(r,t,u);return a.translate(0,t/2,0),a},[r,t,u]),b=n.useMemo(()=>f||new O({uniforms:{uTime:new P(0),uRadius:new P(0),uLength:new P(0)},vertexShader:K,fragmentShader:Q,depthTest:!0,depthWrite:!1,blending:U,transparent:!0}),[f]),S=n.useMemo(()=>o||((a,k)=>{const w=k;w.uniforms.uTime.value=a.time,w.uniforms.uRadius.value=a.baseRadius,w.uniforms.uLength.value=a.length}),[o]);return n.useEffect(()=>{e.current.baseRadius=r,e.current.length=t,S(e.current,b)},[r,t,b,S]),n.useEffect(()=>{E&&p&&F(()=>E(p,L,h).then(a=>{D(a)}),d)},[E,p,L,h,d]),Z(({clock:a})=>{e.current.time=a.elapsedTime,S(e.current,b)}),M.jsx("group",{ref:i,children:T&&M.jsx(R,{name:c,userData:V,renderOrder:q,visible:x,position:v,data:T,geometry:I,material:b,layers:y,castShadow:_,receiveShadow:s,customDepthMaterial:g,customDistanceMaterial:l})})});try{C.displayName="Perforations",C.__docgenInfo={description:"Generic render of perforation intervals based on depths, phase and density. Must be a child of the `Wellbore` component.",displayName:"Perforations",props:{name:{defaultValue:null,description:"",name:"name",required:!1,type:{name:"string | undefined"}},visible:{defaultValue:null,description:"",name:"visible",required:!1,type:{name:"boolean | undefined"}},userData:{defaultValue:null,description:"",name:"userData",required:!1,type:{name:"Record<string, any> | undefined"}},position:{defaultValue:null,description:"",name:"position",required:!1,type:{name:"Vec3 | undefined"}},castShadow:{defaultValue:null,description:"",name:"castShadow",required:!1,type:{name:"boolean | undefined"}},receiveShadow:{defaultValue:null,description:"",name:"receiveShadow",required:!1,type:{name:"boolean | undefined"}},renderOrder:{defaultValue:{value:"11"},description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}},layers:{defaultValue:{value:"createLayers(LAYERS.NOT_EMITTER)"},description:"",name:"layers",required:!1,type:{name:"Layers | undefined"}},customMaterial:{defaultValue:null,description:"",name:"customMaterial",required:!1,type:{name:"Material | Material[] | undefined"}},customDepthMaterial:{defaultValue:null,description:"",name:"customDepthMaterial",required:!1,type:{name:"Material | undefined"}},customDistanceMaterial:{defaultValue:null,description:"",name:"customDistanceMaterial",required:!1,type:{name:"Material | undefined"}},onMaterialPropertiesChange:{defaultValue:null,description:"",name:"onMaterialPropertiesChange",required:!1,type:{name:"((props: Record<string, any>, material: Material | Material[]) => void) | undefined"}},radialSegments:{defaultValue:{value:"8"},description:"",name:"radialSegments",required:!1,type:{name:"number | undefined"}},baseRadius:{defaultValue:{value:"0.1"},description:"",name:"baseRadius",required:!1,type:{name:"number | undefined"}},length:{defaultValue:{value:"1"},description:"",name:"length",required:!1,type:{name:"number | undefined"}},sizeMultiplier:{defaultValue:{value:"1"},description:"",name:"sizeMultiplier",required:!1,type:{name:"number | undefined"}},priority:{defaultValue:{value:"0"},description:"",name:"priority",required:!1,type:{name:"number | undefined"}}}}}catch{}export{C as P,R as S};
