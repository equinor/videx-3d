import{j as o}from"./jsx-runtime-CmIOflP4.js";import{s as t}from"./story-args-Cgt5gSNS.js";import{a as l,G as c,W as i}from"./generators-provider-decorator-C-zBAaMo.js";import{D as p}from"./data-provider-decorator-BF4MaAx0.js";import{C as m}from"./canvas-3d-decorator-BhyssXtK.js";import{r as d}from"./index-KqYmeiyw.js";import{P as b}from"./performance-decorator-C0S1r9nP.js";import{D as f}from"./depth-selector-decorator-BJdWELUm.js";import"./CameraManager-BuezL_By.js";import"./curve-3d-B0j10gmN.js";import"./index.esm-BMr5xbKZ.js";import"./numbers-DM6OWwIG.js";import"./Text-BN5iLNcs.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";const G={title:"Components/Wellbores/Wellbore",component:l},D=t.defaultWellbore,e={args:{id:D,segmentsPerMeter:.1},argTypes:{id:{options:Object.keys(t.wellboreOptions),control:{type:"select",labels:t.wellboreOptions}}},decorators:[b,m,c,f,p],render:r=>(d.useEffect(()=>{dispatchEvent(new i({id:r.id}))},[r.id]),o.jsx(o.Fragment,{children:o.jsx(l,{...r})})),parameters:{scale:100}};var s,a,n;e.parameters={...e.parameters,docs:{...(s=e.parameters)==null?void 0:s.docs,source:{originalSource:`{
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
}`,...(n=(a=e.parameters)==null?void 0:a.docs)==null?void 0:n.source}}};const k=["Default"];export{e as Default,k as __namedExportsOrder,G as default};
