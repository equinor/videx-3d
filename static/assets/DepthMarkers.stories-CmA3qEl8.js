import{j as r}from"./jsx-runtime-CmIOflP4.js";import{G as p,W as l,a as m}from"./generators-provider-decorator-C-zBAaMo.js";import{r as d}from"./index-KqYmeiyw.js";import{D as f}from"./data-provider-decorator-BF4MaAx0.js";import{C as D}from"./canvas-3d-decorator-BhyssXtK.js";import{P as b}from"./performance-decorator-C0S1r9nP.js";import{D as u}from"./depth-selector-decorator-BJdWELUm.js";import{A as v}from"./annotations-decorator-bIsFvPEY.js";import{T as h}from"./TubeTrajectory-DYfgMCJK.js";import{D as n}from"./DepthMarkers-CCgp_rBX.js";import{s as c}from"./story-args-Cgt5gSNS.js";import"./CameraManager-BuezL_By.js";import"./curve-3d-B0j10gmN.js";import"./index.esm-BMr5xbKZ.js";import"./numbers-DM6OWwIG.js";import"./Text-BN5iLNcs.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./AnnotationsLayer-CAyRgV7V.js";import"./index-BsNHLAmC.js";import"./uv-material-DyQCcDTL.js";import"./layers-DoaKWXpU.js";import"./limiter-DhBcc_yH.js";import"./react-Mgt78q4a.js";import"./CasingLabel-7b3hFzXc.js";import"./useWellboreContext-DkvsaS95.js";const t=c.wellboreOptions,P=c.defaultWellbore,N={title:"Components/Wellbores/DepthMarkers",component:n},o={args:{id:P,interval:100,depthReferencePoint:"MSL"},argTypes:{id:{options:Object.keys(t),control:{type:"select",labels:t}},interval:{options:[10,50,100,250,500,1e3],control:"select"},depthReferencePoint:{options:["MSL","RT"],control:"radio"}},decorators:[b,v,D,p,u,f],render:e=>(d.useEffect(()=>{dispatchEvent(new l({id:e.id}))},[e.id]),r.jsx(r.Fragment,{children:r.jsxs(m,{id:e.id,children:[r.jsx(h,{radius:1,color:"teal"}),r.jsx(n,{...e})]})})),parameters:{scale:1e3,cameraPosition:[0,1500,2e3]}};var a,s,i;o.parameters={...o.parameters,docs:{...(a=o.parameters)==null?void 0:a.docs,source:{originalSource:`{
  args: {
    id: wellboreId,
    interval: 100,
    depthReferencePoint: 'MSL'
  },
  argTypes: {
    id: {
      options: Object.keys(wellboreOptions),
      control: {
        type: 'select',
        labels: wellboreOptions
      }
    },
    interval: {
      options: [10, 50, 100, 250, 500, 1000],
      control: 'select'
    },
    depthReferencePoint: {
      options: ['MSL', 'RT'],
      control: 'radio'
    }
  },
  decorators: [PerformanceDecorator, AnnotationsDecorator, Canvas3dDecorator, GeneratorsProviderDecorator, DepthSelectorDecorator, DataProviderDecorator],
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({
        id: args.id
      }));
    }, [args.id]);
    return <>\r
        <Wellbore id={args.id}>\r
          <TubeTrajectory radius={1} color="teal" />\r
          <DepthMarkers {...args} />\r
        </Wellbore>\r
      </>;
  },
  parameters: {
    scale: 1000,
    cameraPosition: [0, 1500, 2000]
  }
}`,...(i=(s=o.parameters)==null?void 0:s.docs)==null?void 0:i.source}}};const Q=["Default"];export{o as Default,Q as __namedExportsOrder,N as default};
