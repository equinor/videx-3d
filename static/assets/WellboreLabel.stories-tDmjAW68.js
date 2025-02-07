import{j as r}from"./jsx-runtime-CmIOflP4.js";import{s as t}from"./story-args-Cgt5gSNS.js";import{G as l,W as p,a as c}from"./generators-provider-decorator-BR7wOsTW.js";import{D as m}from"./data-provider-decorator-BCAx_xlJ.js";import{C as d}from"./canvas-3d-decorator-DXFES1_8.js";import{r as b}from"./index-KqYmeiyw.js";import{D as f}from"./depth-selector-decorator-HkEHPqzE.js";import{W as i}from"./WellboreLabel-CJKbspHD.js";import{A as D}from"./annotations-decorator-35Z4NkoW.js";import{B as g}from"./BasicTrajectory-2wYFDS2o.js";import"./CameraManager-BTlj_2qD.js";import"./curve-3d-BSYPmKD_.js";import"./numbers-DM6OWwIG.js";import"./useWellboreContext-l1cQXUDV.js";import"./limiter-DhBcc_yH.js";import"./AnnotationsLayer-Dj29EBht.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./uv-material-Cw8kPkQB.js";import"./react-Mgt78q4a.js";import"./CasingLabel-7b3hFzXc.js";const R={title:"Components/Wellbores/WellboreLabel",component:i},y=t.defaultWellbore,e={args:{id:y,position:"bottom"},argTypes:{id:{options:Object.keys(t.wellboreOptions),control:{type:"select",labels:t.wellboreOptions}},position:{type:"string",options:["top","center","bottom"],control:"radio"}},decorators:[D,d,l,f,m],render:o=>(b.useEffect(()=>{dispatchEvent(new p({id:o.id}))},[o.id]),r.jsx(r.Fragment,{children:r.jsxs(c,{id:o.id,children:[r.jsx(g,{}),r.jsx(i,{...o})]})})),parameters:{scale:100}};var n,s,a;e.parameters={...e.parameters,docs:{...(n=e.parameters)==null?void 0:n.docs,source:{originalSource:`{
  args: {
    id: wellboreId,
    position: 'bottom'
  },
  argTypes: {
    id: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: {
        type: 'select',
        labels: storyArgs.wellboreOptions
      }
    },
    position: {
      type: 'string',
      options: ['top', 'center', 'bottom'],
      control: 'radio'
    }
  },
  decorators: [AnnotationsDecorator, Canvas3dDecorator, GeneratorsProviderDecorator, DepthSelectorDecorator, DataProviderDecorator],
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({
        id: args.id
      }));
    }, [args.id]);
    return <>\r
        <Wellbore id={args.id}>\r
          <BasicTrajectory />\r
          <WellboreLabel {...args} />\r
        </Wellbore>\r
      </>;
  },
  parameters: {
    scale: 100
  }
}`,...(a=(s=e.parameters)==null?void 0:s.docs)==null?void 0:a.source}}};const q=["Default"];export{e as Default,q as __namedExportsOrder,R as default};
