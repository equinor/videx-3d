import{j as r}from"./jsx-runtime-CmIOflP4.js";import{A as m,u as p,a as d,b as l}from"./AnnotationsLayer-CAyRgV7V.js";import{C as f}from"./canvas-3d-decorator-BhyssXtK.js";import{r as u}from"./index-KqYmeiyw.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./CameraManager-BuezL_By.js";import"./index.esm-BMr5xbKZ.js";import"./index-BsNHLAmC.js";import"./uv-material-DyQCcDTL.js";import"./layers-DoaKWXpU.js";import"./limiter-DhBcc_yH.js";import"./react-Mgt78q4a.js";import"./numbers-DM6OWwIG.js";const c=1e3,n=new Array(c);for(let o=0;o<n.length;o++)n[o]={id:o.toString(),name:"Annotation #"+o,position:[(Math.random()-.5)*100,(Math.random()-.5)*100,(Math.random()-.5)*100]};const z={title:"Components/Misc/Annotations",component:m,loaders:[()=>{p.getState().clear()}]},t={args:{maxVisible:c},render:o=>{const{addAnnotations:a}=d("layer1","scope1");return u.useEffect(()=>a(n),[a]),r.jsx(m,{...o,children:r.jsx(l,{id:"layer1",name:"Test",anchorSize:2,labelOffset:15})})},decorators:[f]};var e,s,i;t.parameters={...t.parameters,docs:{...(e=t.parameters)==null?void 0:e.docs,source:{originalSource:`{
  args: {
    maxVisible: count
  },
  render: (args: ComponentProps<typeof Annotations>) => {
    const {
      addAnnotations
    } = useAnnotations('layer1', 'scope1');
    useEffect(() => addAnnotations(annotations), [addAnnotations]);
    return <Annotations {...args}>\r
        <AnnotationsLayer id="layer1" name="Test" anchorSize={2} labelOffset={15}
      //labelComponent={({ name }) => (<div style={{ color: 'lime'}}>{name}</div>)}
      />\r
      </Annotations>;
  },
  decorators: [Canvas3dDecorator]
}`,...(i=(s=t.parameters)==null?void 0:s.docs)==null?void 0:i.source}}};const L=["Default"];export{t as Default,L as __namedExportsOrder,z as default};
