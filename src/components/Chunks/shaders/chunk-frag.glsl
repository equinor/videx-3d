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
uniform vec2 waterTintShore;  // x: 1 / wet band depth, y: darkening amount
varying float vWaterDepth;
#ifdef CHUNK_BATHYMETRY
// The sea bed's own grid. Sampling it gives the water column standing over this
// MAP location rather than over this fragment, which is the difference between a
// cap (where the two agree) and a flank hanging metres below the bed.
uniform sampler2D bathyMap;
uniform mat3 bathyToUv; // object XZ -> uv
uniform vec2 bathySize; // grid size in texels
#endif
#endif

#ifdef CHUNK_SECTION
varying float vSectionDist;
#endif

#ifdef CHUNK_FENCE
// x: half width in metres — how far the face stands off the well; y: which side of
// the curve goes (+1 or -1); z: unused; w: +1 normally, -1 to draw ONLY what the
// fence removed (the peel patch).
uniform vec4 fenceParams;
// x: extra half width at the shallow end; y, z: arc lengths it tapers between.
uniform vec3 fenceTaper;
uniform sampler2D fenceMap;
uniform mat3 fenceToUv;   // object XZ -> uv
uniform vec2 fenceSize;   // grid size in texels
#endif

#if defined(CHUNK_CONTACTS) || defined(CHUNK_BATHYMETRY) || defined(CHUNK_FENCE)
varying vec3 vObjectPos;
#include ../../../sdk/materials/shaderLib/depth-map.glsl
#endif

#ifdef CHUNK_CONTACTS
uniform sampler2D contactMap[CHUNK_CONTACTS];
uniform mat3 contactToUv[CHUNK_CONTACTS];   // object XZ -> uv
uniform vec3 contactColor[CHUNK_CONTACTS];
uniform vec4 contactStyle[CHUNK_CONTACTS];  // x: half width, y: 1 world / 0 screen, z: dash, w: gap
uniform vec4 contactSize[CHUNK_CONTACTS];   // xy: grid size in texels, z: opacity, w: max world half width

// Blend one contact's line over the shaded colour.
vec3 contactLine(float contactY, vec4 style, vec3 lineColor, float lineOpacity, float maxHalf, vec3 base) {
  // Signed height of this fragment above the contact. Its zero contour IS the
  // line, so a cap gives the accumulation outline and a cut face gives the
  // horizontal section line, from one test.
  float d = vObjectPos.y - contactY;
  float aa = max(fwidth(d), 1e-6);

  // ⚠⚠ Both modes threshold in WORLD units, and the screen width is CAPPED there.
  // `fwidth` is taken over the 2x2 fragment quad, so at a silhouette or a block
  // corner the quad straddles two faces and the derivative comes back far larger
  // than the true per-pixel gradient — which, in a plain `abs(d) / aa` test, lets
  // fragments hundreds of metres from the contact pass and paints the line up and
  // down the corner. The cap cannot repair the derivative; it bounds the damage.
  // ⚠️ The trade is real: at a genuinely grazing angle a screen-constant line wants
  // to be wide in world units, so it thins there instead of holding its pixels.
  float halfWidth = style.y > 0.5 ? style.x : min(style.x * aa, maxHalf);
  float feather = style.y > 0.5 ? aa : 0.5 * aa;
  float line = 1.0 - smoothstep(halfWidth - feather, halfWidth + feather, abs(d));

  // ⚠️ Best-effort dashes. An implicit contour has no arc length, but its
  // direction in SCREEN space is perpendicular to the gradient of `d`, so the
  // pattern can at least run along the line rather than across it.
  if (style.z > 0.0) {
    vec2 g = vec2(dFdx(d), dFdy(d));
    float gl = length(g);
    if (gl > 1e-9) {
      float along = dot(gl_FragCoord.xy, vec2(-g.y, g.x) / gl);
      float t = mod(along, style.z + style.w);
      line *= 1.0 - smoothstep(style.z - 0.5, style.z + 0.5, t);
    }
  }

  return mix(base, lineColor, clamp(line * lineOpacity, 0.0, 1.0));
}

