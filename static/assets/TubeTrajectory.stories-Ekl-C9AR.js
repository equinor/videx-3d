import{j as e}from"./jsx-runtime-CmIOflP4.js";import{a as i,G as c,W as l}from"./generators-provider-decorator-BR7wOsTW.js";import{D as m}from"./data-provider-decorator-BCAx_xlJ.js";import{C as p}from"./canvas-3d-decorator-DXFES1_8.js";import{r as d}from"./index-KqYmeiyw.js";import{P as b}from"./performance-decorator-bIdhsxLH.js";import{D as f}from"./depth-selector-decorator-HkEHPqzE.js";import{A as D}from"./annotations-decorator-35Z4NkoW.js";import{T as u}from"./TubeTrajectory-DuMpWrKE.js";import{s as t}from"./story-args-Cgt5gSNS.js";import"./CameraManager-BTlj_2qD.js";import"./curve-3d-BSYPmKD_.js";import"./numbers-DM6OWwIG.js";import"./Text-DbK8u8Ip.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./AnnotationsLayer-Dj29EBht.js";import"./uv-material-Cw8kPkQB.js";import"./limiter-DhBcc_yH.js";import"./react-Mgt78q4a.js";import"./CasingLabel-7b3hFzXc.js";import"./useWellboreContext-l1cQXUDV.js";const B={title:"Components/Wellbores/TubeTrajectory",component:i},y=t.defaultWellbore,o={args:{id:y,radius:1,color:"lime"},argTypes:{id:{options:Object.keys(t.wellboreOptions),control:{type:"select",labels:t.wellboreOptions}}},decorators:[b,D,p,c,f,m],render:r=>(d.useEffect(()=>{dispatchEvent(new l({id:r.id}))},[r.id]),e.jsx(e.Fragment,{children:e.jsx(i,{id:r.id,children:e.jsx(u,{...r})})})),parameters:{scale:1e3,cameraPosition:[0,1500,2e3]}};var a,s,n;o.parameters={...o.parameters,docs:{...(a=o.parameters)==null?void 0:a.docs,source:{originalSource:`{
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
}`,...(n=(s=o.parameters)==null?void 0:s.docs)==null?void 0:n.source}}};const H=["Default"];export{o as Default,H as __namedExportsOrder,B as default};
