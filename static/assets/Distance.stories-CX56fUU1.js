import{j as e}from"./jsx-runtime-CmIOflP4.js";import{G as D,W as p,a as u}from"./generators-provider-decorator-C-zBAaMo.js";import{D as j}from"./data-provider-decorator-BF4MaAx0.js";import{C as h}from"./canvas-3d-decorator-BhyssXtK.js";import{r as f}from"./index-KqYmeiyw.js";import{D as W}from"./depth-selector-decorator-BJdWELUm.js";import{D as o}from"./Distance-CrwyHwf-.js";import{W as g}from"./WellboreBounds-BOqTmlAb.js";import{B as x}from"./BasicTrajectory-BNR446RI.js";import{C as b}from"./Casings-on--jxdC.js";import{A as E,b as w}from"./AnnotationsLayer-CAyRgV7V.js";import{s as v}from"./story-args-Cgt5gSNS.js";import"./CameraManager-BuezL_By.js";import"./curve-3d-B0j10gmN.js";import"./index.esm-BMr5xbKZ.js";import"./numbers-DM6OWwIG.js";import"./useWellboreContext-DkvsaS95.js";import"./limiter-DhBcc_yH.js";import"./layers-DoaKWXpU.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./index-BsNHLAmC.js";import"./uv-material-DyQCcDTL.js";import"./react-Mgt78q4a.js";const V={title:"Components/Misc/Distance",decorators:[h,D,W,j],component:o},r=v.defaultWellbore,n={args:{min:0,max:10},render:t=>(f.useEffect(()=>{dispatchEvent(new p({id:r}))},[]),e.jsx(e.Fragment,{children:e.jsx(u,{id:r,children:e.jsxs(g,{id:r,children:[e.jsx(x,{}),e.jsx(o,{...t,children:e.jsx(b,{sizeMultiplier:10,radialSegments:128,segmentsPerMeter:1,shoeFactor:1.3})})]})})})),parameters:{scale:1e3}},s={args:{min:0,max:10},render:t=>(f.useEffect(()=>{dispatchEvent(new p({id:r}))},[]),e.jsxs(e.Fragment,{children:[e.jsx(E,{children:e.jsx(w,{id:"distance",name:"distance"})}),e.jsx(u,{id:r,children:e.jsxs(g,{id:r,children:[e.jsx(x,{}),e.jsx(o,{...t,onDemand:!0,children:e.jsx(b,{sizeMultiplier:10,radialSegments:128,segmentsPerMeter:1,shoeFactor:1.3})})]})})]})),parameters:{scale:1e3}};var a,i,l;n.parameters={...n.parameters,docs:{...(a=n.parameters)==null?void 0:a.docs,source:{originalSource:`{
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
}`,...(c=(d=s.parameters)==null?void 0:d.docs)==null?void 0:c.source}}};const X=["Default","OnDemand"];export{n as Default,s as OnDemand,X as __namedExportsOrder,V as default};