// ⚠️ Unrolled, not looped: GLSL ES 1.00 will not index a SAMPLER array with a
// loop variable, only with a constant expression.
// ⚠️ Called unconditionally, and coverage folded into the opacity — branching on
// "has a contact here" is what broke the derivatives at the pocket edge.
#define CHUNK_CONTACT(I) { float cy; float cov = sampleDepthMap(contactMap[I], contactToUv[I], contactSize[I].xy, vObjectPos.xz, cy); outgoingLight = contactLine(cy, contactStyle[I], contactColor[I], contactSize[I].z * cov, contactSize[I].w, outgoingLight); }
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

  #ifdef CHUNK_FENCE
  // ⭐ PER FRAGMENT, not interpolated from the vertices. The cut face is built
  // independently of this mesh's triangles, so reading the field here — at the
  // resolution of the field rather than of the tessellation — is what lets the two
  // agree along a curve the tessellation knows nothing about.
  // ⚠️ R is the signed distance, G the distance ALONG the curve. The taper needs
  // both: how wide the cut opens depends on where down the well it is.
  vec2 fenceField = sampleFieldMap2(fenceMap, fenceToUv, fenceSize, vObjectPos.xz);
  float fenceAt = fenceParams.y * fenceField.r;
  float fenceWidth = fenceParams.x + fenceTaperWidth(fenceTaper, fenceField.g);
  if (fenceParams.w * (fenceAt - fenceWidth) < 0.0) discard;
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
    // How much water stands over this fragment. The vertex stage's own depth is
    // only right on the bed itself; anything hanging below it - the rim wall of
    // the sea-bed unit, a section face - is not under that much water.
    float depth = vWaterDepth;
    // Water-facing side only: the underside of a cap is inside the ground.
    vec3 tintNormal = normalize(normal * mat3(viewMatrix));
    float facing = smoothstep(-0.15, 0.15, tintNormal.y);

    #ifdef CHUNK_BATHYMETRY
    {
      float bedY;
      float covered = sampleDepthMap(bathyMap, bathyToUv, bathySize, vObjectPos.xz, bedY);
      // The column standing over this MAP location. On the cap the two agree by
      // construction; the map is the finer of the two where the TIN is coarse.
      depth = mix(depth, waterTintParams.x - bedY, covered);
    }
    #endif

    // Ground just below the waterline is WET, and wet ground is darker. Applied
    // before the absorption so the two stack the way they physically do, and it
    // is what stops the shore reading as a hard colour boundary between dry land
    // and tinted bed.
    // ⚠️ It fades out a little ABOVE the waterline too (the splash zone), rather
    // than ending on a step there — a hard edge exactly at depth 0 aliases along
    // the whole coast, which is the one place the eye is already looking.
    float wetT = depth * waterTintShore.x;
    float wet = smoothstep(-0.25, 0.0, wetT) * (1.0 - smoothstep(0.0, 1.0, wetT));
    outgoingLight *= 1.0 - wet * waterTintShore.y * facing;

    // Absorption through that column: nothing at the waterline, saturating with
    // depth. Being depth-dependent is what lets a sea bed rise THROUGH the water
    // - a coast, an island - without anything here having to know where the
    // shoreline runs.
    float absorb = 1.0 - exp(-max(depth, 0.0) * waterTintParams.z);
    outgoingLight = mix(outgoingLight, waterTintColor, clamp(absorb * waterTintParams.y * facing, 0.0, 1.0));
  }
  #endif

  #ifdef CHUNK_CONTACTS
  #if CHUNK_CONTACTS > 0
  CHUNK_CONTACT(0)
  #endif
  #if CHUNK_CONTACTS > 1
  CHUNK_CONTACT(1)
  #endif
  #if CHUNK_CONTACTS > 2
  CHUNK_CONTACT(2)
  #endif
  #if CHUNK_CONTACTS > 3
  CHUNK_CONTACT(3)
  #endif
  #if CHUNK_CONTACTS > 4
  CHUNK_CONTACT(4)
  #endif
  #if CHUNK_CONTACTS > 5
  CHUNK_CONTACT(5)
  #endif
  #if CHUNK_CONTACTS > 6
  CHUNK_CONTACT(6)
  #endif
  #if CHUNK_CONTACTS > 7
  CHUNK_CONTACT(7)
  #endif
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
