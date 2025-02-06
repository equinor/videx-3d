import{j as e}from"./jsx-runtime-CmIOflP4.js";import{C as g}from"./canvas-3d-decorator-BhyssXtK.js";import{B as i}from"./BoxGrid-Cpsp9mxT.js";import{G as z,W as x,a as j}from"./generators-provider-decorator-C-zBAaMo.js";import{D as S}from"./data-provider-decorator-BF4MaAx0.js";import{B as b}from"./BasicTrajectory-BNR446RI.js";import{C}from"./Casings-on--jxdC.js";import{C as h}from"./CompletionTools-C83-GUh6.js";import{r as s}from"./index-KqYmeiyw.js";import{D as P}from"./depth-selector-decorator-BJdWELUm.js";import{u as D}from"./useWellboreHeaders-7DqYhevo.js";import{s as w}from"./story-args-Cgt5gSNS.js";import"./CameraManager-BuezL_By.js";import"./Grid-Dwex0QcV.js";import"./numbers-DM6OWwIG.js";import"./Text-BN5iLNcs.js";import"./curve-3d-B0j10gmN.js";import"./index.esm-BMr5xbKZ.js";import"./useWellboreContext-DkvsaS95.js";import"./limiter-DhBcc_yH.js";import"./layers-DoaKWXpU.js";const R=w.defaultWellbore,Q={title:"Components/Grids/BoxGrid",component:i,decorators:[g,z,P,S],parameters:{scale:100,cameraPosition:[150,2e3,1500],cameraTarget:[0,0,0]},render:u=>{const t=D(),r=s.useMemo(()=>t.find(f=>f.id===R),[t]);return s.useEffect(()=>{r&&dispatchEvent(new x({id:r.id}))},[r]),r?e.jsxs("group",{children:[e.jsx("group",{position:[0,0,0],children:e.jsx(i,{...u,children:e.jsxs(j,{id:r.id,children:[e.jsx(b,{}),e.jsx(C,{shoeFactor:1.5,opacity:.5,sizeMultiplier:20}),e.jsx(h,{sizeMultiplier:20})]})})}),e.jsx("axesHelper",{args:[100]})]}):e.jsx(e.Fragment,{children:"No wellbore found!"})}},o={args:{size:[0,0,0],gridOrigin:[0,0,0],cellSize:250,enableProjection:!0,showRulers:!1,autoSize:!0,autoSizePadding:{x0:1e3,x1:1e3,z0:1e3,z1:1e3,y0:500,y1:0},autoSizeUpdateRate:100},tags:["autodocs"]},a={args:{size:[0,0,0],gridOrigin:[0,0,0],cellSize:250,gridColorMajor:"#ddd",gridColorMinor:"#eee",background:"#fff",axesColor:"#555",enableProjection:!0,projectionColor:"#f7f7f7",showRulers:!1,autoSize:!0,autoSizePadding:[2e3,0,2e3],autoSizeUpdateRate:100},parameters:{background:"#eee"}};var n,d,l;o.parameters={...o.parameters,docs:{...(n=o.parameters)==null?void 0:n.docs,source:{originalSource:`{
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
}`,...(p=(m=a.parameters)==null?void 0:m.docs)==null?void 0:p.source}}};const V=["Default","Light"];export{o as Default,a as Light,V as __namedExportsOrder,Q as default};
