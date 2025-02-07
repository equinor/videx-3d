import{j as e}from"./jsx-runtime-CmIOflP4.js";import{A as m,u as d,a as p,b as l}from"./AnnotationsLayer-Dj29EBht.js";import{C as f}from"./canvas-3d-decorator-DXFES1_8.js";import{r as u}from"./index-KqYmeiyw.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";import"./CameraManager-BTlj_2qD.js";import"./uv-material-Cw8kPkQB.js";import"./limiter-DhBcc_yH.js";import"./react-Mgt78q4a.js";import"./numbers-DM6OWwIG.js";const c=1e3,n=new Array(c);for(let o=0;o<n.length;o++)n[o]={id:o.toString(),name:"Annotation #"+o,position:[(Math.random()-.5)*100,(Math.random()-.5)*100,(Math.random()-.5)*100]};const D={title:"Components/Misc/Annotations",component:m,loaders:[()=>{d.getState().clear()}]},t={args:{maxVisible:c},render:o=>{const{addAnnotations:a}=p("layer1","scope1");return u.useEffect(()=>a(n),[a]),e.jsx(m,{...o,children:e.jsx(l,{id:"layer1",name:"Test",anchorSize:2,labelOffset:15})})},decorators:[f]};var r,s,i;t.parameters={...t.parameters,docs:{...(r=t.parameters)==null?void 0:r.docs,source:{originalSource:`{
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
}`,...(i=(s=t.parameters)==null?void 0:s.docs)==null?void 0:i.source}}};const M=["Default"];export{t as Default,M as __namedExportsOrder,D as default};
