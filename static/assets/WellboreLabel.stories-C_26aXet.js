import{j as r}from"./jsx-runtime-CmIOflP4.js";import{s as t}from"./story-args-Cgt5gSNS.js";import{G as p,W as l,a as c}from"./generators-provider-decorator-C-zBAaMo.js";import{D as m}from"./data-provider-decorator-BF4MaAx0.js";import{C as d}from"./canvas-3d-decorator-BhyssXtK.js";import{r as b}from"./index-KqYmeiyw.js";import{D as f}from"./depth-selector-decorator-BJdWELUm.js";import{W as i}from"./WellboreLabel-C9LsxgQV.js";import{A as D}from"./annotations-decorator-bIsFvPEY.js";import{B as g}from"./BasicTrajectory-BNR446RI.js";import"./CameraManager-BuezL_By.js";import"./curve-3d-B0j10gmN.js";import"./index.esm-BMr5xbKZ.js";import"./numbers-DM6OWwIG.js";import"./useWellboreContext-DkvsaS95.js";import"./limiter-DhBcc_yH.js";import"./AnnotationsLayer-CAyRgV7V.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./index-BsNHLAmC.js";import"./uv-material-DyQCcDTL.js";import"./layers-DoaKWXpU.js";import"./react-Mgt78q4a.js";import"./CasingLabel-7b3hFzXc.js";const H={title:"Components/Wellbores/WellboreLabel",component:i},y=t.defaultWellbore,e={args:{id:y,position:"bottom"},argTypes:{id:{options:Object.keys(t.wellboreOptions),control:{type:"select",labels:t.wellboreOptions}},position:{type:"string",options:["top","center","bottom"],control:"radio"}},decorators:[D,d,p,f,m],render:o=>(b.useEffect(()=>{dispatchEvent(new l({id:o.id}))},[o.id]),r.jsx(r.Fragment,{children:r.jsxs(c,{id:o.id,children:[r.jsx(g,{}),r.jsx(i,{...o})]})})),parameters:{scale:100}};var n,s,a;e.parameters={...e.parameters,docs:{...(n=e.parameters)==null?void 0:n.docs,source:{originalSource:`{
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
}`,...(a=(s=e.parameters)==null?void 0:s.docs)==null?void 0:a.source}}};const J=["Default"];export{e as Default,J as __namedExportsOrder,H as default};
