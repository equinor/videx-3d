import{j as e}from"./jsx-runtime-CmIOflP4.js";import{G as D,W as p,a as u}from"./generators-provider-decorator-BR7wOsTW.js";import{D as j}from"./data-provider-decorator-BCAx_xlJ.js";import{C as h}from"./canvas-3d-decorator-DXFES1_8.js";import{r as f}from"./index-KqYmeiyw.js";import{D as W}from"./depth-selector-decorator-HkEHPqzE.js";import{D as a}from"./Distance-Da7LZBFW.js";import{W as g}from"./WellboreBounds-8fG3kb4k.js";import{B as x}from"./BasicTrajectory-2wYFDS2o.js";import{C as b}from"./Casings--iVSCNOQ.js";import{A as E,b as w}from"./AnnotationsLayer-Dj29EBht.js";import{s as v}from"./story-args-Cgt5gSNS.js";import"./CameraManager-BTlj_2qD.js";import"./curve-3d-BSYPmKD_.js";import"./numbers-DM6OWwIG.js";import"./useWellboreContext-l1cQXUDV.js";import"./limiter-DhBcc_yH.js";import"./uv-material-Cw8kPkQB.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./react-Mgt78q4a.js";const N={title:"Components/Misc/Distance",decorators:[h,D,W,j],component:a},r=v.defaultWellbore,n={args:{min:0,max:10},render:t=>(f.useEffect(()=>{dispatchEvent(new p({id:r}))},[]),e.jsx(e.Fragment,{children:e.jsx(u,{id:r,children:e.jsxs(g,{id:r,children:[e.jsx(x,{}),e.jsx(a,{...t,children:e.jsx(b,{sizeMultiplier:10,radialSegments:128,segmentsPerMeter:1,shoeFactor:1.3})})]})})})),parameters:{scale:1e3}},s={args:{min:0,max:10},render:t=>(f.useEffect(()=>{dispatchEvent(new p({id:r}))},[]),e.jsxs(e.Fragment,{children:[e.jsx(E,{children:e.jsx(w,{id:"distance",name:"distance"})}),e.jsx(u,{id:r,children:e.jsxs(g,{id:r,children:[e.jsx(x,{}),e.jsx(a,{...t,onDemand:!0,children:e.jsx(b,{sizeMultiplier:10,radialSegments:128,segmentsPerMeter:1,shoeFactor:1.3})})]})})]})),parameters:{scale:1e3}};var o,i,l;n.parameters={...n.parameters,docs:{...(o=n.parameters)==null?void 0:o.docs,source:{originalSource:`{
  args: {
    min: 0,
    max: 10
  },
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({
        id: wellboreId
      }));
    }, []);
    return <>\r
        <Wellbore id={wellboreId}>\r
          <WellboreBounds id={wellboreId}>\r
            <BasicTrajectory />\r
            <Distance {...args}>\r
              <Casings sizeMultiplier={10} radialSegments={128} segmentsPerMeter={1} shoeFactor={1.3} />\r
            </Distance>\r
          </WellboreBounds>\r
        </Wellbore>\r
      </>;
  },
  parameters: {
    scale: 1000
  }
}`,...(l=(i=n.parameters)==null?void 0:i.docs)==null?void 0:l.source}}};var m,d,c;s.parameters={...s.parameters,docs:{...(m=s.parameters)==null?void 0:m.docs,source:{originalSource:`{
  args: {
    min: 0,
    max: 10
  },
  render: args => {
    useEffect(() => {
      dispatchEvent(new WellboreSelectedEvent({
        id: wellboreId
      }));
    }, []);
    return <>\r
        <Annotations>\r
          <AnnotationsLayer id='distance' name='distance' />\r
        </Annotations>\r
        <Wellbore id={wellboreId}>\r
          <WellboreBounds id={wellboreId}>\r
            <BasicTrajectory />\r
            <Distance {...args} onDemand>\r
              <Casings sizeMultiplier={10} radialSegments={128} segmentsPerMeter={1} shoeFactor={1.3} />\r
            </Distance>\r
          </WellboreBounds>\r
        </Wellbore>\r
      </>;
  },
  parameters: {
    scale: 1000
  }
}`,...(c=(d=s.parameters)==null?void 0:d.docs)==null?void 0:c.source}}};const Q=["Default","OnDemand"];export{n as Default,s as OnDemand,Q as __namedExportsOrder,N as default};
