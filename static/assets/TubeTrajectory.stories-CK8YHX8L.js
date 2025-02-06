import{j as e}from"./jsx-runtime-CmIOflP4.js";import{a as i,G as c,W as m}from"./generators-provider-decorator-C-zBAaMo.js";import{D as l}from"./data-provider-decorator-BF4MaAx0.js";import{C as p}from"./canvas-3d-decorator-BhyssXtK.js";import{r as d}from"./index-KqYmeiyw.js";import{P as b}from"./performance-decorator-C0S1r9nP.js";import{D as f}from"./depth-selector-decorator-BJdWELUm.js";import{A as D}from"./annotations-decorator-bIsFvPEY.js";import{T as u}from"./TubeTrajectory-DYfgMCJK.js";import{s as t}from"./story-args-Cgt5gSNS.js";import"./CameraManager-BuezL_By.js";import"./curve-3d-B0j10gmN.js";import"./index.esm-BMr5xbKZ.js";import"./numbers-DM6OWwIG.js";import"./Text-BN5iLNcs.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./AnnotationsLayer-CAyRgV7V.js";import"./index-BsNHLAmC.js";import"./uv-material-DyQCcDTL.js";import"./layers-DoaKWXpU.js";import"./limiter-DhBcc_yH.js";import"./react-Mgt78q4a.js";import"./CasingLabel-7b3hFzXc.js";import"./useWellboreContext-DkvsaS95.js";const K={title:"Components/Wellbores/TubeTrajectory",component:i},y=t.defaultWellbore,o={args:{id:y,radius:1,color:"lime"},argTypes:{id:{options:Object.keys(t.wellboreOptions),control:{type:"select",labels:t.wellboreOptions}}},decorators:[b,D,p,c,f,l],render:r=>(d.useEffect(()=>{dispatchEvent(new m({id:r.id}))},[r.id]),e.jsx(e.Fragment,{children:e.jsx(i,{id:r.id,children:e.jsx(u,{...r})})})),parameters:{scale:1e3,cameraPosition:[0,1500,2e3]}};var a,s,n;o.parameters={...o.parameters,docs:{...(a=o.parameters)==null?void 0:a.docs,source:{originalSource:`{
  args: {
    id: wellboreId,
    radius: 1,
    color: 'lime'
  },
  argTypes: {
    id: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: {
        type: 'select',
        labels: storyArgs.wellboreOptions
      }
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
          <TubeTrajectory {...args} />\r
        </Wellbore>\r
      </>;
  },
  parameters: {
    scale: 1000,
    cameraPosition: [0, 1500, 2000]
  }
}`,...(n=(s=o.parameters)==null?void 0:s.docs)==null?void 0:n.source}}};const L=["Default"];export{o as Default,L as __namedExportsOrder,K as default};
