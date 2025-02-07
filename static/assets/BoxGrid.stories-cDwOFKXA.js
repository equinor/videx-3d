import{j as e}from"./jsx-runtime-CmIOflP4.js";import{r as s}from"./index-KqYmeiyw.js";import{G as g,W as z,a as x}from"./generators-provider-decorator-BR7wOsTW.js";import{C as j}from"./canvas-3d-decorator-DXFES1_8.js";import{D as S}from"./data-provider-decorator-BCAx_xlJ.js";import{D as b}from"./depth-selector-decorator-HkEHPqzE.js";import{u as C}from"./useWellboreHeaders-GXAtugLG.js";import{s as h}from"./story-args-Cgt5gSNS.js";import{B as P}from"./BasicTrajectory-2wYFDS2o.js";import{C as D}from"./Casings--iVSCNOQ.js";import{C as w}from"./CompletionTools-DpgMl0yI.js";import{B as i}from"./BoxGrid-tOa6TNv3.js";import"./CameraManager-BTlj_2qD.js";import"./curve-3d-BSYPmKD_.js";import"./numbers-DM6OWwIG.js";import"./useWellboreContext-l1cQXUDV.js";import"./limiter-DhBcc_yH.js";import"./uv-material-Cw8kPkQB.js";import"./Grid-BX9uDT_-.js";import"./Text-DbK8u8Ip.js";const R=h.defaultWellbore,K={title:"Components/Grids/BoxGrid",component:i,decorators:[j,g,b,S],parameters:{scale:100,cameraPosition:[150,2e3,1500],cameraTarget:[0,0,0]},render:u=>{const t=C(),r=s.useMemo(()=>t.find(f=>f.id===R),[t]);return s.useEffect(()=>{r&&dispatchEvent(new z({id:r.id}))},[r]),r?e.jsxs("group",{children:[e.jsx("group",{position:[0,0,0],children:e.jsx(i,{...u,children:e.jsxs(x,{id:r.id,children:[e.jsx(P,{}),e.jsx(D,{shoeFactor:1.5,opacity:.5,sizeMultiplier:20}),e.jsx(w,{sizeMultiplier:20})]})})}),e.jsx("axesHelper",{args:[100]})]}):e.jsx(e.Fragment,{children:"No wellbore found!"})}},o={args:{size:[0,0,0],gridOrigin:[0,0,0],cellSize:250,enableProjection:!0,showRulers:!1,autoSize:!0,autoSizePadding:{x0:1e3,x1:1e3,z0:1e3,z1:1e3,y0:500,y1:0},autoSizeUpdateRate:100},tags:["autodocs"]},a={args:{size:[0,0,0],gridOrigin:[0,0,0],cellSize:250,gridColorMajor:"#ddd",gridColorMinor:"#eee",background:"#fff",axesColor:"#555",enableProjection:!0,projectionColor:"#f7f7f7",showRulers:!1,autoSize:!0,autoSizePadding:[2e3,0,2e3],autoSizeUpdateRate:100},parameters:{background:"#eee"}};var n,d,l;o.parameters={...o.parameters,docs:{...(n=o.parameters)==null?void 0:n.docs,source:{originalSource:`{
  args: {
    size: [0, 0, 0],
    gridOrigin: [0, 0, 0],
    cellSize: 250,
    enableProjection: true,
    showRulers: false,
    autoSize: true,
    autoSizePadding: {
      x0: 1000,
      x1: 1000,
      z0: 1000,
      z1: 1000,
      y0: 500,
      y1: 0
    },
    autoSizeUpdateRate: 100
  },
  tags: ['autodocs']
}`,...(l=(d=o.parameters)==null?void 0:d.docs)==null?void 0:l.source}}};var c,m,p;a.parameters={...a.parameters,docs:{...(c=a.parameters)==null?void 0:c.docs,source:{originalSource:`{
  args: {
    size: [0, 0, 0],
    gridOrigin: [0, 0, 0],
    cellSize: 250,
    gridColorMajor: "#ddd",
    gridColorMinor: "#eee",
    background: "#fff",
    axesColor: "#555",
    enableProjection: true,
    projectionColor: "#f7f7f7",
    showRulers: false,
    autoSize: true,
    autoSizePadding: [2000, 0, 2000],
    autoSizeUpdateRate: 100
  },
  parameters: {
    background: '#eee'
  }
}`,...(p=(m=a.parameters)==null?void 0:m.docs)==null?void 0:p.source}}};const Q=["Default","Light"];export{o as Default,a as Light,Q as __namedExportsOrder,K as default};
