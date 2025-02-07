import{j as o}from"./jsx-runtime-CmIOflP4.js";import{s as d}from"./story-args-Cgt5gSNS.js";import{a as A,G as T,W as M}from"./generators-provider-decorator-BR7wOsTW.js";import{D as F}from"./data-provider-decorator-BCAx_xlJ.js";import{C as O}from"./canvas-3d-decorator-DXFES1_8.js";import{B as z}from"./BasicTrajectory-2wYFDS2o.js";import{C as E}from"./CompletionTools-DpgMl0yI.js";import{C as _}from"./Casings--iVSCNOQ.js";import{r as l}from"./index-KqYmeiyw.js";import{P as S}from"./performance-decorator-bIdhsxLH.js";import{P as R}from"./Perimeter-Dx2ZtP8w.js";import{u as b,a as w}from"./useWellboreContext-l1cQXUDV.js";import{V as D,f}from"./CameraManager-BTlj_2qD.js";import{q as j}from"./limiter-DhBcc_yH.js";import{a as P,u as W,A as k,b as h}from"./AnnotationsLayer-Dj29EBht.js";import{D as L}from"./depth-selector-decorator-HkEHPqzE.js";import{C as G}from"./CasingLabel-7b3hFzXc.js";import{P as I}from"./Perforations-ChIdvImb.js";import"./curve-3d-BSYPmKD_.js";import"./numbers-DM6OWwIG.js";import"./uv-material-Cw8kPkQB.js";import"./Text-DbK8u8Ip.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./react-Mgt78q4a.js";const N="casingToolAnnotations",u=()=>{const{id:e}=b(),t=l.useRef(null),r=w(N),{addAnnotations:a}=P("casings",e);return l.useEffect(()=>{let n=null;if(r&&e){const i=new D;j(()=>r(e).then(s=>{s&&t.current&&(s.forEach((c,v)=>{i.set(...c.position),t.current.localToWorld(i),c.position=i.toArray(),c.id=v.toString()}),n=a(s||[]))}),1)}return()=>{n&&n()}},[a,e,r,t]),o.jsx("object3D",{ref:t,visible:!1})};try{u.displayName="CasingAnnotations",u.__docgenInfo={description:"Adds annotations for casing data. This component needs to be a child of the `Wellbore` component.",displayName:"CasingAnnotations",props:{}}}catch{}const B="completionToolAnnotations",m=new D,g=()=>{const{id:e}=b(),t=l.useRef(null),r=w(B),{addAnnotations:a}=P("completion",e);return l.useEffect(()=>{let n=null;return r&&e&&j(()=>r(e).then(i=>{i&&t.current&&(i.forEach((s,c)=>{m.set(...s.position),t.current.localToWorld(m),s.position=m.toArray(),s.id=c.toString()}),n=a(i||[]))}),0),()=>{n&&n()}},[e,r,a]),o.jsx("object3D",{ref:t,visible:!1})};try{g.displayName="CompletionAnnotations",g.__docgenInfo={description:"Adds annotations for completion data. This component needs to be a child of the `Wellbore` component.",displayName:"CompletionAnnotations",props:{}}}catch{}const fe={title:"examples/Wellbore",loaders:[()=>{W.getState().clear()}],component:A},q=d.defaultWellbore,p={args:{id:q,sizeMultiplier:10,segmentsPerMeter:.1,showTrajectory:!0,showCompletion:!0,showCompletionAnnotations:!0,showCasings:!0,showCasingAnnotations:!0,showPerimeter:!1,casingOpacity:.7,shoeFactor:1.5,perimeterRadius:10,perimeterFrom:1e3,perimeterTo:1e4,fromMsl:0},argTypes:{id:{options:Object.keys(d.wellboreOptions),control:{type:"select",labels:d.wellboreOptions}},fromMsl:{control:{type:"range",min:0,max:5e3,step:1}},sizeMultiplier:{control:{type:"range",min:1,max:10,step:1}},casingOpacity:{control:{type:"range",min:.1,max:1,step:.1}},segmentsPerMeter:{control:{type:"range",min:.1,max:20,step:.1}},simplificationThreshold:{control:{type:"range",min:0,max:1e-4,step:1e-6}},shoeFactor:{control:{type:"range",min:1,max:2,step:.1}},perimeterRadius:{control:{type:"range",min:1,max:50,step:1}},perimeterFrom:{control:{type:"range",min:0,max:1e4,step:1}},perimeterTo:{control:{type:"range",min:0,max:1e4,step:1}}},decorators:[S,O,T,L,F],render:e=>(l.useEffect(()=>{dispatchEvent(new M({id:e.id}))},[e.id]),console.log(e.id),o.jsxs(o.Fragment,{children:[o.jsxs(A,{...e,children:[e.showTrajectory&&o.jsx(z,{color:"red"}),e.showCompletion&&o.jsx(E,{sizeMultiplier:e.sizeMultiplier,radialSegments:32}),e.showCasings&&o.jsx(_,{shoeFactor:e.shoeFactor,opacity:e.casingOpacity,sizeMultiplier:e.sizeMultiplier,radialSegments:64}),e.showPerimeter&&o.jsx(R,{radius:e.perimeterRadius,from:e.perimeterFrom,to:e.perimeterTo}),o.jsx(I,{sizeMultiplier:e.sizeMultiplier}),o.jsx(u,{}),o.jsx(g,{})]}),o.jsxs(k,{children:[o.jsx(h,{id:"casings",name:"Casings",anchorOcclusionRadius:30,visible:e.showCasingAnnotations,anchorColor:"#8ad5e7",anchorSize:5,connectorColor:"#70878d",connectorWidth:2,distanceFactor:150,labelComponent:G,labelOffset:150,minDistance:10,maxDistance:5e3,priority:10,onClick:t=>{dispatchEvent(new f({point:t.position,distance:300}))}}),o.jsx(h,{id:"completion",name:"Completion",priority:1,anchorSize:4,visible:e.showCompletionAnnotations,distanceFactor:150,labelOffset:50,minDistance:10,maxDistance:2e3,anchorOcclusionRadius:30,onClick:t=>{dispatchEvent(new f({point:t.position,distance:200}))}})]})]})),parameters:{scale:100}};var y,C,x;p.parameters={...p.parameters,docs:{...(y=p.parameters)==null?void 0:y.docs,source:{originalSource:`{
  args: {
    id: wellboreId,
    sizeMultiplier: 10,
    segmentsPerMeter: 0.1,
    showTrajectory: true,
    showCompletion: true,
    showCompletionAnnotations: true,
    showCasings: true,
    showCasingAnnotations: true,
    showPerimeter: false,
    casingOpacity: 0.7,
    shoeFactor: 1.5,
    perimeterRadius: 10,
    perimeterFrom: 1000,
    perimeterTo: 10000,
    fromMsl: 0
  },
  argTypes: {
    id: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: {
        type: 'select',
        labels: storyArgs.wellboreOptions
      }
    },
    fromMsl: {
      control: {
        type: 'range',
        min: 0,
        max: 5000,
        step: 1
      }
    },
    sizeMultiplier: {
      control: {
        type: 'range',
        min: 1,
        max: 10,
        step: 1
      }
    },
    casingOpacity: {
      control: {
        type: 'range',
        min: 0.1,
        max: 1,
        step: 0.1
      }
    },
    segmentsPerMeter: {
      control: {
        type: 'range',
        min: 0.1,
        max: 20,
        step: 0.1
      }
    },
    simplificationThreshold: {
      control: {
        type: 'range',
        min: 0,
        max: 0.0001,
        step: 0.000001
      }
    },
    shoeFactor: {
      control: {
        type: 'range',
        min: 1,
        max: 2,
        step: 0.1
      }
    },
    perimeterRadius: {
      control: {
        type: 'range',
        min: 1,
        max: 50,
        step: 1
      }
    },
    perimeterFrom: {
      control: {
        type: 'range',
        min: 0,
        max: 10000,
        step: 1
      }
    },
    perimeterTo: {
      control: {
        type: 'range',
        min: 0,
        max: 10000,
        step: 1
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
    console.log(args.id);
    return <>\r
        <Wellbore {...args}>\r
          {args.showTrajectory && <BasicTrajectory color="red" />}\r
          {args.showCompletion && <CompletionTools sizeMultiplier={args.sizeMultiplier} radialSegments={32} />}\r
          {args.showCasings && <Casings shoeFactor={args.shoeFactor} opacity={args.casingOpacity} sizeMultiplier={args.sizeMultiplier} radialSegments={64} />}\r
          {args.showPerimeter && <Perimeter radius={args.perimeterRadius} from={args.perimeterFrom} to={args.perimeterTo} />}\r
          <Perforations sizeMultiplier={args.sizeMultiplier} />\r
          <CasingAnnotations />\r
          <CompletionAnnotations />\r
        </Wellbore>\r
        <Annotations>\r
          <AnnotationsLayer id='casings' name='Casings' anchorOcclusionRadius={30} visible={args.showCasingAnnotations} anchorColor='#8ad5e7' anchorSize={5} connectorColor='#70878d' connectorWidth={2} distanceFactor={150} labelComponent={CasingLabel} labelOffset={150} minDistance={10} maxDistance={5000} priority={10} onClick={(annotation: AnnotationComponentProps) => {
          dispatchEvent(new CameraFocusAtPointEvent({
            point: annotation.position,
            distance: 300
          }));
        }} />\r
          <AnnotationsLayer id="completion" name="Completion" priority={1} anchorSize={4} visible={args.showCompletionAnnotations} distanceFactor={150} labelOffset={50} minDistance={10} maxDistance={2000} anchorOcclusionRadius={30} onClick={(annotation: AnnotationComponentProps) => {
          dispatchEvent(new CameraFocusAtPointEvent({
            point: annotation.position,
            distance: 200
          }));
        }} />\r
        </Annotations>\r
      </>;
  },
  parameters: {
    scale: 100
  }
}`,...(x=(C=p.parameters)==null?void 0:C.docs)==null?void 0:x.source}}};const he=["Default"];export{p as Default,he as __namedExportsOrder,fe as default};
