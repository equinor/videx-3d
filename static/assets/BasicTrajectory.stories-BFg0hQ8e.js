import{j as e}from"./jsx-runtime-CmIOflP4.js";import{B as n}from"./BasicTrajectory-2wYFDS2o.js";import{W as i,a as l,G as m}from"./generators-provider-decorator-BR7wOsTW.js";import{D as d}from"./data-provider-decorator-BCAx_xlJ.js";import{C as p}from"./canvas-3d-decorator-DXFES1_8.js";import{D as f}from"./depth-selector-decorator-HkEHPqzE.js";import{r as D}from"./index-KqYmeiyw.js";import{s as u}from"./story-args-Cgt5gSNS.js";import"./useWellboreContext-l1cQXUDV.js";import"./CameraManager-BTlj_2qD.js";import"./limiter-DhBcc_yH.js";import"./curve-3d-BSYPmKD_.js";import"./numbers-DM6OWwIG.js";const P={title:"Components/Wellbores/BasicTrajectory",component:n},o=u.defaultWellbore,r={render:c=>(D.useEffect(()=>{dispatchEvent(new i({id:o}))},[]),e.jsx(l,{id:o,children:e.jsx(n,{...c})})),decorators:[p,m,f,d]};var t,a,s;r.parameters={...r.parameters,docs:{...(t=r.parameters)==null?void 0:t.docs,source:{originalSource:`{
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
}`,...(s=(a=r.parameters)==null?void 0:a.docs)==null?void 0:s.source}}};const G=["Default"];export{r as Default,G as __namedExportsOrder,P as default};
