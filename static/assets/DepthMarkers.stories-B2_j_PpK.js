import{j as r}from"./jsx-runtime-CmIOflP4.js";import{G as l,W as p,a as m}from"./generators-provider-decorator-BR7wOsTW.js";import{r as d}from"./index-KqYmeiyw.js";import{D as f}from"./data-provider-decorator-BCAx_xlJ.js";import{C as D}from"./canvas-3d-decorator-DXFES1_8.js";import{P as b}from"./performance-decorator-bIdhsxLH.js";import{D as u}from"./depth-selector-decorator-HkEHPqzE.js";import{A as v}from"./annotations-decorator-35Z4NkoW.js";import{T as h}from"./TubeTrajectory-DuMpWrKE.js";import{D as n}from"./DepthMarkers-KMRPWUWH.js";import{s as c}from"./story-args-Cgt5gSNS.js";import"./CameraManager-BTlj_2qD.js";import"./curve-3d-BSYPmKD_.js";import"./numbers-DM6OWwIG.js";import"./Text-DbK8u8Ip.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./AnnotationsLayer-Dj29EBht.js";import"./uv-material-Cw8kPkQB.js";import"./limiter-DhBcc_yH.js";import"./react-Mgt78q4a.js";import"./CasingLabel-7b3hFzXc.js";import"./useWellboreContext-l1cQXUDV.js";const t=c.wellboreOptions,P=c.defaultWellbore,H={title:"Components/Wellbores/DepthMarkers",component:n},o={args:{id:P,interval:100,depthReferencePoint:"MSL"},argTypes:{id:{options:Object.keys(t),control:{type:"select",labels:t}},interval:{options:[10,50,100,250,500,1e3],control:"select"},depthReferencePoint:{options:["MSL","RT"],control:"radio"}},decorators:[b,v,D,l,u,f],render:e=>(d.useEffect(()=>{dispatchEvent(new p({id:e.id}))},[e.id]),r.jsx(r.Fragment,{children:r.jsxs(m,{id:e.id,children:[r.jsx(h,{radius:1,color:"teal"}),r.jsx(n,{...e})]})})),parameters:{scale:1e3,cameraPosition:[0,1500,2e3]}};var a,s,i;o.parameters={...o.parameters,docs:{...(a=o.parameters)==null?void 0:a.docs,source:{originalSource:`{
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
}`,...(i=(s=o.parameters)==null?void 0:s.docs)==null?void 0:i.source}}};const J=["Default"];export{o as Default,J as __namedExportsOrder,H as default};
