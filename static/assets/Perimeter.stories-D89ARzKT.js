import{j as r}from"./jsx-runtime-CmIOflP4.js";import{s as t}from"./story-args-Cgt5gSNS.js";import{r as m}from"./index-KqYmeiyw.js";import{a as i,G as c,W as l}from"./generators-provider-decorator-BR7wOsTW.js";import{D as p}from"./data-provider-decorator-BCAx_xlJ.js";import{C as d}from"./canvas-3d-decorator-DXFES1_8.js";import{P as f}from"./performance-decorator-bIdhsxLH.js";import{D}from"./depth-selector-decorator-HkEHPqzE.js";import{B as b}from"./BasicTrajectory-2wYFDS2o.js";import{P as u}from"./Perimeter-Dx2ZtP8w.js";import{A as g}from"./annotations-decorator-35Z4NkoW.js";import{C as P}from"./Casings--iVSCNOQ.js";import"./CameraManager-BTlj_2qD.js";import"./curve-3d-BSYPmKD_.js";import"./numbers-DM6OWwIG.js";import"./Text-DbK8u8Ip.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./useWellboreContext-l1cQXUDV.js";import"./limiter-DhBcc_yH.js";import"./uv-material-Cw8kPkQB.js";import"./AnnotationsLayer-Dj29EBht.js";import"./react-Mgt78q4a.js";import"./CasingLabel-7b3hFzXc.js";const K={title:"Components/Wellbores/Perimeter",component:i},j=t.defaultWellbore,o={args:{id:j,radius:20,from:1e3,to:2500},argTypes:{id:{options:Object.keys(t.wellboreOptions),control:{type:"select",labels:t.wellboreOptions}}},decorators:[f,g,d,c,D,p],render:e=>(m.useEffect(()=>{dispatchEvent(new l({id:e.id}))},[e.id]),r.jsx(r.Fragment,{children:r.jsxs(i,{id:e.id,children:[r.jsx(b,{}),r.jsx(P,{sizeMultiplier:10}),r.jsx(u,{...e})]})})),parameters:{scale:1e3,cameraPosition:[0,1500,2e3]}};var s,a,n;o.parameters={...o.parameters,docs:{...(s=o.parameters)==null?void 0:s.docs,source:{originalSource:`{
  args: {
    id: wellboreId,
    radius: 20,
    from: 1000,
    to: 2500
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
          <BasicTrajectory />\r
          <Casings sizeMultiplier={10} />\r
          <Perimeter {...args} />\r
        </Wellbore>\r
      </>;
  },
  parameters: {
    scale: 1000,
    cameraPosition: [0, 1500, 2000]
  }
}`,...(n=(a=o.parameters)==null?void 0:a.docs)==null?void 0:n.source}}};const L=["Default"];export{o as Default,L as __namedExportsOrder,K as default};
