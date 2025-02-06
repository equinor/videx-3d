import{j as e}from"./jsx-runtime-CmIOflP4.js";import{u as ae,C as te}from"./canvas-3d-decorator-BhyssXtK.js";import{G as s}from"./Grid-Dwex0QcV.js";import{M as le,T as de}from"./CameraManager-BuezL_By.js";import{r as n}from"./index-KqYmeiyw.js";import"./numbers-DM6OWwIG.js";import"./Text-BN5iLNcs.js";const ue=n.forwardRef(({children:r,enabled:ee=!0,speed:a=1,rotationIntensity:z=1,floatIntensity:re=1,floatingRange:t=[-.1,.1],autoInvalidate:se=!1,...ie},ne)=>{const i=n.useRef(null);n.useImperativeHandle(ne,()=>i.current,[]);const oe=n.useRef(Math.random()*1e4);return ae(G=>{var f,b;if(!ee||a===0)return;se&&G.invalidate();const l=oe.current+G.clock.getElapsedTime();i.current.rotation.x=Math.cos(l/4*a)/8*z,i.current.rotation.y=Math.sin(l/4*a)/8*z,i.current.rotation.z=Math.sin(l/4*a)/20*z;let y=Math.sin(l/4*a)/10;y=le.mapLinear(y,-.1,.1,(f=t==null?void 0:t[0])!==null&&f!==void 0?f:-.1,(b=t==null?void 0:t[1])!==null&&b!==void 0?b:.1),i.current.position.y=y*re,i.current.updateMatrix()}),n.createElement("group",ie,n.createElement("group",{ref:i,matrixAutoUpdate:!1},r))}),o=({units:r=1})=>e.jsxs(e.Fragment,{children:[e.jsx("axesHelper",{args:[r]}),e.jsxs("mesh",{position:[350,0,-500],visible:!0,children:[e.jsx("sphereGeometry",{args:[10]}),e.jsx("meshStandardMaterial",{})]}),e.jsxs("mesh",{position:[-200,50,250],visible:!0,children:[e.jsx("boxGeometry",{args:[100,100,100]}),e.jsx("meshStandardMaterial",{})]})]}),Se={title:"Components/Grids/Grid",component:s,decorators:[te],parameters:{scale:100,cameraPosition:[150,1e3,500],cameraTarget:[0,0,0]},argTypes:{cellSize:{control:"select",options:[1,10,50,100,250,1e3]},subDivisions:{control:{type:"range",min:0,max:10,step:1}},rulerLineWidth:{control:{type:"range",min:0,max:5,step:.1}},gridLineWidth:{control:{type:"range",min:0,max:.5,step:.001}},planeOffset:{control:{type:"range",min:-100,max:100,step:1}},rulerOpacity:{control:{type:"range",min:0,max:1,step:.001}},opacity:{control:{type:"range",min:0,max:1,step:.001}}},tags:["autodocs"]},d={args:{plane:"xz",size:[1e3,1e3],cellSize:50,subDivisions:10,gridLineWidth:.01},render:r=>e.jsxs("group",{children:[e.jsx("group",{position:[0,0,0],children:e.jsx(s,{...r})}),e.jsx(o,{units:r.cellSize})]})},u={args:{plane:"xz",gridOrigin:[-250,300],size:[1e3,1e3],cellSize:50,subDivisions:10,gridLineWidth:.01},render:r=>e.jsxs("group",{children:[e.jsx("group",{position:[0,0,0],children:e.jsx(s,{...r})}),e.jsx(o,{units:r.cellSize})]})},c={args:{plane:"xz",size:[1e3,1e3],cellSize:50,subDivisions:10,gridLineWidth:.01,gridScale:[20,-1]},render:r=>e.jsxs("group",{children:[e.jsx("group",{position:[0,0,0],children:e.jsx(s,{...r})}),e.jsx(o,{units:r.cellSize})]})},p={args:{plane:"xz",size:[1e3,1e3],cellSize:10,subDivisions:10,gridLineWidth:.01,dynamicCellSize:!0,cellSizeDistanceFactors:[[0,.1],[2.5,.25],[5,.5],[10,1],[25,2.5],[50,5],[100,10],[250,25]]},render:r=>e.jsxs("group",{children:[e.jsx("group",{position:[0,0,0],children:e.jsx(s,{...r})}),e.jsx(o,{units:r.cellSize})]})},g={args:{plane:"xz",size:[1e3,1e3],cellSize:50,subDivisions:10,gridLineWidth:.01,showRulers:!0},render:r=>e.jsxs("group",{children:[e.jsx("group",{position:[0,0,0],children:e.jsx(s,{...r})}),e.jsx(o,{units:r.cellSize})]})},m={args:{plane:"xz",size:[1e3,1e3],background:"#05080a",cellSize:50,dynamicCellSize:!1,subDivisions:5,gridColorMajor:"#abc",gridColorMinor:"#789",gridLineWidth:.01,gridOrigin:[0,0],showAxes:!0,axesColor:"#fff",axesLineWidth:void 0,radial:!0,dynamicSegments:!1,gridScale:[1,1],showRulers:!1,rulerLineWidth:1,planeOffset:0,opacity:1,onRulerUpdate:null},render:r=>e.jsxs("group",{children:[e.jsx("group",{position:[0,0,0],children:e.jsx(s,{...r})}),e.jsxs("mesh",{position:[350,0,-500],visible:!0,children:[e.jsx("sphereGeometry",{args:[10]}),e.jsx("meshStandardMaterial",{})]}),e.jsxs("mesh",{position:[-200,50,250],visible:!0,children:[e.jsx("boxGeometry",{args:[100,100,100]}),e.jsx("meshStandardMaterial",{})]})]})},x={args:{plane:"xz",size:[1e3,1e3],background:"#05080a",cellSize:50,dynamicCellSize:!1,subDivisions:5,gridColorMajor:"#abc",gridColorMinor:"#789",gridLineWidth:.01,gridOrigin:[350,-500],showAxes:!0,axesColor:"#fff",axesLineWidth:void 0,radial:!0,dynamicSegments:!1,gridScale:[1,1],showRulers:!1,rulerLineWidth:1,planeOffset:0,opacity:1,onRulerUpdate:null},render:r=>e.jsxs("group",{children:[e.jsx("group",{position:[0,0,0],children:e.jsx(s,{...r})}),e.jsxs("mesh",{position:[350,0,-500],visible:!0,children:[e.jsx("sphereGeometry",{args:[10]}),e.jsx("meshStandardMaterial",{})]}),e.jsxs("mesh",{position:[-200,50,250],visible:!0,children:[e.jsx("boxGeometry",{args:[100,100,100]}),e.jsx("meshStandardMaterial",{})]})]})},h={args:{plane:"xz",size:[1e3,1e3],background:"#05080a",cellSize:50,dynamicCellSize:!1,subDivisions:5,gridColorMajor:"#abc",gridColorMinor:"#789",gridLineWidth:.01,gridOrigin:[0,0],showAxes:!0,axesColor:"#fff",axesLineWidth:void 0,radial:!0,dynamicSegments:!0,gridScale:[1,1],showRulers:!1,rulerLineWidth:1,planeOffset:0,opacity:1,onRulerUpdate:null},render:r=>e.jsxs("group",{children:[e.jsx("group",{position:[0,0,0],children:e.jsx(s,{...r})}),e.jsxs("mesh",{position:[350,0,-500],visible:!0,children:[e.jsx("sphereGeometry",{args:[10]}),e.jsx("meshStandardMaterial",{})]}),e.jsxs("mesh",{position:[-200,50,250],visible:!0,children:[e.jsx("boxGeometry",{args:[100,100,100]}),e.jsx("meshStandardMaterial",{})]})]})},j={args:{plane:"xz",texture:new de().load("old-paper.jpg"),size:[1e3,1e3],cellSize:50,subDivisions:10,gridLineWidth:.01,gridColorMajor:"#5e3b0a",gridColorMinor:"#4d3008",axesColor:"#000000",axesTickSize:.2,textureMix:.8},render:r=>e.jsxs("group",{children:[e.jsx("group",{position:[0,0,0],children:e.jsx(s,{...r})}),e.jsx(o,{units:r.cellSize})]})},S={args:{plane:"xz",size:[1e3,1e3],cellSize:50,subDivisions:10,gridLineWidth:.01,enableProjection:!0,projectionColor:"#789"},render:r=>e.jsxs("group",{children:[e.jsx("group",{position:[0,0,0],children:e.jsx(s,{...r})}),e.jsx("axesHelper",{args:[r.cellSize]}),e.jsxs("mesh",{position:[250,50,-400],visible:!0,children:[e.jsx("sphereGeometry",{args:[10]}),e.jsx("meshStandardMaterial",{})]}),e.jsx(ue,{floatingRange:[0,1e3],children:e.jsxs("mesh",{position:[-200,50,250],visible:!0,children:[e.jsx("boxGeometry",{args:[100,100,100]}),e.jsx("meshStandardMaterial",{})]})})]})};var M,v,C;d.parameters={...d.parameters,docs:{...(M=d.parameters)==null?void 0:M.docs,source:{originalSource:`{
  args: {
    plane: 'xz',
    size: [1000, 1000],
    cellSize: 50,
    subDivisions: 10,
    gridLineWidth: 0.01
  },
  render: (args: GridProps) => <group>\r
      <group position={[0, 0, 0]}>\r
        <Grid {...args} />\r
      </group>\r
      <GridObjects units={args.cellSize} />\r
    </group>
}`,...(C=(v=d.parameters)==null?void 0:v.docs)==null?void 0:C.source}}};var L,W,D;u.parameters={...u.parameters,docs:{...(L=u.parameters)==null?void 0:L.docs,source:{originalSource:`{
  args: {
    plane: 'xz',
    gridOrigin: [-250, 300],
    size: [1000, 1000],
    cellSize: 50,
    subDivisions: 10,
    gridLineWidth: 0.01
  },
  render: (args: GridProps) => <group>\r
      <group position={[0, 0, 0]}>\r
        <Grid {...args} />\r
      </group>\r
      <GridObjects units={args.cellSize} />\r
    </group>
}`,...(D=(W=u.parameters)==null?void 0:W.docs)==null?void 0:D.source}}};var O,R,w;c.parameters={...c.parameters,docs:{...(O=c.parameters)==null?void 0:O.docs,source:{originalSource:`{
  args: {
    plane: 'xz',
    size: [1000, 1000],
    cellSize: 50,
    subDivisions: 10,
    gridLineWidth: 0.01,
    gridScale: [20, -1]
  },
  render: (args: GridProps) => <group>\r
      <group position={[0, 0, 0]}>\r
        <Grid {...args} />\r
      </group>\r
      <GridObjects units={args.cellSize} />\r
    </group>
}`,...(w=(R=c.parameters)==null?void 0:R.docs)==null?void 0:w.source}}};var P,k,A;p.parameters={...p.parameters,docs:{...(P=p.parameters)==null?void 0:P.docs,source:{originalSource:`{
  args: {
    plane: 'xz',
    size: [1000, 1000],
    cellSize: 10,
    subDivisions: 10,
    gridLineWidth: 0.01,
    dynamicCellSize: true,
    cellSizeDistanceFactors: [[0, 0.1], [2.5, 0.25], [5, 0.5], [10, 1], [25, 2.5], [50, 5], [100, 10], [250, 25]]
  },
  render: (args: GridProps) => <group>\r
      <group position={[0, 0, 0]}>\r
        <Grid {...args} />\r
      </group>\r
      <GridObjects units={args.cellSize} />\r
    </group>
}`,...(A=(k=p.parameters)==null?void 0:k.docs)==null?void 0:A.source}}};var T,U,F;g.parameters={...g.parameters,docs:{...(T=g.parameters)==null?void 0:T.docs,source:{originalSource:`{
  args: {
    plane: 'xz',
    size: [1000, 1000],
    cellSize: 50,
    subDivisions: 10,
    gridLineWidth: 0.01,
    showRulers: true
  },
  render: (args: GridProps) => <group>\r
      <group position={[0, 0, 0]}>\r
        <Grid {...args} />\r
      </group>\r
      <GridObjects units={args.cellSize} />\r
    </group>
}`,...(F=(U=g.parameters)==null?void 0:U.docs)==null?void 0:F.source}}};var E,H,_;m.parameters={...m.parameters,docs:{...(E=m.parameters)==null?void 0:E.docs,source:{originalSource:`{
  args: {
    plane: 'xz',
    size: [1000, 1000],
    background: "#05080a",
    cellSize: 50,
    dynamicCellSize: false,
    subDivisions: 5,
    gridColorMajor: "#abc",
    gridColorMinor: "#789",
    gridLineWidth: 0.01,
    gridOrigin: [0, 0],
    showAxes: true,
    axesColor: "#fff",
    axesLineWidth: undefined,
    radial: true,
    dynamicSegments: false,
    gridScale: [1, 1],
    showRulers: false,
    rulerLineWidth: 1,
    planeOffset: 0,
    opacity: 1,
    onRulerUpdate: null
  },
  render: (args: GridProps) => <group>\r
      <group position={[0, 0, 0]}>\r
        <Grid {...args} />\r
      </group>\r
      <mesh position={[350, 0, -500]} visible={true}>\r
        <sphereGeometry args={[10]} />\r
        <meshStandardMaterial />\r
      </mesh>\r
      <mesh position={[-200, 50, 250]} visible={true}>\r
        <boxGeometry args={[100, 100, 100]} />\r
        <meshStandardMaterial />\r
      </mesh>\r
    </group>
}`,...(_=(H=m.parameters)==null?void 0:H.docs)==null?void 0:_.source}}};var $,q,B;x.parameters={...x.parameters,docs:{...($=x.parameters)==null?void 0:$.docs,source:{originalSource:`{
  args: {
    plane: 'xz',
    size: [1000, 1000],
    background: "#05080a",
    cellSize: 50,
    dynamicCellSize: false,
    subDivisions: 5,
    gridColorMajor: "#abc",
    gridColorMinor: "#789",
    gridLineWidth: 0.01,
    gridOrigin: [350, -500],
    showAxes: true,
    axesColor: "#fff",
    axesLineWidth: undefined,
    radial: true,
    dynamicSegments: false,
    gridScale: [1, 1],
    showRulers: false,
    rulerLineWidth: 1,
    planeOffset: 0,
    opacity: 1,
    onRulerUpdate: null
  },
  render: (args: GridProps) => <group>\r
      <group position={[0, 0, 0]}>\r
        <Grid {...args} />\r
      </group>\r
      <mesh position={[350, 0, -500]} visible={true}>\r
        <sphereGeometry args={[10]} />\r
        <meshStandardMaterial />\r
      </mesh>\r
      <mesh position={[-200, 50, 250]} visible={true}>\r
        <boxGeometry args={[100, 100, 100]} />\r
        <meshStandardMaterial />\r
      </mesh>\r
    </group>
}`,...(B=(q=x.parameters)==null?void 0:q.docs)==null?void 0:B.source}}};var J,K,N;h.parameters={...h.parameters,docs:{...(J=h.parameters)==null?void 0:J.docs,source:{originalSource:`{
  args: {
    plane: 'xz',
    size: [1000, 1000],
    background: "#05080a",
    cellSize: 50,
    dynamicCellSize: false,
    subDivisions: 5,
    gridColorMajor: "#abc",
    gridColorMinor: "#789",
    gridLineWidth: 0.01,
    gridOrigin: [0, 0],
    showAxes: true,
    axesColor: "#fff",
    axesLineWidth: undefined,
    radial: true,
    dynamicSegments: true,
    gridScale: [1, 1],
    showRulers: false,
    rulerLineWidth: 1,
    planeOffset: 0,
    opacity: 1,
    onRulerUpdate: null
  },
  render: (args: GridProps) => <group>\r
      <group position={[0, 0, 0]}>\r
        <Grid {...args} />\r
      </group>\r
      <mesh position={[350, 0, -500]} visible={true}>\r
        <sphereGeometry args={[10]} />\r
        <meshStandardMaterial />\r
      </mesh>\r
      <mesh position={[-200, 50, 250]} visible={true}>\r
        <boxGeometry args={[100, 100, 100]} />\r
        <meshStandardMaterial />\r
      </mesh>\r
    </group>
}`,...(N=(K=h.parameters)==null?void 0:K.docs)==null?void 0:N.source}}};var Q,V,X;j.parameters={...j.parameters,docs:{...(Q=j.parameters)==null?void 0:Q.docs,source:{originalSource:`{
  args: {
    plane: 'xz',
    texture: new TextureLoader().load('old-paper.jpg'),
    size: [1000, 1000],
    cellSize: 50,
    subDivisions: 10,
    gridLineWidth: 0.01,
    gridColorMajor: '#5e3b0a',
    gridColorMinor: '#4d3008',
    axesColor: '#000000',
    axesTickSize: 0.2,
    textureMix: 0.8
  },
  render: (args: GridProps) => <group>\r
      <group position={[0, 0, 0]}>\r
        <Grid {...args} />\r
      </group>\r
      <GridObjects units={args.cellSize} />\r
    </group>
}`,...(X=(V=j.parameters)==null?void 0:V.docs)==null?void 0:X.source}}};var Y,Z,I;S.parameters={...S.parameters,docs:{...(Y=S.parameters)==null?void 0:Y.docs,source:{originalSource:`{
  args: {
    plane: 'xz',
    size: [1000, 1000],
    cellSize: 50,
    subDivisions: 10,
    gridLineWidth: 0.01,
    enableProjection: true,
    projectionColor: '#789'
  },
  render: (args: GridProps) => <group>\r
      <group position={[0, 0, 0]}>\r
        <Grid {...args} />\r
      </group>\r
      <axesHelper args={[args.cellSize]} />\r
      <mesh position={[250, 50, -400]} visible={true}>\r
        <sphereGeometry args={[10]} />\r
        <meshStandardMaterial />\r
      </mesh>\r
      <Float floatingRange={[0, 1000]}>\r
        <mesh position={[-200, 50, 250]} visible={true}>\r
          <boxGeometry args={[100, 100, 100]} />\r
          <meshStandardMaterial />\r
        </mesh>\r
      </Float>\r
    </group>
}`,...(I=(Z=S.parameters)==null?void 0:Z.docs)==null?void 0:I.source}}};const ze=["Default","OriginOffset","ScaledAxes","Dynamic","Rulers","Radial","RadialOffset","RadialDynamicSegments","Customized","Projections"];export{j as Customized,d as Default,p as Dynamic,u as OriginOffset,S as Projections,m as Radial,h as RadialDynamicSegments,x as RadialOffset,g as Rulers,c as ScaledAxes,ze as __namedExportsOrder,Se as default};
