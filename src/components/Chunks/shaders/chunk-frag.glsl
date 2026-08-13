#define PHONG
#define CHUNK_MATERIAL

uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;

#ifdef CHUNK_AMBIENT
uniform vec2 chunkAmbient; // x: multiplier facing up, y: facing down
#endif

#ifdef CHUNK_DETAIL
// Packed so a preset costs a handful of uniforms rather than a dozen; the layout is
// mirrored by `chunk-material.ts`, which is the only thing that writes them.
uniform float detailStrength;   // overall multiplier (the caller's one knob)
uniform vec2 detailShade;       // x: albedo modulation, y: bump height
uniform vec4 detailGranular;    // x: strength, y: frequency, z: octaves, w: anisotropy
uniform vec4 detailGrain;       // x: strength, y: frequency, z: angle, w: sharpness
uniform vec4 detailGrainB;      // x: uniformity, y: octaves, z: bedding mix, w: laminae
uniform vec4 detailDunes;       // x: strength, y: wavelength, zw: direction

varying vec3 vWorldPosition;
#ifdef CHUNK_WALL
varying float vWallV;
#endif
#endif

#ifdef CHUNK_WATER_TINT
uniform vec3 waterTintColor;  // the water colour, in the working colour space
uniform vec3 waterTintParams; // x: water level (vertex stage), y: strength, z: 1 / depth scale
varying float vWaterDepth;
#endif

#ifdef CHUNK_SECTION
varying float vSectionDist;
#endif

#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

#ifdef CHUNK_DETAIL
#include ../../../sdk/materials/shaderLib/procedural-normal.glsl
#endif

#ifdef USE_OIT
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif

