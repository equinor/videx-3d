import{j as e}from"./jsx-runtime-CmIOflP4.js";import{B as n}from"./BasicTrajectory-BNR446RI.js";import{W as i,a as l,G as m}from"./generators-provider-decorator-C-zBAaMo.js";import{D as d}from"./data-provider-decorator-BF4MaAx0.js";import{C as p}from"./canvas-3d-decorator-BhyssXtK.js";import{D as f}from"./depth-selector-decorator-BJdWELUm.js";import{r as D}from"./index-KqYmeiyw.js";import{s as u}from"./story-args-Cgt5gSNS.js";import"./useWellboreContext-DkvsaS95.js";import"./CameraManager-BuezL_By.js";import"./limiter-DhBcc_yH.js";import"./curve-3d-B0j10gmN.js";import"./index.esm-BMr5xbKZ.js";import"./numbers-DM6OWwIG.js";const G={title:"Components/Wellbores/BasicTrajectory",component:n},o=u.defaultWellbore,r={render:c=>(D.useEffect(()=>{dispatchEvent(new i({id:o}))},[]),e.jsx(l,{id:o,children:e.jsx(n,{...c})})),decorators:[p,m,f,d]};var t,a,s;r.parameters={...r.parameters,docs:{...(t=r.parameters)==null?void 0:t.docs,source:{originalSource:`{
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({
        id: wellboreId
      }));
    }, []);
    return <Wellbore id={wellboreId}>\r
        <BasicTrajectory {...args} />\r
      </Wellbore>;
  },
  decorators: [Canvas3dDecorator, GeneratorsProviderDecorator, DepthSelectorDecorator, DataProviderDecorator]
}`,...(s=(a=r.parameters)==null?void 0:a.docs)==null?void 0:s.source}}};const I=["Default"];export{r as Default,I as __namedExportsOrder,G as default};
