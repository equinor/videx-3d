import{j as t}from"./jsx-runtime-CmIOflP4.js";import{g as ae,D as le}from"./data-provider-decorator-BCAx_xlJ.js";import{u as oe,a as te,l as ne,n as ce,W as M,o as ie,b as _,c as G}from"./WellMapCasingShoes-wrjAVth2.js";import{r as p}from"./index-KqYmeiyw.js";import{s as pe}from"./story-args-Cgt5gSNS.js";import"./curve-3d-BSYPmKD_.js";import"./CameraManager-BTlj_2qD.js";import"./numbers-DM6OWwIG.js";import"./uv-material-Cw8kPkQB.js";import"./limiter-DhBcc_yH.js";import"./react-Mgt78q4a.js";const L=({color:r="rgb(113, 216, 253)"})=>{const a=oe(),[c,y]=p.useState(null),n=te(),i=n(o=>o.tracksOrder),h=n(o=>o.depth),W=n(o=>o.measures.ratio),w=n(o=>o.measures.trackWidth),C=n(o=>o.measures.svgHeight),S=n(o=>o.measures.getSlotPosition);p.useEffect(()=>{if(a){const o=i.map(d=>a.get("position-logs",d));Promise.all(o).then(d=>{const u=d.reduce((e,s,l)=>({...e,[i[l]]:ae(i[l],s)}),{});y(u)})}},[i,a]);const j=p.useMemo(()=>{const o=[];return c&&i.forEach((d,u)=>{const s=[S(u),null];if(h!==void 0&&c[d]){const l=c[d].getPointAtDepth(h,!1);if(l){const x=-l[1];s[1]=x}}o.push(s)}),o},[h,S,i,c]),g=p.useMemo(()=>C-W*15,[W,C]);return!j||w<50?null:t.jsxs("g",{children:[t.jsx("text",{style:{fontSize:"12px"},fill:r,fillOpacity:.75,x:-30,y:g,textAnchor:"left",alignmentBaseline:"after-edge",children:"TVD:"}),t.jsx("text",{style:{fontSize:"10px"},fill:r,fillOpacity:.5,x:-30,y:g+10,textAnchor:"left",alignmentBaseline:"after-edge",children:"(Msl)"}),j.map(o=>t.jsx("text",{style:{fontSize:"12px"},fill:r,fillOpacity:o[1]===null?.5:1,alignmentBaseline:"after-edge",textAnchor:"middle",x:o[0],y:g,children:o[1]!==null&&o[1].toFixed(1)+"m"||"---"},o.toString()))]})};try{L.displayName="WellMapTvd",L.__docgenInfo={description:"TVD depth display addon for `WellMap`",displayName:"WellMapTvd",props:{color:{defaultValue:{value:"rgb(113, 216, 253)"},description:"",name:"color",required:!1,type:{name:"string | undefined"}}}}}catch{}const R=({formations:r})=>{const a=oe(),[c,y]=p.useState(null),n=te(),i=n(e=>e.wellboreIds),h=n(e=>e.wellboresById),W=n(e=>e.domain),w=n(e=>e.measures.range),C=n(e=>e.measures.ratio),S=n(e=>e.slotsById),j=n(e=>e.styles),g=n(e=>e.measures.getSlotPosition),o=p.useMemo(()=>ne().domain(W).range(w),[W,w]);p.useEffect(()=>{if(a){const e=i.map(s=>a.get("picks",s));Promise.all(e).then(s=>{if(s){const l=s.reduce((x,A,E)=>({...x,[i[E]]:A!==null?A.sort((D,T)=>D.mdMsl-T.mdMsl):[]}),{});y(l)}})}},[i,a]);const d=p.useMemo(()=>{const e=[];return c&&i.forEach(s=>{if(c[s]){const l=h[s],x=l.kickoffDepthMsl!==null?l.kickoffDepthMsl:l.depthReferenceElevation,A=S[s],E=g(A);r.forEach(D=>{c[s].filter(m=>m.mdMsl<=l.depthMdMsl&&m.name===`${D} Top`).forEach(m=>{let I=c[s].find(f=>f.mdMsl>m.mdMsl&&f.name===`${D} Base`);I||(I=c[s].find(f=>f.level<=m.level&&f.mdMsl>m.mdMsl));const H=Math.min(l.depthMdMsl,I?I.mdMsl:l.depthMdMsl);if(H>x){const f=Math.max(x,m.mdMsl),re={id:ce(),formation:D,color:m.color,level:m.level,x:E,y1:o(f),y2:o(H)};e.push(re)}})})}}),e.sort((s,l)=>s.x-l.x||s.y1-l.y1||s.level-l.level),e},[c,r,o,g,S,i,h]),u=p.useMemo(()=>{const e=j.darkMode?0:240;return`rgba(${e}, ${e}, ${e}, .9)`},[j.darkMode]);return d?t.jsx("g",{children:d.map(e=>{const s=C*(35-e.level*4);return t.jsxs("g",{style:{cursor:"help",filter:`drop-shadow( 1px 1px 2px ${u})`,pointerEvents:"bounding-box"},children:[t.jsx("title",{children:e.formation}),t.jsx("rect",{x:e.x-s/2,y:e.y1,width:s,rx:s*.05,ry:s*.05,height:Math.max(1,e.y2-e.y1),fill:e.color,fillOpacity:.1,stroke:e.color,strokeWidth:.5,strokeOpacity:.75,style:{filter:`drop-shadow( 1px 1px 2px ${u})`}}),t.jsx("line",{x1:e.x-s*1.5/2,x2:e.x+s*1.5/2,y1:e.y1,y2:e.y1,stroke:e.color,strokeWidth:1.5,strokeOpacity:1,style:{filter:`drop-shadow( 1px 1px 2px ${u})`}})]},e.id)})}):null};try{R.displayName="WellMapFormations",R.__docgenInfo={description:"Formations addon for `WellMap`",displayName:"WellMapFormations",props:{formations:{defaultValue:null,description:"",name:"formations",required:!0,type:{name:"string[]"}}}}}catch{}const je={title:"Components/Html/WellMap",component:M,args:{wellIdentifier:pe.defaultWell},decorators:[(r,{args:a})=>{const[c,y]=p.useState(1),[n,i]=p.useState();return t.jsx("div",{style:{padding:"10px",boxSizing:"border-box",minHeight:"1000px",height:"100%",width:"100%",maxWidth:"600px",display:"inline-flex",flexDirection:"column",flexWrap:"wrap",color:"white",background:"#333"},children:t.jsx(r,{args:{...a,depth:c,onDepthChanged:y,selected:n,onSelect:i}})})},le]},P=ie(["#4e79a7","#f28e2c","#76b7b2","#59a14f","#edc949","#af7aa1","#ff9da7","#9c755f","#bab0ab","darkgreen","purple","#24ca85"]),b={tags:["autodocs"],render:r=>t.jsx(M,{...r,colors:a=>P(a.id)})},k={render:r=>t.jsxs(M,{...r,colors:a=>P(a.id),children:[t.jsx(_,{}),t.jsx(G,{})]})},N={render:r=>{const a=p.useMemo(()=>["NORDLAND GP.","HORDALAND GP.","ROGALAND GP.","SHETLAND GP.","CROMER KNOLL GP.","VIKING GP."],[]);return t.jsxs(M,{...r,colors:c=>P(c.id),children:[t.jsx(R,{formations:a}),t.jsx(_,{}),t.jsx(G,{}),t.jsx(L,{})]})}},v={tags:["autodocs"],render:r=>t.jsxs(M,{...r,colors:a=>P(a.id),interactive:!1,children:[t.jsx(_,{}),t.jsx(G,{})]})},O={tags:["autodocs"],render:r=>t.jsxs(M,{...r,colors:a=>P(a.id),headless:!0,depthCursor:!1,children:[t.jsx(_,{}),t.jsx(G,{})]})};var B,$,F;b.parameters={...b.parameters,docs:{...(B=b.parameters)==null?void 0:B.docs,source:{originalSource:`{
  tags: ['autodocs'],
  render: (args: ComponentProps<typeof WellMap>) => {
    return <WellMap {...args} colors={w => colorScale(w.id)} />;
  }
}`,...(F=($=b.parameters)==null?void 0:$.docs)==null?void 0:F.source}}};var V,z,K;k.parameters={...k.parameters,docs:{...(V=k.parameters)==null?void 0:V.docs,source:{originalSource:`{
  render: (args: ComponentProps<typeof WellMap>) => {
    return <WellMap {...args} colors={w => colorScale(w.id)}>\r
        <WellMapCompletionIntervals />\r
        <WellMapCasingShoes />\r
      </WellMap>;
  }
}`,...(K=(z=k.parameters)==null?void 0:z.docs)==null?void 0:K.source}}};var q,J,Q;N.parameters={...N.parameters,docs:{...(q=N.parameters)==null?void 0:q.docs,source:{originalSource:`{
  render: (args: ComponentProps<typeof WellMap>) => {
    const formations = useMemo(() => ['NORDLAND GP.', 'HORDALAND GP.', 'ROGALAND GP.', 'SHETLAND GP.', 'CROMER KNOLL GP.', 'VIKING GP.'], []);
    return <WellMap {...args} colors={w => colorScale(w.id)}>\r
        <WellMapFormations formations={formations} />\r
        <WellMapCompletionIntervals />\r
        <WellMapCasingShoes />\r
        <WellMapTvd />\r
      </WellMap>;
  }
}`,...(Q=(J=N.parameters)==null?void 0:J.docs)==null?void 0:Q.source}}};var U,X,Y;v.parameters={...v.parameters,docs:{...(U=v.parameters)==null?void 0:U.docs,source:{originalSource:`{
  tags: ['autodocs'],
  render: (args: ComponentProps<typeof WellMap>) => {
    return <WellMap {...args} colors={w => colorScale(w.id)} interactive={false}>\r
        <WellMapCompletionIntervals />\r
        <WellMapCasingShoes />\r
      </WellMap>;
  }
}`,...(Y=(X=v.parameters)==null?void 0:X.docs)==null?void 0:Y.source}}};var Z,ee,se;O.parameters={...O.parameters,docs:{...(Z=O.parameters)==null?void 0:Z.docs,source:{originalSource:`{
  tags: ['autodocs'],
  render: (args: ComponentProps<typeof WellMap>) => {
    return <WellMap {...args} colors={w => colorScale(w.id)} headless depthCursor={false}>\r
        <WellMapCompletionIntervals />\r
        <WellMapCasingShoes />\r
      </WellMap>;
  }
}`,...(se=(ee=O.parameters)==null?void 0:ee.docs)==null?void 0:se.source}}};const De=["Default","WithCasingAndCompletionIntervals","WithAllAddons","NonInteractive","Headless"];export{b as Default,O as Headless,v as NonInteractive,N as WithAllAddons,k as WithCasingAndCompletionIntervals,De as __namedExportsOrder,je as default};