void main() {
  // Before anything else, and before the OIT passes take their early exits: a
  // fragment that is cut away must be gone in the min-depth and occlusion passes
  // too, or the block goes on occluding through the cut it is not drawn in.
  #ifdef CHUNK_SECTION
  if (vSectionDist > 0.0) discard;
  #endif

  vec4 diffuseColor = vec4(diffuse, opacity);
  #include <clipping_planes_fragment>

  ReflectedLight reflectedLight = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
  vec3 totalEmissiveRadiance = emissive;

  #include <logdepthbuf_fragment>
  #include <color_fragment>

  // The OIT min-depth pass writes nothing but linear depth, and the occlusion pass
  // needs nothing but this fragment's alpha. `oitProcess` runs at the END of main,
  // so without this guard both passes would shade the fragment - procedural detail
  // and all - and then throw the colour away. This is what keeps the detail's cost
  // at two of the four OIT passes rather than all four.
  #if defined(OIT_DEPTH_PASS) || defined(OIT_OCCLUSION_PASS)
  gl_FragColor = oitProcess(diffuseColor);
  return;
  #endif

  #include <specularmap_fragment>
  #include <normal_fragment_begin>

  #ifdef CHUNK_DETAIL
  {
    // View -> world. `mat3(viewMatrix)` is orthonormal (the view transform is rigid),
    // so multiplying from the right is its inverse. Taking the normal from AFTER
    // <normal_fragment_begin> keeps the double-sided face flip.
    vec3 worldNormal = normalize(normal * mat3(viewMatrix));
    vec3 axis = abs(worldNormal);
    // Project onto the plane the face most nearly lies in: XZ for a cap, one of the
    // two vertical planes for a wall. A cap and the wall hanging from it then share
    // the pattern's scale and phase along their common edge.
    bool horizontal = axis.y >= axis.x && axis.y >= axis.z;
    bool alongX = axis.x >= axis.z;
    vec2 q = horizontal
      ? vWorldPosition.xz
      : (alongX ? vec2(vWorldPosition.z, vWorldPosition.y) : vec2(vWorldPosition.x, vWorldPosition.y));
    // The plane's unit axes and its normal, for tilting from an analytic slope.
    vec3 planeU = horizontal ? vec3(1.0, 0.0, 0.0) : (alongX ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0));
    vec3 planeV = horizontal ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 planeN = horizontal ? vec3(0.0, 1.0, 0.0) : (alongX ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0));
    // A back face's normal is flipped, so its relief has to tilt the other way.
    float facing = dot(worldNormal, planeN) >= 0.0 ? 1.0 : -1.0;

    float height = 0.0; // fine relief, perturbed from its screen-space gradient
    float shade = 0.0;  // the same relief as a faint albedo modulation
    vec2 slope = vec2(0.0); // relief with an EXACT slope, tilted in the plane above

    #ifdef CHUNK_DETAIL_DUNES
    {
      // Dunes tilt the WORLD normal from their exact analytic slope rather than going
      // through perturbNormalHeight: the ridges are tens of metres wide, and a
      // screen-space gradient degrades at exactly the grazing angles a sea bed is seen
      // at. The slope is a horizontal-plane one, so it fades out as a face turns
      // vertical (a wall gets none).
      float texel = max(length(fwidth(vWorldPosition.xz)), 1e-3);
      float crest;
      vec2 g = pnDunes(vWorldPosition.xz, detailDunes.y, detailDunes.zw, texel, crest);
      worldNormal = normalize(worldNormal + vec3(-g.x, 0.0, -g.y) * (detailDunes.x * detailStrength * axis.y));
      shade += crest * detailDunes.x;
    }
    #endif

    #ifdef CHUNK_DETAIL_GRANULAR
    {
      int octaves = int(detailGranular.z);
      vec2 uv = q * detailGranular.y;
      // ⭐ Analytic slope, NOT perturbNormalHeight: a screen-space gradient is taken over
      // the pixel footprint, so the bump direction changes with distance and viewing
      // angle and the detail visibly slides across the surface as the camera moves.
      // Dividing the height by the frequency keeps `strength` frequency-INDEPENDENT,
      // which leaves the slope as simply strength x gradient.
      vec3 n = pnGranularFilteredGrad(uv, detailGranular.w, octaves);
      slope += detailGranular.x * n.yz;
      shade += n.x * detailGranular.x;
    }
    #endif

    #ifdef CHUNK_DETAIL_GRAIN
    {
      vec2 g = q;
      #ifdef CHUNK_WALL
      // Bedding follows the UNIT: `vWallV` spans 0..1 whatever the interval's
      // thickness, so `laminae` beds fit between its top and base either way.
      g.y = mix(q.y, vWallV * detailGrainB.w / max(detailGrain.y, 1e-4), detailGrainB.z);
      #endif
      int octaves = int(detailGrainB.y);
      vec2 uv = g * detailGrain.y;
      // Fades on the BASE frequency (octaves = 1), not the finest: the flute component
      // band-limits itself and the irregular one is octave-filtered, so the whole layer
      // only has to go once its coarsest structure stops being resolvable.
      float fade = pnFootprintFade(uv, 1);
      // pnGrain is positive (0..1); centring it keeps the albedo modulation unbiased.
      // ⚠️ This one keeps the screen-space path: its shape function (a pow and a
      // footprint-widened smoothstep) has no cheap closed-form gradient.
      float n = pnGrainFiltered(uv, detailGrain.z, detailGrain.w, detailGrainB.x, octaves) - 0.5;
      height += detailGrain.x * fade * n / max(detailGrain.y, 1e-4);
      shade += n * fade * detailGrain.x * 0.5;
    }
    #endif

    #ifdef CHUNK_DETAIL_GRANULAR
    slope *= detailStrength * detailShade.y * facing;
    worldNormal = normalize(worldNormal - (slope.x * planeU + slope.y * planeV));
    #endif
    #if defined(CHUNK_DETAIL_DUNES) || defined(CHUNK_DETAIL_GRANULAR)
    normal = normalize(mat3(viewMatrix) * worldNormal);
    #endif
    #ifdef CHUNK_DETAIL_GRAIN
    normal = perturbNormalHeight(normal, -vViewPosition, height * detailStrength * detailShade.y);
    #endif
    diffuseColor.rgb *= 1.0 + clamp(shade * detailShade.x * detailStrength, -0.5, 0.5);
  }
  #endif

  // accumulation
  #include <lights_phong_fragment>
  #include <lights_fragment_begin>

  #ifdef CHUNK_AMBIENT
  {
    // Stand-in for an environment map. Three routes `scene.environment` to
    // standard/physical materials ONLY, so a library ShaderMaterial gets no IBL and its
    // ambient arrives as one flat term - which lights every face away from the sun
    // identically and hides all relief there. Redistributing that same irradiance by
    // orientation (brighter facing up, darker facing down) restores the shape without
    // an env map's colour bleed, and works in a host scene that has no environment at
    // all. Uses the PERTURBED normal, so the procedural detail reads in ambient too.
    vec3 ambientNormal = normalize(normal * mat3(viewMatrix));
    irradiance *= mix(chunkAmbient.y, chunkAmbient.x, ambientNormal.y * 0.5 + 0.5);
  }
  #endif

  #include <lights_fragment_maps>
  #include <lights_fragment_end>

  vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;

  #ifdef CHUNK_WATER_TINT
  {
    // Absorption through the water column standing over this fragment: nothing at
    // the waterline, saturating with depth. Being depth-dependent is what lets a
    // sea bed rise THROUGH the water - a coast, an island - without anything here
    // having to know where the shoreline runs.
    float absorb = 1.0 - exp(-max(vWaterDepth, 0.0) * waterTintParams.z);
    // Water-facing side only: the underside of a cap is inside the ground.
    vec3 tintNormal = normalize(normal * mat3(viewMatrix));
    float facing = smoothstep(-0.15, 0.15, tintNormal.y);
    outgoingLight = mix(outgoingLight, waterTintColor, clamp(absorb * waterTintParams.y * facing, 0.0, 1.0));
  }
  #endif

  #include <opaque_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <premultiplied_alpha_fragment>
  #include <dithering_fragment>

  #ifdef USE_OIT
  gl_FragColor = oitProcess(gl_FragColor);
  #endif
}
