import{j as V}from"./jsx-runtime-CmIOflP4.js";import{r as d}from"./index-KqYmeiyw.js";import{V as le,h as C,l as Le,P as ke,U as u,o as Q,p as Pe,D as De,F as Te,R as Re,W as Ge,q as xe,H as je}from"./CameraManager-BTlj_2qD.js";import{c as B}from"./numbers-DM6OWwIG.js";import"./uv-material-Cw8kPkQB.js";import"./limiter-DhBcc_yH.js";import{u as _e,a as ze}from"./canvas-3d-decorator-DXFES1_8.js";import{T as ye}from"./Text-DbK8u8Ip.js";const Ie=(r,o,m,e,l)=>{const p=m[0]*.5,O=m[1]*.5,[g,W]=l,b=r*m[0],y=o*m[1],k=(b-(p+g))*e[0],c=(y-(O+W))*e[1];return[k,c]},h=new le,de=({scale:r,start:o,size:m,units:e,originOffset:l,axesOffset:p,axesTickSize:O,plane:g,color:W,side:b,trimAxesLabels:y=!1,renderOrder:k=2})=>{const[c,z]=d.useState({x:0,y:0,flipped:!1});_e(({camera:t})=>{t.getWorldDirection(h);const i={x:0,y:0,flipped:!1};g==="xz"?(i.flipped=h.y>0,i.flipped?(i.x=h.z<0?Math.PI:0,i.y=h.x<0?Math.PI:0):(i.x=h.z>0?Math.PI:0,i.y=h.x>0?Math.PI:0)):g==="xy"?(i.flipped=h.z>0,i.x=0,i.y=h.x>0?Math.PI:0):g==="zy"&&(i.flipped=h.x>0,i.x=0,i.y=h.z<0?Math.PI:0),(c.x!==i.x||c.y!==i.y||c.flipped!==i.flipped)&&z(i)});const P=d.useMemo(()=>e/7.5,[e]),X=d.useMemo(()=>new C(W||"#fff"),[W]),x=d.useMemo(()=>{const t=[m[0]*.5,m[1]*.5],i=[t[0]+l[0],t[1]+l[1]],D=[i[0]+B(p[0],-t[0],t[0]),i[1]+B(p[1],-t[1],t[1])],Y=[Math.floor((i[0]-i[0]%e)/e),Math.floor((i[1]-i[1]%e)/e)],I=[-t[0]+i[0]%e,-t[1]+i[1]%e],U=[Math.min(1e3,Math.floor((m[0]-i[0]%e)/e)+1),Math.min(1e3,Math.floor((m[1]-i[1]%e)/e)+1)],M=[],E=[],F=O*e+P*.6,N=[B(p[1]+l[1],-t[1],+t[1]),B(p[0]+l[0],-t[0],+t[0])];for(let v=y?1:0;v<U[0]-(y?1:0);v++){const w=[I[0]+v*e,N[0]+F],A=Math.round(10*(o[0]+(v-Y[0])*e*r[0]))/10;Math.abs(D[0]-(w[0]+t[0]))>e/4&&M.push({pos:w,value:A,index:`x${v}`})}for(let v=y?1:0;v<U[1]-(y?1:0);v++){const w=[N[1]-F,I[1]+v*e],A=Math.round(10*(o[1]+(v-Y[1])*e*r[1]))/10;Math.abs(D[1]-(w[1]+t[1]))>e/4&&E.push({pos:w,value:A,index:`y${v}`})}return{xAxis:M,yAxis:E}},[m,e,l,p,O,P,r,o,y]);return V.jsxs("group",{renderOrder:k,position:[0,0,(c.flipped?-1:1)*(e/1e3)],visible:b==="both"||b==="front"&&!c.flipped||b==="back"&&c.flipped,children:[x.xAxis.map(t=>V.jsx(ye,{characters:"123456789,.0",position:[...t.pos,0],fontSize:P,textAlign:"center",anchorX:"center",anchorY:"middle","rotation-z":c.x,"rotation-y":c.flipped?Math.PI:0,color:X,"material-depthWrite":!1,children:t.value},t.index)),x.yAxis.map(t=>V.jsx(ye,{characters:"123456789,.0",position:[...t.pos,0],fontSize:P,textAlign:"center",anchorX:"center",anchorY:"middle","rotation-z":c.y+Math.PI/2,"rotation-x":c.flipped?Math.PI:0,color:X,"material-depthWrite":!1,children:t.value},t.index))]})};try{de.displayName="GridAxesLabels",de.__docgenInfo={description:"Adds grid axes and labels to a `Grid` component. Used internally by the `Grid` component.",displayName:"GridAxesLabels",props:{scale:{defaultValue:null,description:"",name:"scale",required:!0,type:{name:"Vec2"}},units:{defaultValue:null,description:"",name:"units",required:!0,type:{name:"number"}},start:{defaultValue:null,description:"",name:"start",required:!0,type:{name:"Vec2"}},originOffset:{defaultValue:null,description:"",name:"originOffset",required:!0,type:{name:"Vec2"}},size:{defaultValue:null,description:"",name:"size",required:!0,type:{name:"Vec2"}},axesTickSize:{defaultValue:null,description:"",name:"axesTickSize",required:!0,type:{name:"number"}},plane:{defaultValue:null,description:"",name:"plane",required:!0,type:{name:'"xz" | "xy" | "zy"'}},color:{defaultValue:null,description:"",name:"color",required:!1,type:{name:"string | number | Color | undefined"}},side:{defaultValue:null,description:"",name:"side",required:!1,type:{name:'"front" | "back" | "both" | undefined'}},axesOffset:{defaultValue:null,description:"",name:"axesOffset",required:!0,type:{name:"Vec2"}},trimAxesLabels:{defaultValue:{value:"false"},description:"",name:"trimAxesLabels",required:!1,type:{name:"boolean"}},renderOrder:{defaultValue:{value:"2"},description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}}}}}catch{}var Ue=`precision highp float;

#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uBackground;
uniform float uBackgroundOpacity;
uniform vec2 uSize;
uniform float uCellSize;
uniform float uSubDivisions;
uniform float uOpacity;
uniform vec3 uGridColorMajor;
uniform vec3 uGridColorMinor;
uniform float uGridLineWidth;
uniform vec2 uAxesOffset;
uniform vec3 uAxesColor;
uniform float uAxesLineWidth;
uniform float uAxesTickSize;
uniform vec2 uOriginOffset;
uniform vec2 uCursorPosition;
uniform vec3 uRulerColor;
uniform float uRulerLineWidth;
uniform float uRulerOpacity;
uniform sampler2D uProjectionTexture;
uniform vec3 uProjectionColor;
uniform sampler2D uTexture;
uniform float uTextureMix;

varying vec2 vUv;

float pristineGrid(vec2 uv, vec2 lineWidth) {
  
  
  
  vec2 uvDeriv = fwidth(uv * 2.0);

  vec2 drawWidth = clamp(lineWidth, uvDeriv, vec2(0.5));
  vec2 lineAA = uvDeriv * 1.5;
  vec2 gridUV = 1.0 - abs(fract(uv) * 2.0 - 1.0);
  vec2 grid2 = smoothstep(drawWidth + lineAA, drawWidth - lineAA, gridUV);
  grid2 *= saturate(lineWidth / drawWidth);
  
  grid2 = mix(grid2, lineWidth, clamp(uvDeriv * 2.0 - 1.0, 0.0, 1.0));

  
  return max(grid2.x, grid2.y);
}

float pristineRadialGrid(vec2 _uv, vec2 _lineWidth, float _segments, float _cutoff) {
  float angle = atan(_uv.y, _uv.x) / PI2;
  
  float angleFrac = fract(angle);
  float ddAngle = fwidth(angle * 2.0);
  float ddAngleFrac = fwidth(angleFrac * 2.0);
  ddAngle = ddAngle - 0.00001 < ddAngleFrac ? ddAngle : ddAngleFrac;

  float dist = length(_uv);
  
  #ifdef DYNAMICSEGMENTS
    float logDist = log2(dist);
    float segments = pow(2.0, max(2.0, ceil(logDist) + 2.0));
  #else
    float segments = max(1.0, round(_segments));
  #endif

  vec2 lineWidth = vec2(_lineWidth.x * segments / (dist * PI2), _lineWidth.y);
  vec2 uv = vec2(angle * segments, dist);
  vec2 uvDeriv = vec2(ddAngle * segments, fwidth(dist * 2.0));

  vec2 drawWidth = clamp(lineWidth, uvDeriv, vec2(0.5));
  vec2 lineAA = uvDeriv * 1.5;
  vec2 gridUV = 1.0 - abs(fract(uv) * 2.0 - 1.0);
  vec2 grid2 = smoothstep(drawWidth + lineAA, drawWidth - lineAA, gridUV);

  #ifdef SATURATE
  grid2 *= saturate(lineWidth / drawWidth);
  #endif
  grid2 *= step(_cutoff, dist);
  
  return max(grid2.x, grid2.y);
}

float lines(vec2 uv, vec2 lineWidth) {
  vec2 uvDeriv = fwidth(uv * 2.0);

  vec2 drawWidth = clamp(lineWidth * uvDeriv, uvDeriv, vec2(0.5));
  vec2 lineAA = uvDeriv * 1.5;
  vec2 axisLine2 = smoothstep(drawWidth + lineAA, drawWidth - lineAA, abs(uv * 2.0));

  axisLine2 *= saturate(lineWidth / drawWidth);

  return max(axisLine2.x, axisLine2.y);
}

float ticklines(vec2 uv, vec2 offset, vec2 lineWidth, float tickSize) {
  vec2 uvDeriv = fwidth(uv * 2.0);

  vec2 drawWidth = clamp(lineWidth * uvDeriv, uvDeriv, vec2(0.5));
  vec2 lineAA = uvDeriv * 1.5;
  vec2 tickUV = 1.0 - abs(fract(uv) * 2.0 - 1.0);
  vec2 tickLine2 = smoothstep(drawWidth + lineAA, drawWidth - lineAA, tickUV);
  
  tickLine2 *= saturate(lineWidth / drawWidth);
  tickLine2 *= 1.0 - step( tickSize, abs( uv.yx - offset.yx));
  return max(tickLine2.x, tickLine2.y);
}

vec4 drawGrid(vec4 color, vec2 uv, vec3 lineColor, vec2 lineWidth) {
  float grid = pristineGrid(uv, lineWidth);
  color = mix(color, vec4(lineColor, uOpacity), grid);
  return color;
}

vec4 drawRadialGrid(vec4 color, vec2 uv, vec3 lineColor, vec2 lineWidth, float segments, float cutoff) {
  float grid = pristineRadialGrid(uv, lineWidth, segments, cutoff);
  color = mix(color, vec4(lineColor, uOpacity), grid);
  return color;
}

vec4 drawAxisLines(vec4 color, vec2 uv, vec2 originOffset, vec2 axesOffset, vec3 lineColor, vec2 lineWidth, float tickSize) {
  vec2 tickOffset = axesOffset;
  
  float axesLines = lines(uv - originOffset - axesOffset, lineWidth);
  vec2 tickLineWidth = lineWidth;
  float majorTicks = ticklines(uv - originOffset,  tickOffset, tickLineWidth, tickSize);
  float minorTicks = ticklines((uv - originOffset) * uSubDivisions,  tickOffset * uSubDivisions, tickLineWidth * uSubDivisions * 0.5, tickSize * uSubDivisions * 0.5);
  float lines = max(axesLines, max(minorTicks, majorTicks));
  color = mix(color, vec4(lineColor, uOpacity), lines);
  
  return color;
}

vec4 drawRulerLines(vec4 color, vec2 uv, vec3 lineColor, vec2 lineWidth, float opacity) {
  float rulerLines = lines(uv, lineWidth) * opacity;
  color = mix(color, vec4(lineColor, uOpacity), rulerLines);
  return color;
}

void main() {
  #include <logdepthbuf_fragment>
  
  vec2 originOffset = clamp(uOriginOffset, -uSize / 2.0, uSize / 2.0) / uCellSize; 
  vec2 axesOffset = uAxesOffset / uCellSize;

  vec2 uv = (vUv.xy - 0.5) * (uSize / uCellSize); 

  vec2 uvMaj = uv - originOffset;
  vec2 uvMin = uvMaj * uSubDivisions;

  vec4 color = vec4(uBackground, uBackgroundOpacity * uOpacity);
  vec2 projectionUv = vec2(1.0 - vUv.x, vUv.y);
  
  vec4 textureColor = texture2D(uTexture, vUv);
  color = mix(color, textureColor, textureColor.a * uTextureMix);

  float projection = texture2D(uProjectionTexture, projectionUv).a;
  color = mix(color, vec4(uProjectionColor, uOpacity), projection); 

  #ifdef RADIAL
    color = drawRadialGrid(color, uvMin, uGridColorMinor, vec2(uGridLineWidth * uSubDivisions * 0.75), 16.0 * uSubDivisions, 0.0);
    color = drawRadialGrid(color, uvMaj, uGridColorMajor, vec2(uGridLineWidth), 16.0, 0.0);
  #else
    color = drawGrid(color, uvMin, uGridColorMinor, vec2(uGridLineWidth * uSubDivisions * 0.75));
    color = drawGrid(color, uvMaj, uGridColorMajor, vec2(uGridLineWidth));
  #endif
  
  #ifdef RULERS
    if (uCursorPosition.x > 0.0 && uCursorPosition.y > 0.0) {
      color = drawRulerLines(color, vUv - uCursorPosition, uRulerColor, vec2(uRulerLineWidth), uRulerOpacity);
    }
  #endif

  #ifdef AXES
  color = drawAxisLines(color, uv, originOffset, axesOffset, uAxesColor, vec2(uAxesLineWidth), uAxesTickSize);
  #endif

  
  
  
  gl_FragColor = color;

  
  
}`,Ee=`#include <common>
#include <logdepthbuf_pars_vertex>

varying vec2 vUv;

void main() {

  vec4 mvPosition = vec4(position, 1.0);

  #ifdef USE_INSTANCING

  mvPosition = instanceMatrix * mvPosition;

  #endif

  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;

  vUv = uv;

  #include <logdepthbuf_vertex>
}`;const Fe=new Le,Ne=[[0,.1],[2.5,.25],[5,.5],[10,1],[25,2.5],[50,5],[100,10],[250,25],[500,50],[999,100]],he=({plane:r,size:o,position:m=[0,0,0],gridOrigin:e,gridScale:l=[1,1],cellSize:p=10,subDivisions:O=0,background:g=1056816,backgroundOpacity:W=1,opacity:b=1,gridColorMajor:y="#89a",gridColorMinor:k="#789",gridLineWidth:c=.05,showAxes:z=!0,showAxesLabels:P=!0,trimAxesLabels:X=!1,axesOffset:x=void 0,axesColor:t="#fff",axesLineWidth:i=c||.05,axesTickSize:D=.1,originValue:Y=[0,0],radial:I=!1,dynamicSegments:U=!1,showRulers:M=!1,rulerColor:E="#c59797",rulerLineWidth:F=1,rulerOpacity:N=.5,planeOffset:v=0,dynamicCellSize:w=!1,cellSizeDistanceFactors:A=Ne,side:T="both",onRulerUpdate:R=null,texture:se,textureMix:fe=1,enableProjection:Z=!1,projectionDistance:ee=1e3,projectionColor:ce="#456",projectionResolution:ne=1024,projectionRefreshRate:ve=100,name:ge,userData:be,renderOrder:H,visible:Ve,castShadow:we,receiveShadow:Ae,layers:Ce})=>{const[q,Oe]=d.useState({originOffset:[0,0],axesOffset:[0,0]}),[ie,me]=d.useState(1),S=d.useMemo(()=>new ke,[]),L=d.useRef(null),re=d.useRef(null),te=d.useRef(null),a=d.useRef({uSize:new u(new Q(0,0)),uBackground:new u(new C(1056816)),uBackgroundOpacity:new u(1),uOpacity:new u(1),uCellSize:new u(10),uSubDivisions:new u(0),uOriginOffset:new u(new Q(0,0)),uDistanceFactor:new u(0),uGridColorMajor:new u(new C("#abc")),uGridColorMinor:new u(new C("#789")),uGridLineWidth:new u(.05),uAxesOffset:new u(new Q(0,0)),uAxesColor:new u(new C("#fff")),uAxesLineWidth:new u(1),uAxesTickSize:new u(.1),uCursorPosition:new u(new Q),uRulerColor:new u(new C("#fff")),uRulerLineWidth:new u(1),uRulerOpacity:new u(.5),uProjectionTexture:new u(void 0),uProjectionColor:new u(new C("#456")),uTexture:new u(void 0),uTextureMix:new u(1)}),{controls:G,camera:ae,gl:j,scene:$}=ze(),We=d.useMemo(()=>[(r==="zy"?v:0)+m[0],(r==="xz"?v:0)+m[1],(r==="xy"?v:0)+m[2]],[r,v,m]),ue=d.useMemo(()=>r==="xz"?[l[0],-l[1]]:r==="zy"?[-l[0],l[1]]:[...l],[l,r]),Me=d.useMemo(()=>T==="back"?Pe:T==="both"?De:Te,[T]);d.useEffect(()=>{const s=L.current;if(s){const f=new le;s.getWorldPosition(f);const n={axesOffset:[0,0],originOffset:[0,0]};e?r==="xz"?(n.originOffset[0]=e[0]-f.x,n.originOffset[1]=-(e[1]-f.z)):r==="xy"?(n.originOffset[0]=e[0]-f.x,n.originOffset[1]=e[1]-f.y):r==="zy"&&(n.originOffset[0]=-(e[0]-f.z),n.originOffset[1]=e[1]-f.y):(n.originOffset[0]=0,n.originOffset[1]=0),x?r==="xz"?(n.axesOffset[0]=x[0]*l[0]-n.originOffset[0],n.axesOffset[1]=-x[1]*l[1]-n.originOffset[1]):r==="xy"?(n.axesOffset[0]=x[0]*l[0]-n.originOffset[0],n.axesOffset[1]=x[1]*l[1]-n.originOffset[1]):r==="zy"&&(n.axesOffset[0]=-x[0]*l[0]-n.originOffset[0],n.axesOffset[1]=x[1]*l[1]-n.originOffset[1]):(n.axesOffset[0]=0,n.axesOffset[1]=0),r==="xz"?S.normal.set(0,1,0):r==="xy"?S.normal.set(0,0,1):r==="zy"&&S.normal.set(1,0,0),S.constant=f.length(),Oe(n)}},[r,e,x,l,S]),d.useEffect(()=>{a.current.uBackground.value=new C(g??7368816),a.current.uBackgroundOpacity.value=W,a.current.uSize.value.set(...o),a.current.uOpacity.value=Number.isFinite(b)?B(b,0,1):1,a.current.uCellSize.value=p*ie,a.current.uSubDivisions.value=O,a.current.uGridColorMajor.value.set(y),a.current.uGridColorMinor.value.set(k),a.current.uGridLineWidth.value=c,a.current.uAxesLineWidth.value=i,a.current.uAxesColor.value.set(t),a.current.uAxesTickSize.value=D,a.current.uAxesOffset.value.set(...q.axesOffset),a.current.uOriginOffset.value.set(...q.originOffset),a.current.uRulerLineWidth.value=F,a.current.uRulerColor.value.set(E),a.current.uRulerOpacity.value=N,a.current.uTexture.value=se,a.current.uTextureMix.value=fe,a.current.uProjectionColor.value.set(ce)},[o,p,ie,O,g,W,b,y,k,t,i,D,c,E,F,N,q,se,fe,ce]),d.useEffect(()=>{const s=new le,f=new Re;function n(){if(L.current){ae.getWorldDirection(s),f.set(ae.position,s);const J=f.distanceToPlane(S);if(J){const oe=Math.min(J,1e3*p)/p;let _=A.findIndex(K=>K[0]>=oe);_===-1?_=A.length-1:_--,_=Math.max(0,_);const pe=A[_][1];me(K=>K!==pe?pe:K)}}}return L.current&&G&&w?(G.addEventListener("update",n),n()):me(1),()=>{G==null||G.removeEventListener("update",n)}},[G,ae,S,w,p,A,o]),d.useEffect(()=>{re.current&&(re.current.needsUpdate=!0)},[I,z,U,M]),d.useEffect(()=>{let s=null,f=null;return Z&&(s=new Ge(ne,ne,{minFilter:xe,magFilter:xe,type:je}),a.current.uProjectionTexture.value=s.texture,f=setInterval(()=>{if(s&&L.current&&te.current){const J=te.current,oe=j.getRenderTarget();j.setRenderTarget(s),$.overrideMaterial=Fe,L.current.visible=!1,j.clear(),j.render($,J),$.overrideMaterial=null,j.setRenderTarget(oe),L.current.visible=!0}},ve)),()=>{f&&clearInterval(f),s==null||s.dispose()}},[Z,j,$,o,ee,ne,ve]);const qe=d.useCallback(s=>{var f,n;a.current.uCursorPosition.value.set(((f=s.uv)==null?void 0:f.x)||0,((n=s.uv)==null?void 0:n.y)||0),R&&s.uv&&R(Ie(s.uv.x,s.uv.y,o,ue,q.originOffset))},[o,ue,q.originOffset,R]),Se=d.useCallback(()=>{a.current.uCursorPosition.value.set(0,0),R&&R(null)},[R]);return V.jsxs("group",{ref:L,name:ge,userData:be,visible:Ve,"rotation-x":r==="xz"?-Math.PI/2:0,"rotation-y":r==="zy"?Math.PI/2:0,position:We,renderOrder:H,children:[V.jsxs("mesh",{"position-z":-.001*p,onPointerMove:M?qe:void 0,onPointerLeave:M?Se:void 0,renderOrder:1,castShadow:we,receiveShadow:Ae,layers:Ce,children:[V.jsx("planeGeometry",{args:o}),V.jsx("shaderMaterial",{ref:re,uniforms:a.current,defines:{RADIAL:I,DYNAMICSEGMENTS:U,AXES:!!z,RULERS:!!M,SATURATE:!0},vertexShader:Ee,fragmentShader:Ue,side:Me,depthWrite:!0,depthTest:!0,forceSinglePass:!0,transparent:!0}),z&&P&&V.jsx(de,{originOffset:q.originOffset,axesOffset:q.axesOffset,trimAxesLabels:X,scale:ue,size:o,start:Y,units:p*ie,axesTickSize:D,plane:r,color:t,side:T,renderOrder:H!==void 0&&Number.isFinite(H)?H+1:void 0})]}),Z&&V.jsx("orthographicCamera",{ref:te,args:T==="back"?[o[0]/2,o[0]/-2,o[1]/2,o[1]/-2,1,ee]:[o[0]/-2,o[0]/2,o[1]/2,o[1]/-2,1,ee],"rotation-y":T==="back"?0:Math.PI})]})};try{he.displayName="Grid",he.__docgenInfo={description:"Renders an axis aligned grid plane (xz, xy or zy).",displayName:"Grid",props:{name:{defaultValue:null,description:"",name:"name",required:!1,type:{name:"string | undefined"}},visible:{defaultValue:null,description:"",name:"visible",required:!1,type:{name:"boolean | undefined"}},userData:{defaultValue:null,description:"",name:"userData",required:!1,type:{name:"Record<string, any> | undefined"}},position:{defaultValue:{value:"[0, 0, 0]"},description:"",name:"position",required:!1,type:{name:"Vec3 | undefined"}},castShadow:{defaultValue:null,description:"",name:"castShadow",required:!1,type:{name:"boolean | undefined"}},receiveShadow:{defaultValue:null,description:"",name:"receiveShadow",required:!1,type:{name:"boolean | undefined"}},renderOrder:{defaultValue:null,description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}},layers:{defaultValue:null,description:"",name:"layers",required:!1,type:{name:"Layers | undefined"}},plane:{defaultValue:null,description:"",name:"plane",required:!0,type:{name:'"xz" | "xy" | "zy"'}},size:{defaultValue:null,description:"",name:"size",required:!0,type:{name:"Vec2"}},cellSize:{defaultValue:{value:"10"},description:"",name:"cellSize",required:!1,type:{name:"number | undefined"}},subDivisions:{defaultValue:{value:"0"},description:"",name:"subDivisions",required:!1,type:{name:"number | undefined"}},gridOrigin:{defaultValue:null,description:"",name:"gridOrigin",required:!1,type:{name:"Vec2 | undefined"}},gridScale:{defaultValue:{value:"[1, 1]"},description:"",name:"gridScale",required:!1,type:{name:"Vec2 | undefined"}},background:{defaultValue:{value:"1056816"},description:"",name:"background",required:!1,type:{name:"string | number | Color | undefined"}},backgroundOpacity:{defaultValue:{value:"1"},description:"",name:"backgroundOpacity",required:!1,type:{name:"number | undefined"}},opacity:{defaultValue:{value:"1"},description:"",name:"opacity",required:!1,type:{name:"number | undefined"}},gridColorMajor:{defaultValue:{value:"#89a"},description:"",name:"gridColorMajor",required:!1,type:{name:"string | number | Color | undefined"}},gridColorMinor:{defaultValue:{value:"#789"},description:"",name:"gridColorMinor",required:!1,type:{name:"string | number | Color | undefined"}},gridLineWidth:{defaultValue:{value:"0.05"},description:"",name:"gridLineWidth",required:!1,type:{name:"number | undefined"}},showAxes:{defaultValue:{value:"true"},description:"",name:"showAxes",required:!1,type:{name:"boolean | undefined"}},showAxesLabels:{defaultValue:{value:"true"},description:"",name:"showAxesLabels",required:!1,type:{name:"boolean | undefined"}},trimAxesLabels:{defaultValue:{value:"false"},description:"",name:"trimAxesLabels",required:!1,type:{name:"boolean | undefined"}},axesOffset:{defaultValue:{value:"undefined"},description:"",name:"axesOffset",required:!1,type:{name:"Vec2 | undefined"}},axesColor:{defaultValue:{value:"#fff"},description:"",name:"axesColor",required:!1,type:{name:"string | number | Color | undefined"}},axesLineWidth:{defaultValue:{value:"(gridLineWidth || 0.05)"},description:"",name:"axesLineWidth",required:!1,type:{name:"number | undefined"}},axesTickSize:{defaultValue:{value:"0.1"},description:"",name:"axesTickSize",required:!1,type:{name:"number | undefined"}},originValue:{defaultValue:{value:"[0, 0,]"},description:"",name:"originValue",required:!1,type:{name:"Vec2 | undefined"}},radial:{defaultValue:{value:"false"},description:"",name:"radial",required:!1,type:{name:"boolean | undefined"}},dynamicSegments:{defaultValue:{value:"false"},description:"",name:"dynamicSegments",required:!1,type:{name:"boolean | undefined"}},showRulers:{defaultValue:{value:"false"},description:"",name:"showRulers",required:!1,type:{name:"boolean | undefined"}},rulerColor:{defaultValue:{value:"#c59797"},description:"",name:"rulerColor",required:!1,type:{name:"string | number | Color | undefined"}},rulerLineWidth:{defaultValue:{value:"1"},description:"",name:"rulerLineWidth",required:!1,type:{name:"number | undefined"}},rulerOpacity:{defaultValue:{value:"0.5"},description:"",name:"rulerOpacity",required:!1,type:{name:"number | undefined"}},planeOffset:{defaultValue:{value:"0"},description:"",name:"planeOffset",required:!1,type:{name:"number | undefined"}},dynamicCellSize:{defaultValue:{value:"false"},description:"",name:"dynamicCellSize",required:!1,type:{name:"boolean | undefined"}},cellSizeDistanceFactors:{defaultValue:{value:`[
  [0, 0.1],
  [2.5, 0.25],
  [5, 0.5],
  [10, 1],
  [25, 2.5],
  [50, 5],
  [100, 10],
  [250, 25],
  [500, 50],
  [999, 100]
]`},description:"",name:"cellSizeDistanceFactors",required:!1,type:{name:"number[][] | undefined"}},side:{defaultValue:{value:"both"},description:"",name:"side",required:!1,type:{name:'"front" | "back" | "both" | undefined'}},texture:{defaultValue:null,description:"",name:"texture",required:!1,type:{name:"Texture | undefined"}},textureMix:{defaultValue:{value:"1"},description:"",name:"textureMix",required:!1,type:{name:"number | undefined"}},enableProjection:{defaultValue:{value:"false"},description:"",name:"enableProjection",required:!1,type:{name:"boolean | undefined"}},projectionDistance:{defaultValue:{value:"1000"},description:"",name:"projectionDistance",required:!1,type:{name:"number | undefined"}},projectionColor:{defaultValue:{value:"#456"},description:"",name:"projectionColor",required:!1,type:{name:"string | number | Color | undefined"}},projectionResolution:{defaultValue:{value:"1024"},description:"",name:"projectionResolution",required:!1,type:{name:"number | undefined"}},projectionRefreshRate:{defaultValue:{value:"100"},description:"",name:"projectionRefreshRate",required:!1,type:{name:"number | undefined"}},onRulerUpdate:{defaultValue:{value:"null"},description:"",name:"onRulerUpdate",required:!1,type:{name:"((coords: Vec2 | null) => void) | null | undefined"}}}}}catch{}export{he as G};
