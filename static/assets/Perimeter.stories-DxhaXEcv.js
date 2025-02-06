import{j as r}from"./jsx-runtime-CmIOflP4.js";import{s as t}from"./story-args-Cgt5gSNS.js";import{r as m}from"./index-KqYmeiyw.js";import{a as i,G as p,W as c}from"./generators-provider-decorator-C-zBAaMo.js";import{D as l}from"./data-provider-decorator-BF4MaAx0.js";import{C as d}from"./canvas-3d-decorator-BhyssXtK.js";import{P as f}from"./performance-decorator-C0S1r9nP.js";import{D}from"./depth-selector-decorator-BJdWELUm.js";import{B as b}from"./BasicTrajectory-BNR446RI.js";import{P as u}from"./Perimeter-CyYGaujG.js";import{A as g}from"./annotations-decorator-bIsFvPEY.js";import{C as P}from"./Casings-on--jxdC.js";import"./CameraManager-BuezL_By.js";import"./curve-3d-B0j10gmN.js";import"./index.esm-BMr5xbKZ.js";import"./numbers-DM6OWwIG.js";import"./Text-BN5iLNcs.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./useWellboreContext-DkvsaS95.js";import"./limiter-DhBcc_yH.js";import"./layers-DoaKWXpU.js";import"./AnnotationsLayer-CAyRgV7V.js";import"./index-BsNHLAmC.js";import"./uv-material-DyQCcDTL.js";import"./react-Mgt78q4a.js";import"./CasingLabel-7b3hFzXc.js";const Q={title:"Components/Wellbores/Perimeter",component:i},j=t.defaultWellbore,o={args:{id:j,radius:20,from:1e3,to:2500},argTypes:{id:{options:Object.keys(t.wellboreOptions),control:{type:"select",labels:t.wellboreOptions}}},decorators:[f,g,d,p,D,l],render:e=>(m.useEffect(()=>{dispatchEvent(new c({id:e.id}))},[e.id]),r.jsx(r.Fragment,{children:r.jsxs(i,{id:e.id,children:[r.jsx(b,{}),r.jsx(P,{sizeMultiplier:10}),r.jsx(u,{...e})]})})),parameters:{scale:1e3,cameraPosition:[0,1500,2e3]}};var s,a,n;o.parameters={...o.parameters,docs:{...(s=o.parameters)==null?void 0:s.docs,source:{originalSource:`{
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
}`,...(n=(a=o.parameters)==null?void 0:a.docs)==null?void 0:n.source}}};const U=["Default"];export{o as Default,U as __namedExportsOrder,Q as default};
