import{u as M,v as T,W as x,N as D,h as F,O as U,Q as B,K as P,y as S,X as k}from"./CameraManager-BuezL_By.js";import{L as _}from"./layers-DoaKWXpU.js";const G=new M({depthPacking:T}),m=255/256,h=new Float32Array([m,m/256,m/256**2,m/256**3]);function N(e,r,l,a){return e/255*h[0]+r/255*h[1]+l/255*h[2]+a/255*h[3]}let i=null,p=null,f=null;async function Q(e,r,l,a,n){const v=l.layers.mask;if(l.layers.disableAll(),l.layers.set(_.OCCLUDER),(!i||i.width!==a||i.height!==n)&&(i==null||i.dispose(),p=new Uint8Array(4*a*n),f=new Float32Array(a*n),i=new x(a,n,{type:D})),e.setRenderTarget(i),r.overrideMaterial=G,e.clear(),e.render(r,l),r.overrideMaterial=null,e.setRenderTarget(null),l.layers.mask=v,await e.readRenderTargetPixelsAsync(i,0,0,a,n,p),p&&f)for(let o=0;o<f.length;o++){const s=o*4,u=N(p[s],p[s+1],p[s+2],p[s+3]);f[o]=u*2-1}return f}var C=`#include <common>

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,L=`#include <common>
#include <packing>

varying vec2 vUv;
uniform sampler2D depthTexture;
uniform float cameraFar;
uniform float cameraNear;

float linearizeDepth(in float depth) {
    float a = cameraFar / (cameraFar - cameraNear);
  float b = cameraFar * cameraNear / (cameraNear - cameraFar);
  return a + b / depth;
}

float reconstructDepth(const in float depth) {
  return pow(2.0, depth * log2(cameraFar + 1.0)) - 1.0;
}

float getDepth(vec2 uv) {
  float depth = texture2D(depthTexture, uv).x;
  #if defined( USE_LOGDEPTHBUF )
      return linearizeDepth(reconstructDepth(depth));
  #else
      return texture2D(depthTexture, uv).x;
  #endif
}

void main() {
	gl_FragColor = packDepthToRGBA(getDepth(vUv));
}`;class b extends F{constructor(){super({vertexShader:C,fragmentShader:L,uniforms:{cameraNear:{value:0},cameraFar:{value:1},depthTexture:{value:null},cameraWasPerspective:{value:null}},toneMapped:!1,depthWrite:!1,depthTest:!1})}}const g=255/256,y=new Float32Array([g,g/256,g/256**2,g/256**3]);function w(e){return e[0]/255*y[0]+e[1]/255*y[1]+e[2]/255*y[2]+e[3]/255*y[3]}const W=new U(-1,1,1,-1,0,1),d=new b,A=new B,$=new P(2,2),j=new S($,d);let c=null,t=null;A.add(j);async function V(e,r,l,a){if(!e)return null;try{const{width:n,height:v}=e.image;if((!c||!t||c.width!==n||c.height!==v)&&(c==null||c.dispose(),t=new Uint8Array(4*n*v),c=new x(n,v,{type:D,format:k,depthBuffer:!1,stencilBuffer:!1})),d.uniforms.depthTexture.value=e,d.uniforms.cameraNear.value=l.near,d.uniforms.cameraFar.value=l.far,d.uniforms.cameraWasPerspective.value=l.isPerspectiveCamera,r.setRenderTarget(c),r.clear(),r.render(A,W),r.setRenderTarget(null),await r.readRenderTargetPixelsAsync(c,0,0,n,v,t),a!==void 0&&Number.isFinite(a)){const o=[t[a],t[a+1],t[a+2],t[a+3]];return w(o)*2-1}else{const o=new Array(t.length/4);for(let s=0;s<o.length;s++){const u=s*4,R=[t[u],t[u+1],t[u+2],t[u+3]];o[s]=w(R)*2-1}return o}}catch(n){return console.error(n),null}}var E=`varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

}`,O=`varying vec2 vUv;

void main() {
  
  gl_FragColor = vec4(vUv, 1.0, 1.0);

}`;new F({vertexShader:E,fragmentShader:O});export{Q as g,V as r};
