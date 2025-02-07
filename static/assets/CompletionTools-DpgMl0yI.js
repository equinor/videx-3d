import{j as v}from"./jsx-runtime-CmIOflP4.js";import{r}from"./index-KqYmeiyw.js";import{u as j,a as G,b as O}from"./useWellboreContext-l1cQXUDV.js";import{l as P,s as h,t as A,U as y,h as x,g as n,x as B}from"./CameraManager-BTlj_2qD.js";import{q as z}from"./limiter-DhBcc_yH.js";import{c as F,L as N}from"./uv-material-Cw8kPkQB.js";var W=`#define LAMBERT

attribute float curveLength;

varying vec3 vViewPosition;
varying vec2 vUv;
varying float vCurveLength;

#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {
  #include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>

	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>

	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>

	vViewPosition = - mvPosition.xyz;

	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>

  vUv = uv;
  vCurveLength = curveLength;
}`,Y=`#define LAMBERT

uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 emissive;
uniform float opacity;

varying vec2 vUv;
varying float vCurveLength;

#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

void main() {

  float strength = mod(vCurveLength + vUv.y * 2.0, 2.0);
  strength = step(1.5, strength);

  vec4 diffuseColor = vec4( uColor1 * strength + uColor2 * (1.0 - strength), opacity );
  
	#include <clipping_planes_fragment>

	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;

	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>

	
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>

	
	#include <aomap_fragment>

	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;

	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>

}`;class b extends P{constructor(e={}){super({uniforms:h.merge([h.clone(A.lambert.uniforms),{uColor1:new y(new x(e.color||"white")),uColor2:new y(new x(e.color||"black"))}]),vertexShader:W,fragmentShader:Y}),this.setValues(e),this.lights=!0}get color1(){return this.uniforms.uColor1.value}set color1(e){this.uniforms.uColor1.value.set(e)}get color2(){return this.uniforms.uColor2.value}set color2(e){this.uniforms.uColor2.value.set(e)}}const I="completionTools",C=({name:t,userData:e,renderOrder:w=1,layers:M=F(N.OCCLUDER),position:L,visible:V,castShadow:q,receiveShadow:S,customMaterial:l,customDepthMaterial:E,customDistanceMaterial:R,radialSegments:s=16,sizeMultiplier:d=1,segmentsPerMeter:c=.1,simplificationThreshold:m=0,priority:p=0,fallback:f})=>{const{id:i,fromMsl:_}=j(),u=G(I),[o,k]=r.useState(null),[D,U]=r.useState(!1),T=r.useMemo(()=>l||[new n({color:"#999",metalness:1,roughness:.25}),new n({color:"#999",metalness:.8,roughness:.5}),new n({color:"#000",metalness:0,roughness:.95}),new n({color:"#097",metalness:0,roughness:1}),new n({color:"#444",metalness:.2,roughness:1}),new n({color:"#ccc",metalness:0,roughness:1,transparent:!0,opacity:.9}),new n({color:"#c00",metalness:.5,roughness:.75}),new n({color:"#4e3e86",metalness:.5,roughness:.75}),new b({color1:"#777",color2:"#fff"}),new b({color1:"#777",color2:"orange"}),new B({color:"#ccc"})],[l]);return r.useEffect(()=>{u&&i&&z(()=>u(i,_,s,d,c,m).then(a=>{k(g=>(g&&g.dispose(),a?O(a):null)),a||U(!0)}),p)},[u,i,_,d,c,m,p,s]),v.jsxs("group",{name:t,userData:e,renderOrder:w,visible:V,position:L,children:[o&&v.jsx("mesh",{geometry:o,material:T,layers:M,castShadow:q,receiveShadow:S,customDepthMaterial:E,customDistanceMaterial:R},o.uuid),D&&f&&f()]})};try{C.displayName="CompletionTools",C.__docgenInfo={description:"Generic render of completion tools based on depths, diameters and type. Must be a child of the `Wellbore` component.",displayName:"CompletionTools",props:{name:{defaultValue:null,description:"",name:"name",required:!1,type:{name:"string | undefined"}},visible:{defaultValue:null,description:"",name:"visible",required:!1,type:{name:"boolean | undefined"}},userData:{defaultValue:null,description:"",name:"userData",required:!1,type:{name:"Record<string, any> | undefined"}},position:{defaultValue:null,description:"",name:"position",required:!1,type:{name:"Vec3 | undefined"}},castShadow:{defaultValue:null,description:"",name:"castShadow",required:!1,type:{name:"boolean | undefined"}},receiveShadow:{defaultValue:null,description:"",name:"receiveShadow",required:!1,type:{name:"boolean | undefined"}},renderOrder:{defaultValue:{value:"1"},description:"",name:"renderOrder",required:!1,type:{name:"number | undefined"}},layers:{defaultValue:{value:"createLayers(LAYERS.OCCLUDER)"},description:"",name:"layers",required:!1,type:{name:"Layers | undefined"}},customMaterial:{defaultValue:null,description:"",name:"customMaterial",required:!1,type:{name:"Material | Material[] | undefined"}},customDepthMaterial:{defaultValue:null,description:"",name:"customDepthMaterial",required:!1,type:{name:"Material | undefined"}},customDistanceMaterial:{defaultValue:null,description:"",name:"customDistanceMaterial",required:!1,type:{name:"Material | undefined"}},onMaterialPropertiesChange:{defaultValue:null,description:"",name:"onMaterialPropertiesChange",required:!1,type:{name:"((props: Record<string, any>, material: Material | Material[]) => void) | undefined"}},radialSegments:{defaultValue:{value:"16"},description:"",name:"radialSegments",required:!1,type:{name:"number | undefined"}},sizeMultiplier:{defaultValue:{value:"1"},description:"",name:"sizeMultiplier",required:!1,type:{name:"number | undefined"}},segmentsPerMeter:{defaultValue:{value:"0.1"},description:"",name:"segmentsPerMeter",required:!1,type:{name:"number | undefined"}},simplificationThreshold:{defaultValue:{value:"0"},description:"",name:"simplificationThreshold",required:!1,type:{name:"number | undefined"}},fallback:{defaultValue:null,description:"",name:"fallback",required:!1,type:{name:"(() => ReactElement<Object3D<Object3DEventMap>, string | JSXElementConstructor<any>>) | undefined"}},priority:{defaultValue:{value:"0"},description:"",name:"priority",required:!1,type:{name:"number | undefined"}}}}}catch{}export{C};
