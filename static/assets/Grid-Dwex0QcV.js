import{j as V}from"./jsx-runtime-CmIOflP4.js";import{V as ue,c as O,h as Le,P as Se,U as a,i as J,j as ke,D as Pe,F as De,R as Re,W as Te,k as pe,H as je}from"./CameraManager-BuezL_By.js";import{r as l}from"./index-KqYmeiyw.js";import{c as Ge}from"./numbers-DM6OWwIG.js";import{u as _e,a as ze}from"./canvas-3d-decorator-BhyssXtK.js";import{T as xe}from"./Text-BN5iLNcs.js";var Ie=`#include <common>
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
}`,Ue=`precision highp float;

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
  
  vec2 originOffset = uOriginOffset / uCellSize; 
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

  
  
}`;const h=new ue,oe=({scale:r,start:u,size:v,units:e,originOffset:o,axesOffset:m,axesTickSize:w,plane:g,color:W,side:b,trimAxesLabels:y=!1,renderOrder:P=2})=>{const[c,z]=l.useState({x:0,y:0,flipped:!1});_e(({camera:d})=>{d.getWorldDirection(h);const i={x:0,y:0,flipped:!1};g==="xz"?(i.flipped=h.y>0,i.flipped?(i.x=h.z<0?Math.PI:0,i.y=h.x<0?Math.PI:0):(i.x=h.z>0?Math.PI:0,i.y=h.x>0?Math.PI:0)):g==="xy"?(i.flipped=h.z>0,i.x=0,i.y=h.x>0?Math.PI:0):g==="zy"&&(i.flipped=h.x>0,i.x=0,i.y=h.z<0?Math.PI:0),(c.x!==i.x||c.y!==i.y||c.flipped!==i.flipped)&&z(i)});const M=l.useMemo(()=>e/7.5,[e]),F=l.useMemo(()=>new O(W||"#fff"),[W]),x=l.useMemo(()=>{const d=[v[0]*.5,v[1]*.5],i=[d[0]+o[0],d[1]+o[1]],D=[i[0]+m[0],i[1]+m[1]],N=[Math.floor((i[0]-i[0]%e)/e),Math.floor((i[1]-i[1]%e)/e)],I=[-d[0]+i[0]%e,-d[1]+i[1]%e],U=[Math.min(1e3,Math.floor((v[0]-i[0]%e)/e)+1),Math.min(1e3,Math.floor((v[1]-i[1]%e)/e)+1)],q=[],E=[];for(let p=y?1:0;p<U[0]-(y?1:0);p++){const A=[I[0]+p*e,m[1]+o[1]+w*e+M*.6],C=Math.round(10*(u[0]+(p-N[0])*e*r[0]))/10;Math.abs(D[0]-(A[0]+d[0]))>e/4&&q.push({pos:A,value:C,index:`x${p}`})}for(let p=y?1:0;p<U[1]-(y?1:0);p++){const A=[m[0]+o[0]-w*e-M*.6,I[1]+p*e],C=Math.round(10*(u[1]+(p-N[1])*e*r[1]))/10;Math.abs(D[1]-(A[1]+d[1]))>e/4&&E.push({pos:A,value:C,index:`y${p}`})}return{xAxis:q,yAxis:E}},[v,e,o,m,w,M,r,u,y]);return V.jsxs("group",{renderOrder:P,position:[0,0,(c.flipped?-1:1)*(e/1e3)],visible:b==="both"||b==="front"&&!c.flipped||b==="back"&&c.flipped,children:[x.xAxis.map(d=>V.jsx(xe,{characters:"123456789,.0",position:[...d.pos,0],fontSize:M,textAlign:"center",anchorX:"center",anchorY:"middle","rotation-z":c.x,"rotation-y":c.flipped?Math.PI:0,color:F,"material-depthWrite":!1,children:d.value},d.index)),x.yAxis.map(d=>V.jsx(xe,{characters:"123456789,.0",position:[...d.pos,0],fontSize:M,textAlign:"center",anchorX:"center",anchorY:"middle","rotation-z":c.y+Math.PI/2,"rotation-x":c.flipped?Math.PI:0,color:F,"material-depthWrite":!1,children:d.value},d.index))]})};try{oe.displayName="GridAxesLabels",oe.__docgenInfo={description:"Adds grid axes and labels to a `Grid` component. Used internally by the `Grid` component.",displayName:"GridAxesLabels",props:{scale:{defaultValue:null,description:"",name:"scale",required:!0,type:{name:"Vec2"}},units:{defaultValue:null,description:"",name:"units",required:!0,type:{name:"number"}},start:{defaultValue:null,description:"",name:"start",required:!0,type:{name:"Vec2"}},originOffset:{defaultValue:null,description:"",name:"originOffset",required:!0,type:{name:"Vec2"}},size:{defaultValue:null,description:"",name:"size",required:!0,type:{name:"Vec2"}},axesTickSize:{defaultValue:null,description:"",name:"axesTickSize",required:!0,type:{name:"number"}},plane:{defaultValue:null,description:"",name:"plane",required:!0,type:{name:'"xz" | "xy" | "zy"'}},color:{defaultValue:null,description:"",name:"color",required:!1,type:{name:"string | number | Color | undefined"}},side:{defaultValue:null,description:"",name:"side",required:!1,type:{name:'"front" | "back" | "both" | undefined'}},axesOffset:{defaultValue:null,description:"",name:"axesOffset",required:!0,type:{name:"Vec2"}},trimAxesLabels:{defaultValue:{value:"false"},description:"",name:"trimAxesLabels",required:!1,type:{name:"boolean"}},renderOrder:{defaultValue:{value:"2"},description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}}}}}catch{}const Ee=(r,u,v,e,o)=>{const m=v[0]*.5,w=v[1]*.5,[g,W]=o,b=r*v[0],y=u*v[1],P=(b-(m+g))*e[0],c=(y-(w+W))*e[1];return[P,c]},Fe=new Le,Ne=[[0,.1],[2.5,.25],[5,.5],[10,1],[25,2.5],[50,5],[100,10],[250,25],[500,50],[999,100]],ye=({plane:r,size:u,position:v=[0,0,0],gridOrigin:e,gridScale:o=[1,1],cellSize:m=10,subDivisions:w=0,background:g=1056816,backgroundOpacity:W=1,opacity:b=1,gridColorMajor:y="#89a",gridColorMinor:P="#789",gridLineWidth:c=.05,showAxes:z=!0,showAxesLabels:M=!0,trimAxesLabels:F=!1,axesOffset:x=void 0,axesColor:d="#fff",axesLineWidth:i=c||.05,axesTickSize:D=.1,originValue:N=[0,0],radial:I=!1,dynamicSegments:U=!1,showRulers:q=!1,rulerColor:E="#c59797",rulerLineWidth:p=1,rulerOpacity:A=.5,planeOffset:C=0,dynamicCellSize:le=!1,cellSizeDistanceFactors:B=Ne,side:R="both",onRulerUpdate:T=null,texture:de,textureMix:se=1,enableProjection:K=!1,projectionDistance:Q=1e3,projectionColor:fe="#456",projectionResolution:Z=1024,projectionRefreshRate:ce=100,name:he,userData:ge,renderOrder:X,visible:be,castShadow:Ve,receiveShadow:we,layers:Ae})=>{const[L,Ce]=l.useState({originOffset:[0,0],axesOffset:[0,0]}),[ee,ve]=l.useState(1),S=l.useMemo(()=>new Se,[]),k=l.useRef(null),ne=l.useRef(null),ie=l.useRef(null),t=l.useRef({uSize:new a(new J(0,0)),uBackground:new a(new O(1056816)),uBackgroundOpacity:new a(1),uOpacity:new a(1),uCellSize:new a(10),uSubDivisions:new a(0),uOriginOffset:new a(new J(0,0)),uDistanceFactor:new a(0),uGridColorMajor:new a(new O("#abc")),uGridColorMinor:new a(new O("#789")),uGridLineWidth:new a(.05),uAxesOffset:new a(new J(0,0)),uAxesColor:new a(new O("#fff")),uAxesLineWidth:new a(1),uAxesTickSize:new a(.1),uCursorPosition:new a(new J),uRulerColor:new a(new O("#fff")),uRulerLineWidth:new a(1),uRulerOpacity:new a(.5),uProjectionTexture:new a(void 0),uProjectionColor:new a(new O("#456")),uTexture:new a(void 0),uTextureMix:new a(1)}),{controls:j,camera:re,gl:G,scene:Y}=ze(),Oe=l.useMemo(()=>[(r==="zy"?C:0)+v[0],(r==="xz"?C:0)+v[1],(r==="xy"?C:0)+v[2]],[r,C,v]),te=l.useMemo(()=>r==="xz"?[o[0],-o[1]]:r==="zy"?[-o[0],o[1]]:[...o],[o,r]),We=l.useMemo(()=>R==="back"?ke:R==="both"?Pe:De,[R]);l.useEffect(()=>{const s=k.current;if(s){const f=new ue;s.getWorldPosition(f);const n={axesOffset:[0,0],originOffset:[0,0]};e?r==="xz"?(n.originOffset[0]=e[0]-f.x,n.originOffset[1]=-(e[1]-f.z)):r==="xy"?(n.originOffset[0]=e[0]-f.x,n.originOffset[1]=e[1]-f.y):r==="zy"&&(n.originOffset[0]=-(e[0]-f.z),n.originOffset[1]=e[1]-f.y):(n.originOffset[0]=0,n.originOffset[1]=0),x?r==="xz"?(n.axesOffset[0]=x[0]*o[0]-n.originOffset[0],n.axesOffset[1]=-x[1]*o[1]-n.originOffset[1]):r==="xy"?(n.axesOffset[0]=x[0]*o[0]-n.originOffset[0],n.axesOffset[1]=x[1]*o[1]-n.originOffset[1]):r==="zy"&&(n.axesOffset[0]=-x[0]*o[0]-n.originOffset[0],n.axesOffset[1]=x[1]*o[1]-n.originOffset[1]):(n.axesOffset[0]=0,n.axesOffset[1]=0),r==="xz"?S.normal.set(0,1,0):r==="xy"?S.normal.set(0,0,1):r==="zy"&&S.normal.set(1,0,0),S.constant=f.length(),Ce(n)}},[r,e,x,o,S]),l.useEffect(()=>{t.current.uBackground.value=new O(g??7368816),t.current.uBackgroundOpacity.value=W,t.current.uSize.value.set(...u),t.current.uOpacity.value=Number.isFinite(b)?Ge(b,0,1):1,t.current.uCellSize.value=m*ee,t.current.uSubDivisions.value=w,t.current.uGridColorMajor.value.set(y),t.current.uGridColorMinor.value.set(P),t.current.uGridLineWidth.value=c,t.current.uAxesLineWidth.value=i,t.current.uAxesColor.value.set(d),t.current.uAxesTickSize.value=D,t.current.uAxesOffset.value.set(...L.axesOffset),t.current.uOriginOffset.value.set(...L.originOffset),t.current.uRulerLineWidth.value=p,t.current.uRulerColor.value.set(E),t.current.uRulerOpacity.value=A,t.current.uTexture.value=de,t.current.uTextureMix.value=se,t.current.uProjectionColor.value.set(fe)},[u,m,ee,w,g,W,b,y,P,d,i,D,c,E,p,A,L,de,se,fe]),l.useEffect(()=>{const s=new ue,f=new Re;function n(){if(k.current){re.getWorldDirection(s),f.set(re.position,s);const H=f.distanceToPlane(S);if(H){const ae=Math.min(H,1e3*m)/m;let _=B.findIndex($=>$[0]>=ae);_===-1?_=B.length-1:_--,_=Math.max(0,_);const me=B[_][1];ve($=>$!==me?me:$)}}}return k.current&&j&&le?(j.addEventListener("update",n),n()):ve(1),()=>{j==null||j.removeEventListener("update",n)}},[j,re,S,le,m,B,u]),l.useEffect(()=>{ne.current&&(ne.current.needsUpdate=!0)},[I,z,U,q]),l.useEffect(()=>{let s=null,f=null;return K&&(s=new Te(Z,Z,{minFilter:pe,magFilter:pe,type:je}),t.current.uProjectionTexture.value=s.texture,f=setInterval(()=>{if(s&&k.current&&ie.current){const H=ie.current,ae=G.getRenderTarget();G.setRenderTarget(s),Y.overrideMaterial=Fe,k.current.visible=!1,G.clear(),G.render(Y,H),Y.overrideMaterial=null,G.setRenderTarget(ae),k.current.visible=!0}},ce)),()=>{f&&clearInterval(f),s==null||s.dispose()}},[K,G,Y,u,Q,Z,ce]);const Me=l.useCallback(s=>{var f,n;t.current.uCursorPosition.value.set(((f=s.uv)==null?void 0:f.x)||0,((n=s.uv)==null?void 0:n.y)||0),T&&s.uv&&T(Ee(s.uv.x,s.uv.y,u,te,L.originOffset))},[u,te,L.originOffset,T]),qe=l.useCallback(()=>{t.current.uCursorPosition.value.set(0,0),T&&T(null)},[T]);return V.jsxs("group",{ref:k,name:he,userData:ge,visible:be,"rotation-x":r==="xz"?-Math.PI/2:0,"rotation-y":r==="zy"?Math.PI/2:0,position:Oe,renderOrder:X,children:[V.jsxs("mesh",{"position-z":-.001*m,onPointerMove:q?Me:void 0,onPointerLeave:q?qe:void 0,renderOrder:1,castShadow:Ve,receiveShadow:we,layers:Ae,children:[V.jsx("planeGeometry",{args:u}),V.jsx("shaderMaterial",{ref:ne,uniforms:t.current,defines:{RADIAL:I,DYNAMICSEGMENTS:U,AXES:!!z,RULERS:!!q,SATURATE:!0},vertexShader:Ie,fragmentShader:Ue,side:We,depthWrite:!0,depthTest:!0,forceSinglePass:!0,transparent:!0}),z&&M&&V.jsx(oe,{originOffset:L.originOffset,axesOffset:L.axesOffset,trimAxesLabels:F,scale:te,size:u,start:N,units:m*ee,axesTickSize:D,plane:r,color:d,side:R,renderOrder:X!==void 0&&Number.isFinite(X)?X+1:void 0})]}),K&&V.jsx("orthographicCamera",{ref:ie,args:R==="back"?[u[0]/2,u[0]/-2,u[1]/2,u[1]/-2,1,Q]:[u[0]/-2,u[0]/2,u[1]/2,u[1]/-2,1,Q],"rotation-y":R==="back"?0:Math.PI})]})};try{ye.displayName="Grid",ye.__docgenInfo={description:"Renders an axis aligned grid plane (xz, xy or zy).",displayName:"Grid",props:{name:{defaultValue:null,description:"",name:"name",required:!1,type:{name:"string | undefined"}},visible:{defaultValue:null,description:"",name:"visible",required:!1,type:{name:"boolean | undefined"}},userData:{defaultValue:null,description:"",name:"userData",required:!1,type:{name:"Record<string, any> | undefined"}},position:{defaultValue:{value:"[0, 0, 0]"},description:"",name:"position",required:!1,type:{name:"Vec3 | undefined"}},castShadow:{defaultValue:null,description:"",name:"castShadow",required:!1,type:{name:"boolean | undefined"}},receiveShadow:{defaultValue:null,description:"",name:"receiveShadow",required:!1,type:{name:"boolean | undefined"}},renderOrder:{defaultValue:null,description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}},layers:{defaultValue:null,description:"",name:"layers",required:!1,type:{name:"Layers | undefined"}},plane:{defaultValue:null,description:"",name:"plane",required:!0,type:{name:'"xz" | "xy" | "zy"'}},size:{defaultValue:null,description:"",name:"size",required:!0,type:{name:"Vec2"}},cellSize:{defaultValue:{value:"10"},description:"",name:"cellSize",required:!1,type:{name:"number | undefined"}},subDivisions:{defaultValue:{value:"0"},description:"",name:"subDivisions",required:!1,type:{name:"number | undefined"}},gridOrigin:{defaultValue:null,description:"",name:"gridOrigin",required:!1,type:{name:"Vec2 | undefined"}},gridScale:{defaultValue:{value:"[1, 1]"},description:"",name:"gridScale",required:!1,type:{name:"Vec2 | undefined"}},background:{defaultValue:{value:"1056816"},description:"",name:"background",required:!1,type:{name:"string | number | Color | undefined"}},backgroundOpacity:{defaultValue:{value:"1"},description:"",name:"backgroundOpacity",required:!1,type:{name:"number | undefined"}},opacity:{defaultValue:{value:"1"},description:"",name:"opacity",required:!1,type:{name:"number | undefined"}},gridColorMajor:{defaultValue:{value:"#89a"},description:"",name:"gridColorMajor",required:!1,type:{name:"string | number | Color | undefined"}},gridColorMinor:{defaultValue:{value:"#789"},description:"",name:"gridColorMinor",required:!1,type:{name:"string | number | Color | undefined"}},gridLineWidth:{defaultValue:{value:"0.05"},description:"",name:"gridLineWidth",required:!1,type:{name:"number | undefined"}},showAxes:{defaultValue:{value:"true"},description:"",name:"showAxes",required:!1,type:{name:"boolean | undefined"}},showAxesLabels:{defaultValue:{value:"true"},description:"",name:"showAxesLabels",required:!1,type:{name:"boolean | undefined"}},trimAxesLabels:{defaultValue:{value:"false"},description:"",name:"trimAxesLabels",required:!1,type:{name:"boolean | undefined"}},axesOffset:{defaultValue:{value:"undefined"},description:"",name:"axesOffset",required:!1,type:{name:"Vec2 | undefined"}},axesColor:{defaultValue:{value:"#fff"},description:"",name:"axesColor",required:!1,type:{name:"string | number | Color | undefined"}},axesLineWidth:{defaultValue:{value:"(gridLineWidth || 0.05)"},description:"",name:"axesLineWidth",required:!1,type:{name:"number | undefined"}},axesTickSize:{defaultValue:{value:"0.1"},description:"",name:"axesTickSize",required:!1,type:{name:"number | undefined"}},originValue:{defaultValue:{value:"[0, 0,]"},description:"",name:"originValue",required:!1,type:{name:"Vec2 | undefined"}},radial:{defaultValue:{value:"false"},description:"",name:"radial",required:!1,type:{name:"boolean | undefined"}},dynamicSegments:{defaultValue:{value:"false"},description:"",name:"dynamicSegments",required:!1,type:{name:"boolean | undefined"}},showRulers:{defaultValue:{value:"false"},description:"",name:"showRulers",required:!1,type:{name:"boolean | undefined"}},rulerColor:{defaultValue:{value:"#c59797"},description:"",name:"rulerColor",required:!1,type:{name:"string | number | Color | undefined"}},rulerLineWidth:{defaultValue:{value:"1"},description:"",name:"rulerLineWidth",required:!1,type:{name:"number | undefined"}},rulerOpacity:{defaultValue:{value:"0.5"},description:"",name:"rulerOpacity",required:!1,type:{name:"number | undefined"}},planeOffset:{defaultValue:{value:"0"},description:"",name:"planeOffset",required:!1,type:{name:"number | undefined"}},dynamicCellSize:{defaultValue:{value:"false"},description:"",name:"dynamicCellSize",required:!1,type:{name:"boolean | undefined"}},cellSizeDistanceFactors:{defaultValue:{value:`[
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
]`},description:"",name:"cellSizeDistanceFactors",required:!1,type:{name:"number[][] | undefined"}},side:{defaultValue:{value:"both"},description:"",name:"side",required:!1,type:{name:'"front" | "back" | "both" | undefined'}},texture:{defaultValue:null,description:"",name:"texture",required:!1,type:{name:"Texture | undefined"}},textureMix:{defaultValue:{value:"1"},description:"",name:"textureMix",required:!1,type:{name:"number | undefined"}},enableProjection:{defaultValue:{value:"false"},description:"",name:"enableProjection",required:!1,type:{name:"boolean | undefined"}},projectionDistance:{defaultValue:{value:"1000"},description:"",name:"projectionDistance",required:!1,type:{name:"number | undefined"}},projectionColor:{defaultValue:{value:"#456"},description:"",name:"projectionColor",required:!1,type:{name:"string | number | Color | undefined"}},projectionResolution:{defaultValue:{value:"1024"},description:"",name:"projectionResolution",required:!1,type:{name:"number | undefined"}},projectionRefreshRate:{defaultValue:{value:"100"},description:"",name:"projectionRefreshRate",required:!1,type:{name:"number | undefined"}},onRulerUpdate:{defaultValue:{value:"null"},description:"",name:"onRulerUpdate",required:!1,type:{name:"((coords: Vec2 | null) => void) | null | undefined"}}}}}catch{}export{ye as G};
