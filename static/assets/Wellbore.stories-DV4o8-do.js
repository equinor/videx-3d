import{j as o}from"./jsx-runtime-CmIOflP4.js";import{s as t}from"./story-args-Cgt5gSNS.js";import{a as l,G as c,W as i}from"./generators-provider-decorator-BR7wOsTW.js";import{D as p}from"./data-provider-decorator-BCAx_xlJ.js";import{C as m}from"./canvas-3d-decorator-DXFES1_8.js";import{r as d}from"./index-KqYmeiyw.js";import{P as b}from"./performance-decorator-bIdhsxLH.js";import{D as f}from"./depth-selector-decorator-HkEHPqzE.js";import"./CameraManager-BTlj_2qD.js";import"./curve-3d-BSYPmKD_.js";import"./numbers-DM6OWwIG.js";import"./Text-DbK8u8Ip.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";const A={title:"Components/Wellbores/Wellbore",component:l},D=t.defaultWellbore,e={args:{id:D,segmentsPerMeter:.1},argTypes:{id:{options:Object.keys(t.wellboreOptions),control:{type:"select",labels:t.wellboreOptions}}},decorators:[b,m,c,f,p],render:r=>(d.useEffect(()=>{dispatchEvent(new i({id:r.id}))},[r.id]),o.jsx(o.Fragment,{children:o.jsx(l,{...r})})),parameters:{scale:100}};var s,a,n;e.parameters={...e.parameters,docs:{...(s=e.parameters)==null?void 0:s.docs,source:{originalSource:`{
  args: {
    id: wellboreId,
    segmentsPerMeter: 0.1
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
  decorators: [PerformanceDecorator, Canvas3dDecorator, GeneratorsProviderDecorator, DepthSelectorDecorator, DataProviderDecorator],
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({
        id: args.id
      }));
    }, [args.id]);
    return <>\r
        <Wellbore {...args}>\r
       \r
        </Wellbore>\r
      </>;
  },
  parameters: {
    scale: 100
  }
}`,...(n=(a=e.parameters)==null?void 0:a.docs)==null?void 0:n.source}}};const G=["Default"];export{e as Default,G as __namedExportsOrder,A as default};
