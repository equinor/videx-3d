import{j as k}from"./jsx-runtime-CmIOflP4.js";import{P as L,a as et,b as X,u as st,C as ot}from"./canvas-3d-decorator-DXFES1_8.js";import{b as H,j as nt,k as F,d as at,n as W,a as it,c as lt,r as ct,y as J,T as Y,V as rt,z as ut,G as pt,J as ft,L as mt}from"./CameraManager-BTlj_2qD.js";import{c as ht,g as dt}from"./curve-3d-BSYPmKD_.js";import{r as R}from"./index-KqYmeiyw.js";import{P as vt}from"./performance-decorator-bIdhsxLH.js";import"./Text-DbK8u8Ip.js";import"./client-CjwNmqqA.js";import"./index-DVFv-Saw.js";function gt(e,t,l){return(1-l)*e+l*t}function xt(e,t){let l=t.findIndex(m=>m[0]>e);l===-1&&(l=t.length-1);let r=l-1;r<0&&(r=0);const a=t[r],n=t[l];return[a,n]}function V(e,t,l){if(t[0]===l[0])return l[1];const r=l[0]-t[0],a=H((e-t[0])/r,0,1);return gt(t[1],l[1],a)}function yt(e,t,l,r,a,n,m,h){const u=[];if(t==="none"||n.length===0)u.push([l,a],[r,a]);else{let d=[0,a],o=[1,a];const s=n.findIndex(i=>i[0]>l);s===-1?d=n[n.length-1]:(s>0&&(d=n[s-1]),o=n[s]);const p=t==="linear"?V(l,d,o):d[1];u.push([l,p]);for(let i=s;i>=0&&i<n.length;i++){const c=n[i];if(c[0]<r)u.push(c);else{t==="linear"?u.push([r,V(r,u[u.length-1],c)]):u.push([r,u[u.length-1][1]]);break}}u[u.length-1][0]<r&&(t==="linear"?u.push([r,V(r,u[u.length-1],[1,a])]):u.push([r,u[u.length-1][1]]))}const b=e.length,g=[];for(let d=0;d<u.length-1;d++){const o=d+1,[s,p]=u[d],[i,c]=u[o],v=i-s,y=v*b,M=c-p,C=Math.atan2(M,y),P=Math.floor(m*y),w=v/P;g.push([s,p,t==="linear"?C:0]);let E=h?e.getTangentAt(s):null;for(let G=1;G<P;G++){const f=s+G*w,j=h?e.getTangentAt(f):null;if(!h||Math.abs(at(E,j))<1-h){const[N,T]=xt(f,u),B=t==="linear"?V(f,N,T):N[1];g.push([f,B,t==="linear"?C:0]),E=j}}if(o<u.length){if(t==="linear")g.push([i,c,t==="linear"?C:0]);else if(t==="stepped"){const G=C<0?-L/2:L/2;g.push([i,p,0],[i,p,G],[i,c,G])}}o===u.length-1&&t==="none"&&g.push([i,c,C])}const x=ht(e,g.map(d=>d[0]));return g.map((d,o)=>({radius:d[1],theta:d[2],...x[o]}))}function K(e,t,l=!0,r,a=0){let n=0,m=0;const h=[],u=[],b=r.computeNormals?[]:null,g=r.computeUvs?[]:null,x=[0,0,0],d=l?[-e.tangent[0],-e.tangent[1],-e.tangent[2]]:e.tangent;h.push(...e.position),n++,b&&b.push(...d),g&&g.push(.5,.5);for(let o=0;o<=t;o++){const s=o/t*L*2,p=Math.sin(s),i=-Math.cos(s);if(W([i*e.normal[0]+p*e.binormal[0],i*e.normal[1]+p*e.binormal[1],i*e.normal[2]+p*e.binormal[2]],x),h.push(e.position[0]+e.radius*x[0],e.position[1]+e.radius*x[1],e.position[2]+e.radius*x[2]),n++,b&&b.push(...d),g){const c=[(i+1)/2,(p+1)/2];l&&(c[0]=1-c[0]),g.push(...c)}}for(let o=1;o<=t;o++){let p,i;l?(p=o+0,i=o+0+1):(p=o+0+1,i=o+0),u.push(p+a,i+a,0+a),m+=3}return{vertices:h,indices:u,normals:b,uvs:g,vertexCount:n,indexCount:m}}function $(e,t,l,r=!0,a,n=0){let m=0,h=0;const u=[],b=[],g=a.computeNormals?[]:null,x=a.computeUvs?[]:null,d=[0,0,0],o=r?[-e.tangent[0],-e.tangent[1],-e.tangent[2]]:e.tangent,s=t.radius/e.radius;for(let p=0;p<=l;p++){const i=p/l*L*2,c=Math.sin(i),v=-Math.cos(i);if(W([v*e.normal[0]+c*e.binormal[0],v*e.normal[1]+c*e.binormal[1],v*e.normal[2]+c*e.binormal[2]],d),u.push(e.position[0]+e.radius*d[0],e.position[1]+e.radius*d[1],e.position[2]+e.radius*d[2]),m++,u.push(t.position[0]+t.radius*d[0],t.position[1]+t.radius*d[1],t.position[2]+t.radius*d[2]),m++,g&&g.push(...o,...o),x){const y=[(v+1)/2,(c+1)/2],M=[(v*s+1)/2,(c*s+1)/2];r&&(y[0]=1-y[0],M[0]=1-M[0]),x.push(...y,...M)}}for(let p=0;p<l;p++){const i=p*2,c=i+1,v=i+2,y=i+3;r?b.push(i+n,v+n,c+n,c+n,v+n,y+n):b.push(v+n,i+n,c+n,c+n,y+n,v+n),h+=6}return{vertices:u,indices:b,normals:g,uvs:x,vertexCount:m,indexCount:h}}function q(e,t,l,r,a=0){let n=0,m=0;const h=[],u=[],b=r.computeNormals?[]:null,g=r.computeUvs?[]:null,x=[0,0,0],d=o=>{for(let s=0;s<=t;s++){const p=s/t*L*2,i=Math.sin(p),c=-Math.cos(p);W([c*o.normal[0]+i*o.binormal[0],c*o.normal[1]+i*o.binormal[1],c*o.normal[2]+i*o.binormal[2]],x);const v=[o.position[0]+o.radius*x[0],o.position[1]+o.radius*x[1],o.position[2]+o.radius*x[2]];if(b){const y=it(x);if(o.theta){const M=W(lt(o.tangent,x));ct(x,M,o.theta,y)}b.push(...y)}h.push(...v),n++}};for(let o=0;o<e.length;o++)d(e[o]);if(l&&d(e[0]),g)for(let o=0;o<e.length;o++)for(let s=0;s<=t;s++)g.push(e[o].curvePosition,s/t);for(let o=1;o<e.length;o++)for(let s=1;s<=t;s++){const p=(t+1)*(o-1)+(s-1),i=(t+1)*o+(s-1),c=(t+1)*o+s,v=(t+1)*(o-1)+s;u.push(p+a,i+a,v+a),u.push(i+a,c+a,v+a),m+=6}return{vertices:h,indices:u,normals:b,uvs:g,vertexCount:n,indexCount:m}}function bt(e,t={}){var E,G;const l=H(t.from||0,0,1),r=H(t.to||1);if(r<l)throw Error('Value of "from" must be less than the value of "to"!');const a=new nt,n=t.radius||1,m=((E=t.radiusModifier)==null?void 0:E.steps)||[],h=t.radialSegments||8,u=t.startCap||!1,b=t.endCap||!1,g=e.closed;m.sort((f,j)=>f[0]-j[0]);const x=t.segmentsPerMeter||.1,d=((G=t.radiusModifier)==null?void 0:G.type)||"none",o=H(t.simplificationThreshold||0,0,1),s=yt(e,d,l,r,n,m,x,o),p=q(s,h,g,t);let i=null,c=null,v=null,y=p.vertexCount,M=0;t.addGroups&&(a.addGroup(M,p.indexCount,a.groups.length),M+=p.indexCount);let C=null;(t.innerRadius||t.thickness)&&(C=s.map(f=>({...f,radius:t.innerRadius||f.radius-t.thickness,theta:f.theta-L})),i=q(C,h,g,t,y),y+=i.vertexCount,t.addGroups&&(a.addGroup(M,i.indexCount,a.groups.length),M+=i.indexCount)),u&&(!g||l>0||r<1)&&(C?c=$(s[0],C[0],h,!0,t,y):c=K(s[0],h,!0,t,y),y+=c.vertexCount,t.addGroups&&(a.addGroup(M,c.indexCount,a.groups.length),M+=c.indexCount)),b&&(!g||l>0||r<1)&&(C?v=$(s[s.length-1],C[C.length-1],h,!1,t,y):v=K(s[s.length-1],h,!1,t,y),y+=v.vertexCount,t.addGroups&&(a.addGroup(M,v.indexCount,a.groups.length),M+=v.indexCount));let P=p.vertices,w=p.indices;if(i&&(P=P.concat(i.vertices),w=w.concat(i.indices.reverse())),c&&(P=P.concat(c.vertices),w=w.concat(c.indices)),v&&(P=P.concat(v.vertices),w=w.concat(v.indices)),a.setAttribute("position",new F(Float32Array.from(P),3)),t.computeNormals){let f=p.normals;i&&(f=f.concat(i.normals)),c&&(f=f.concat(c.normals)),v&&(f=f.concat(v.normals)),a.setAttribute("normal",new F(Float32Array.from(f),3))}if(t.computeLengths||t.computeCurveNormals||t.computeCurveTangents||t.computeCurveBinormals){const f=t.computeLengths?[]:null,j=t.computeCurveNormals?[]:null,N=t.computeCurveTangents?[]:null,T=t.computeCurveBinormals?[]:null,B=e.length;for(let A=0;A<s.length;A++)for(let z=0;z<=h;z++)f&&f.push(s[A].curvePosition*B),j&&j.push(...s[A].normal),N&&N.push(...s[A].tangent),T&&T.push(...s[A].binormal);if(i&&C)for(let A=0;A<C.length;A++)for(let z=0;z<=h;z++)f&&f.push(C[A].curvePosition*B),j&&j.push(...C[A].normal),N&&N.push(...C[A].tangent),T&&T.push(...C[A].binormal);if(c)for(let A=0;A<c.vertexCount;A++)f&&f.push(0),j&&j.push(...s[0].normal),N&&N.push(...s[0].tangent),T&&T.push(...s[0].binormal);if(v)for(let A=0;A<v.vertexCount;A++)f&&f.push(B),j&&j.push(...s[s.length-1].normal),N&&N.push(...s[s.length-1].tangent),T&&T.push(...s[s.length-1].binormal);f&&a.setAttribute("curveLength",new F(Float32Array.from(f),1)),j&&a.setAttribute("curveNormal",new F(Float32Array.from(j),3)),N&&a.setAttribute("curveTangent",new F(Float32Array.from(N),3)),T&&a.setAttribute("curveBinormal",new F(Float32Array.from(T),3))}if(t.computeUvs){let f=p.uvs;i&&(f=f.concat(i.uvs)),c&&(f=f.concat(c.uvs)),v&&(f=f.concat(v.uvs)),a.setAttribute("uv",new F(Float32Array.from(f),2))}return a.setIndex(new F(Uint32Array.from(w),1)),a}const D=e=>e===Object(e)&&!Array.isArray(e)&&typeof e!="function";function Z(e,t){const l=et(n=>n.gl),r=X(Y,D(e)?Object.values(e):e);return R.useLayoutEffect(()=>{t==null||t(r)},[t]),R.useEffect(()=>{if("initTexture"in l){let n=[];Array.isArray(r)?n=r:r instanceof J?n=[r]:D(r)&&(n=Object.values(r)),n.forEach(m=>{m instanceof J&&l.initTexture(m)})}},[l,r]),R.useMemo(()=>{if(D(e)){const n={};let m=0;for(const h in e)n[h]=r[m++];return n}else return r},[e,r])}Z.preload=e=>X.preload(Y,e);Z.clear=e=>X.clear(Y,e);function Ct(e,t,...l){const r=R.useRef(),a=et(n=>n.scene);return R.useLayoutEffect(()=>{let n;if(e&&e!=null&&e.current&&t&&(r.current=n=new t(e.current,...l)),n)return n.traverse(m=>m.raycast=()=>null),a.add(n),()=>{r.current=void 0,a.remove(n),n.dispose==null||n.dispose()}},[a,t,e,...l]),st(()=>{var n;return void((n=r.current)==null||n.update==null?void 0:n.update())}),r}const At=({type:e,args:t=[]})=>{const l=R.useRef(null),r=R.useRef(null);return R.useLayoutEffect(()=>{r.current=l.current.parent}),Ct(r,e,...t),R.createElement("object3D",{ref:l})},I=new rt,U=new rt,Q=new ut;class Mt extends pt{constructor(t,l=1,r=16711680){const a=new nt,n=t.geometry.attributes.normal.count,m=new ft(n*2*3,3);a.setAttribute("position",m),super(a,new mt({color:r,toneMapped:!1})),this.object=t,this.size=l,this.type="VertexNormalsHelper",this.matrixAutoUpdate=!1,this.isVertexNormalsHelper=!0,this.update()}update(){this.object.updateMatrixWorld(!0),Q.getNormalMatrix(this.object.matrixWorld);const t=this.object.matrixWorld,l=this.geometry.attributes.position,r=this.object.geometry;if(r){const a=r.attributes.position,n=r.attributes.normal;let m=0;for(let h=0,u=a.count;h<u;h++)I.fromBufferAttribute(a,h).applyMatrix4(t),U.fromBufferAttribute(n,h),U.applyMatrix3(Q).normalize().multiplyScalar(this.size).add(I),l.setXYZ(m,I.x,I.y,I.z),m=m+1,l.setXYZ(m,U.x,U.y,U.z),m=m+1}l.needsUpdate=!0}dispose(){this.geometry.dispose(),this.material.dispose()}}const jt=[[0,0,0],[1,-1,1],[1,-2,2],[1.2,-3,1],[2,-5,5],[10,-5,4.5],[12,-5,7.5],[10,-4.8,10]],Nt=({radius:e,innerRadius:t,thickness:l,showWireframe:r,showNormals:a,closed:n,radiusModificationType:m,segmentsPerMeter:h,radialSegments:u,simplificationThreshold:b,to:g,from:x})=>{const[d,o]=R.useState(null);return R.useEffect(()=>{const s=dt(jt,n);if(s){const p={from:x,to:g,radius:e,segmentsPerMeter:h,radialSegments:u,computeNormals:!0,computeLengths:!0,computeUvs:!0,computeCurveNormals:!1,computeCurveTangents:!1,computeCurveBinormals:!1,startCap:!0,endCap:!0,thickness:l,innerRadius:t,simplificationThreshold:b,addGroups:!1};m!=="none"&&(p.radiusModifier={type:m,steps:[[0,e*2],[.05,e*2],[.1,e],[.9,e],[.95,e*2],[1,e*2]]});const i=bt(s,p);o(c=>(c&&c.dispose(),i))}},[e,n,m,b,h,u,g,x,t,l]),Z("uv_grid.jpg"),d?k.jsxs("mesh",{geometry:d,children:[k.jsx("meshStandardMaterial",{wireframe:r,color:"#999",metalness:1,roughness:.25,map:null}),a&&k.jsx(At,{type:Mt,args:[.2*e,13369344]})]}):null},zt={title:"SDK/tube-geometry",component:Nt},_={args:{radius:.25,segmentsPerMeter:10,radialSegments:16,simplificationThreshold:0,radiusModificationType:"none",innerRadius:0,thickness:0,from:0,to:1,closed:!1,showNormals:!1,showWireframe:!1},argTypes:{radius:{control:{type:"range",min:.01,max:1,step:.001}},segmentsPerMeter:{control:{type:"range",min:1,max:50,step:1}},radialSegments:{control:{type:"range",min:4,max:64,step:1}},radiusModificationType:{options:["none","linear","stepped"],control:{type:"select"}},simplificationThreshold:{control:{type:"range",min:0,max:.001,step:1e-6}},from:{control:{type:"range",min:0,max:1,step:1e-6}},to:{control:{type:"range",min:0,max:1,step:1e-6}},innerRadius:{control:{type:"range",min:0,max:1,step:.001}},thickness:{control:{type:"range",min:0,max:1,step:.001}}},decorators:[vt,ot],parameters:{scale:2}};var O,S,tt;_.parameters={..._.parameters,docs:{...(O=_.parameters)==null?void 0:O.docs,source:{originalSource:`{
  args: {
    radius: 0.25,
    segmentsPerMeter: 10,
    radialSegments: 16,
    simplificationThreshold: 0,
    radiusModificationType: 'none',
    innerRadius: 0,
    thickness: 0,
    from: 0,
    to: 1,
    closed: false,
    showNormals: false,
    showWireframe: false
  },
  argTypes: {
    radius: {
      control: {
        type: 'range',
        min: 0.01,
        max: 1,
        step: 0.001
      }
    },
    segmentsPerMeter: {
      control: {
        type: 'range',
        min: 1,
        max: 50,
        step: 1
      }
    },
    radialSegments: {
      control: {
        type: 'range',
        min: 4,
        max: 64,
        step: 1
      }
    },
    radiusModificationType: {
      options: ['none', 'linear', 'stepped'],
      control: {
        type: 'select'
      }
    },
    simplificationThreshold: {
      control: {
        type: 'range',
        min: 0,
        max: 0.001,
        step: 0.000001
      }
    },
    from: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.000001
      }
    },
    to: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.000001
      }
    },
    innerRadius: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.001
      }
    },
    thickness: {
      control: {
        type: 'range',
        min: 0,
        max: 1,
        step: 0.001
      }
    }
  },
  decorators: [PerformanceDecorator, Canvas3dDecorator],
  parameters: {
    scale: 2
  }
}`,...(tt=(S=_.parameters)==null?void 0:S.docs)==null?void 0:tt.source}}};const It=["Default"];export{_ as Default,It as __namedExportsOrder,zt as default};
