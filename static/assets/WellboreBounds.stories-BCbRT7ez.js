import{j as r}from"./jsx-runtime-CmIOflP4.js";import{s as n}from"./story-args-Cgt5gSNS.js";import{a as c,G as p,W as m}from"./generators-provider-decorator-C-zBAaMo.js";import{D as d}from"./data-provider-decorator-BF4MaAx0.js";import{C as u,u as b}from"./canvas-3d-decorator-BhyssXtK.js";import{r as s}from"./index-KqYmeiyw.js";import{P as f}from"./performance-decorator-C0S1r9nP.js";import{D}from"./depth-selector-decorator-BJdWELUm.js";import{W as g,D as y}from"./WellboreBounds-BOqTmlAb.js";import{B as x}from"./BasicTrajectory-BNR446RI.js";import{u as S,O as v,a as O}from"./output-panel-decorator-DXohYIJy.js";import"./CameraManager-BuezL_By.js";import"./curve-3d-B0j10gmN.js";import"./index.esm-BMr5xbKZ.js";import"./numbers-DM6OWwIG.js";import"./Text-BN5iLNcs.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./useWellboreContext-DkvsaS95.js";import"./limiter-DhBcc_yH.js";import"./react-Mgt78q4a.js";const N={title:"Components/Wellbores/WellboreBounds",component:c,loaders:[async()=>S.setState({groups:{}})]},P=n.defaultWellbore,W=()=>{const e=s.useContext(y),o=O();return s.useEffect(()=>(o.add("distance",{label:"Distance",value:"-"}),()=>{o.remove("distance")}),[o]),b(()=>{e&&o.update("distance",e.current)}),null},t={args:{id:P,boundsSampleSize:250},argTypes:{id:{options:Object.keys(n.wellboreOptions),control:{type:"select",labels:n.wellboreOptions}},boundsSampleSize:{type:"number",control:{type:"range",max:1e3,min:10,step:10}}},decorators:[f,u,p,v,D,d],render:e=>(s.useEffect(()=>{dispatchEvent(new m({id:e.id}))},[e.id]),r.jsx(r.Fragment,{children:r.jsxs(c,{id:e.id,children:[r.jsx(x,{}),r.jsx(g,{...e,visible:!0,children:r.jsx(W,{})})]})})),parameters:{scale:1e3,cameraPosition:[0,15e3,2e4]}};var a,i,l;t.parameters={...t.parameters,docs:{...(a=t.parameters)==null?void 0:a.docs,source:{originalSource:`{
  args: {
    id: wellboreId,
    boundsSampleSize: 250
  },
  argTypes: {
    id: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: {
        type: 'select',
        labels: storyArgs.wellboreOptions
      }
    },
    boundsSampleSize: {
      type: 'number',
      control: {
        type: 'range',
        max: 1000,
        min: 10,
        step: 10
      }
    }
  },
  decorators: [PerformanceDecorator, Canvas3dDecorator, GeneratorsProviderDecorator, OutputPanelDecorator, DepthSelectorDecorator, DataProviderDecorator],
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({
        id: args.id
      }));
    }, [args.id]);
    return <>\r
        <Wellbore id={args.id}>\r
          <BasicTrajectory />\r
          <WellboreBounds {...args} visible>\r
            <OutputLogger />\r
          </WellboreBounds>\r
        </Wellbore>\r
      </>;
  },
  parameters: {
    scale: 1000,
    cameraPosition: [0, 15000, 20000]
  }
}`,...(l=(i=t.parameters)==null?void 0:i.docs)==null?void 0:l.source}}};const Q=["Default"];export{t as Default,Q as __namedExportsOrder,N as default};
