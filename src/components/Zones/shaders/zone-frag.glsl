#define PHONG
#define ZONE_MATERIAL

uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
uniform float zoneSaturation; // 1 = as lit, 0 = grey

#ifdef ZONE_AMBIENT
uniform vec2 zoneAmbient; // x: multiplier facing up, y: facing down
#endif

#ifdef SURFACE_DETAIL
varying vec3 vWorldPosition;
#endif
#if defined(SURFACE_DETAIL) && defined(ZONE_WALL)
varying float vWallV;
#endif

#ifdef ZONE_WATER_TINT
uniform vec3 waterTintParams; // x: water level (vertex stage), y: strength, z: 1 / depth scale
uniform vec2 waterTintShore;  // x: 1 / wet band depth, y: darkening amount
uniform float waterTintShown; // 0 no water; 1 the stack's own drawn; 2 another sea's (a Scenery's, a Water)
varying float vWaterDepth;
#ifdef ZONE_BATHYMETRY
// The sea bed's own grid. Sampling it gives the water column standing over this
// MAP location rather than over this fragment, which is the difference between a
// cap (where the two agree) and a flank hanging metres below the bed.
uniform sampler2D bathyMap;
uniform mat3 bathyToUv; // object XZ -> uv
uniform vec2 bathySize; // grid size in texels
#endif
#endif

#ifdef ZONE_SECTION
varying float vSectionDist;
#endif

#if defined(ZONE_FENCE) || defined(ZONE_SEA_FENCE)
// x: 1 while the cut is live, 0 to pass everything; y: +1 normally, -1 to draw ONLY
// what the fence removed (the peel patch).
uniform vec2 fenceParams;
uniform sampler2D fenceMap;
uniform mat3 fenceToUv;   // object XZ -> uv
uniform vec2 fenceSize;   // grid size in texels
#include ../../../sdk/materials/shaderLib/fence-field.glsl
#endif

#ifdef ZONE_SEA_SECTION
// The section plane where it takes the water (object space): none stands where it is > 0.
uniform vec4 waterSectionPlane;
#endif

#if defined(ZONE_CONTACTS) || defined(ZONE_BATHYMETRY) || defined(ZONE_FENCE) || defined(ZONE_FENCE_OVERLAY) || defined(ZONE_TILE_DEBUG) || defined(ZONE_TILE_LEVELS) || defined(ZONE_HEIGHT_CLIP) || defined(ZONE_SEA_SECTION) || defined(ZONE_SEA_FENCE)
varying vec3 vObjectPos;
#endif
// Once, for the scene's water (water-body.glsl) too: an include repeated is inlined again.
#if defined(ZONE_CONTACTS) || defined(ZONE_BATHYMETRY) || defined(ZONE_FENCE) || defined(ZONE_FENCE_OVERLAY) || defined(ZONE_TILE_DEBUG) || defined(ZONE_TILE_LEVELS) || defined(ZONE_HEIGHT_CLIP) || defined(ZONE_SEA_SECTION) || defined(ZONE_SEA_FENCE) || defined(ZONE_SEA)
#include ../../../sdk/materials/shaderLib/depth-map.glsl
#endif

#ifdef ZONE_HEIGHT_CLIP
// The ground drawn over the stack (`ZoneStackProps.clip`): what lies above it is not
// there. In OBJECT space, the frame the column's top was built on the ground in.
#include ../../../sdk/materials/shaderLib/height-field-clip.glsl
#endif

#ifdef ZONE_SEA
// The scene's water (WaterBody): what lies in it fades by its path through it.
#include ../../../sdk/materials/shaderLib/water-body.glsl
#endif

#if defined(ZONE_TILE_DEBUG) || defined(ZONE_TILE_LEVELS)
uniform mat3 tileToGrid;      // object XZ -> reference grid (column, row)
uniform vec3 tileLayout;      // x: cells per tile, yz: the first tile
uniform sampler2D tileValues; // one texel per tile; red: a value per tile (LOD level)

// Where `objectXZ` lies in tile units, by the same formula the tessellation tiles by.
vec2 zoneTileCell(vec2 objectXZ) {
  return ((tileToGrid * vec3(objectXZ, 1.0)).xy + 0.5) / tileLayout.x;
}

float zoneTileValue(vec2 tile) {
  ivec2 at = clamp(ivec2(tile - tileLayout.yz), ivec2(0), textureSize(tileValues, 0) - 1);
  return texelFetch(tileValues, at, 0).r;
}
#endif

#ifdef ZONE_TILE_DEBUG
uniform float tileByValue;    // 1: colour by the value, 0: a checker
#endif

#ifdef ZONE_NORMAL_MAP
uniform sampler2D capNormalMap; // rg: the normal's x and z; its y is positive
uniform float capNormalOn;
uniform mat3 normalMatrix;
varying vec2 vCapNormalUv;
#endif

#ifdef ZONE_FENCE_OVERLAY
// Layout mirrored by `ZoneFenceOverlayUniforms`.
uniform sampler2D overlayValues;
uniform vec4 overlayRect;     // x, y: along at u = 0 and 1, z, w: scene Y at v = 0 and 1
uniform sampler2D overlayPalette;
uniform vec4 overlayParams;   // x, y: values at the palette's ends, z: mix, w: shading (0 flat, 1 lit, 2 facing)
varying float vFenceAlong;
#include ../../../sdk/materials/shaderLib/ramp-filter.glsl
#endif

#ifdef ZONE_CONTACTS
uniform sampler2D contactMap[ZONE_CONTACTS];
uniform mat3 contactToUv[ZONE_CONTACTS];   // object XZ -> uv
uniform vec3 contactColor[ZONE_CONTACTS];
uniform vec4 contactStyle[ZONE_CONTACTS];  // x: half width, y: 1 world / 0 screen, z: dash, w: gap
uniform vec4 contactSize[ZONE_CONTACTS];   // xy: grid size in texels, z: opacity, w: max world half width

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
  if(style.z > 0.0) {
    vec2 g = vec2(dFdx(d), dFdy(d));
    float gl = length(g);
    if(gl > 1e-9) {
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
#define ZONE_CONTACT(I) { float cy; float cov = sampleDepthMap(contactMap[I], contactToUv[I], contactSize[I].xy, vObjectPos.xz, cy); outgoingLight = contactLine(cy, contactStyle[I], contactColor[I], contactSize[I].z * cov, contactSize[I].w, outgoingLight); }
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

#ifdef SURFACE_DETAIL
#include ../../../sdk/materials/shaderLib/procedural-normal.glsl
#include ../../../sdk/materials/shaderLib/surface-detail.glsl
#endif

#ifdef USE_OIT
#include ../../../sdk/materials/shaderLib/oit.glsl
#endif

void main() {
  // Before anything else, and before the OIT passes take their early exits: a
  // fragment that is cut away must be gone in the min-depth and occlusion passes
  // too, or the block goes on occluding through the cut it is not drawn in.
  #ifdef ZONE_SECTION
  if(vSectionDist > 0.0)
    discard;
  #endif

  #ifdef ZONE_FENCE
  // ⭐ PER FRAGMENT, not interpolated from the vertices. The cut face is built
  // independently of this mesh's triangles, so reading the fence here — at the
  // resolution of the curve rather than of the tessellation — is what lets the two
  // agree along something the tessellation knows nothing about.
  // ⭐⭐ The threshold is 0 because the caller's clearance is baked into the curve,
  // and the read is EXACT because the curve is carried rather than reconstructed.
  // The face is that same curve, so face and cut are one object.
  // x: whether the cut is live, y: +1 for the block, -1 for the peel patch.
  if(fenceParams.x > 0.5) {
    float fenceAt = fenceSide(fenceMap, fenceToUv, fenceSize, vObjectPos.xz);
    if(fenceParams.y * fenceAt < 0.0)
      discard;
  }
  #endif

  #ifdef ZONE_FENCE_OVERLAY_ONLY
  // ⚠️ Before the OIT early return, so the depth pass agrees about what is not there.
  // Written as a negated `inside` test so a NaN rect (no overlay) discards too.
  {
    vec2 at = vec2((vFenceAlong - overlayRect.x) / (overlayRect.y - overlayRect.x), (vObjectPos.y - overlayRect.z) / (overlayRect.w - overlayRect.z));
    bool inside = at.x >= 0.0 && at.x <= 1.0 && at.y >= 0.0 && at.y <= 1.0;
    if(!(overlayParams.z > 0.0 && inside))
      discard;
  }
  #endif

  #ifdef ZONE_HEIGHT_CLIP
  // ⭐ Per fragment, against the triangles the ground is drawn with: the column's top is
  // built a margin above the ground, so every face ends exactly where it is drawn.
  if(heightFieldClipped(vObjectPos))
    discard;
  #endif

  vec4 diffuseColor = vec4(diffuse, opacity);
  #include <clipping_planes_fragment>

  ReflectedLight reflectedLight = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
  vec3 totalEmissiveRadiance = emissive;

  #include <logdepthbuf_fragment>
  #include <color_fragment>

  // The OIT min-depth pass writes nothing but linear depth (and, with the occlusion
  // stamp folded in, OIT_DEPTH_OCCLUDERS, whether this fragment's alpha clears its
  // threshold), and the occlusion pass needs nothing but this fragment's alpha.
  // `oitProcess` runs at the END of main, so without this guard both passes would
  // shade the fragment - procedural detail and all - and then throw the colour away.
  // This is what keeps the detail's cost at two of the four OIT passes rather than all
  // four.
  #if defined(OIT_DEPTH_PASS) || defined(OIT_OCCLUSION_PASS)
  gl_FragColor = oitProcess(diffuseColor);
  return;
  #endif

  #include <specularmap_fragment>
  #include <normal_fragment_begin>

  #if defined(ZONE_NORMAL_MAP) && !defined(FLAT_SHADED)
  // A coarse triangle has no normals of its own: the full level's, from the map.
  #ifdef ZONE_TILE_LEVELS
  bool capNormalRead = capNormalOn > 0.5 && zoneTileValue(floor(zoneTileCell(vObjectPos.xz))) > 0.0;
  #else
  bool capNormalRead = capNormalOn > 0.5;
  #endif
  if(capNormalRead) {
    vec2 capXZ = texture2D(capNormalMap, vCapNormalUv).rg;
    normal = normalize(normalMatrix * vec3(capXZ.x, sqrt(max(1.0 - dot(capXZ, capXZ), 0.0)), capXZ.y));
    #ifdef FLIP_SIDED
    normal = -normal;
    #endif
    #ifdef DOUBLE_SIDED
    normal *= faceDirection;
    #endif
    nonPerturbedNormal = normal;
  }
  #endif

  #ifdef SURFACE_DETAIL
  {
    // Only the OIT front layer is detailed.
    #ifdef USE_OIT
    bool detailShown = !oitInTail();
    #else
    bool detailShown = true;
    #endif
    #ifdef ZONE_WALL
    float bedding = vWallV;
    #else
    float bedding = 0.0;
    #endif
    // Taking the normal from AFTER <normal_fragment_begin> keeps the double-sided face flip.
    diffuseColor.rgb *= surfaceDetail(normal, vWorldPosition, -vViewPosition, bedding, detailShown);
  }
  #endif

  #ifdef ZONE_FENCE_OVERLAY
  // Kept for after lighting, where the unlit modes mix it in.
  vec3 overlayColor = vec3(0.0);
  float overlayShown = 0.0;
  {
    vec2 uv = vec2((vFenceAlong - overlayRect.x) / (overlayRect.y - overlayRect.x), (vObjectPos.y - overlayRect.z) / (overlayRect.w - overlayRect.z));
    float shown = overlayParams.z * step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    #ifdef ZONE_FENCE_OVERLAY_ONLY
    shown = 1.0;
    #endif
    // ⚠️ Outside the branch: derivatives are undefined in non-uniform control flow.
    vec2 uvDx = dFdx(uv);
    vec2 uvDy = dFdy(uv);
    if(shown > 0.0) {
      // ⭐ Coloured AFTER filtering, so a magnified view interpolates the data, not its colours;
      // averaged in colour over the pixel when minified, so the palette does not shimmer.
      overlayColor = rampSampleFiltered(overlayValues, uv, uvDx, uvDy, overlayPalette, 0.5, overlayParams.xy);
      overlayShown = clamp(shown, 0.0, 1.0);
      // lit
      if(abs(overlayParams.w - 1.0) < 0.5)
        diffuseColor.rgb = mix(diffuseColor.rgb, overlayColor, overlayShown);
    }
  }
  #endif

  // accumulation
  #include <lights_phong_fragment>
  #include <lights_fragment_begin>

  #ifdef ZONE_AMBIENT
  {
    // Stand-in for an environment map. Three routes `scene.environment` to
    // standard/physical materials ONLY, so a library ShaderMaterial gets no IBL and its
    // ambient arrives as one flat term - which lights every face away from the sun
    // identically and hides all relief there. Redistributing that same irradiance by
    // orientation (brighter facing up, darker facing down) restores the shape without
    // an env map's colour bleed, and works in a host scene that has no environment at
    // all. Uses the PERTURBED normal, so the procedural detail reads in ambient too.
    vec3 ambientNormal = normalize(normal * mat3(viewMatrix));
    irradiance *= mix(zoneAmbient.y, zoneAmbient.x, ambientNormal.y * 0.5 + 0.5);
  }
  #endif

  #include <lights_fragment_maps>
  #include <lights_fragment_end>

  vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;

  #ifdef ZONE_WATER_TINT
  {
    // How much water stands over this fragment. The vertex stage's own depth is
    // only right on the bed itself; anything hanging below it - the rim wall of
    // the sea-bed unit, a section face - is not under that much water.
    float depth = vWaterDepth;
    // Water-facing side only: the underside of a cap is inside the ground.
    vec3 tintNormal = normalize(normal * mat3(viewMatrix));
    float facing = smoothstep(-0.15, 0.15, tintNormal.y);

    #ifdef ZONE_BATHYMETRY
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
    outgoingLight *= 1.0 - wet * waterTintShore.y * facing * min(waterTintShown, 1.0);
  }
  #endif

  #ifdef ZONE_FENCE_OVERLAY
  // flat (0) or facing (2): the palette colour, untouched by the scene lights
  if(overlayShown > 0.0 && abs(overlayParams.w - 1.0) >= 0.5) {
    vec3 shaded = overlayColor;
    if(overlayParams.w > 1.5) {
      // As `WellboreSeismicSection`: darker as the face turns away. The geometric normal, so
      // procedural detail does not show through.
      float facing = max(dot(normalize(vNormal) * faceDirection, geometryViewDir), 0.0);
      shaded *= clamp(sqrt(facing), 0.5, 1.0);
    }
    outgoingLight = mix(outgoingLight, shaded, overlayShown);
  }
  #endif

  #ifdef ZONE_CONTACTS
  #if ZONE_CONTACTS > 0
  ZONE_CONTACT(0)
  #endif
  #if ZONE_CONTACTS > 1
  ZONE_CONTACT(1)
  #endif
  #if ZONE_CONTACTS > 2
  ZONE_CONTACT(2)
  #endif
  #if ZONE_CONTACTS > 3
  ZONE_CONTACT(3)
  #endif
  #if ZONE_CONTACTS > 4
  ZONE_CONTACT(4)
  #endif
  #if ZONE_CONTACTS > 5
  ZONE_CONTACT(5)
  #endif
  #if ZONE_CONTACTS > 6
  ZONE_CONTACT(6)
  #endif
  #if ZONE_CONTACTS > 7
  ZONE_CONTACT(7)
  #endif
  #endif

  outgoingLight = mix(vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722))), outgoingLight, zoneSaturation);

  #ifdef ZONE_TILE_DEBUG
  {
    vec2 cell = zoneTileCell(vObjectPos.xz);
    vec2 tile = floor(cell);
    float value = zoneTileValue(tile);
    // Green (full detail) through yellow to red (the coarsest level).
    vec3 ramp = value < 0.5 ? mix(vec3(0.3, 0.85, 0.4), vec3(1.0, 0.85, 0.25), value * 2.0) : mix(vec3(1.0, 0.85, 0.25), vec3(1.0, 0.25, 0.3), value * 2.0 - 1.0);
    vec3 checker = mod(tile.x + tile.y, 2.0) < 0.5 ? vec3(1.0, 0.62, 0.25) : vec3(0.3, 0.65, 1.0);
    vec3 hue = tileByValue > 0.5 ? ramp : checker;
    outgoingLight = mix(outgoingLight, outgoingLight * hue * 1.5, 0.5);
    // A line of constant width on screen, so it reads at field scale too.
    vec2 edge = min(fract(cell), 1.0 - fract(cell)) / max(fwidth(cell), vec2(1e-6));
    outgoingLight = mix(outgoingLight, vec3(0.02), 0.9 * (1.0 - smoothstep(0.5, 1.5, min(edge.x, edge.y))));
  }
  #endif

  #if defined(ZONE_SEA) && defined(ZONE_WATER_TINT)
  // The seabed - the shallowest cap, the only one given the water - on its water-facing side,
  // where a cut that takes the water has not taken it from over this point; below the seabed
  // nothing is. While the stack draws its water (waterTintShown 1), dimmed by the daylight its
  // depth leaves it (water-body.glsl's waterBodyDim): the stack's surface and walls carry the
  // water in front of it. While another sea draws it (2: a Scenery's, a Water), seen through
  // that sea's water as the seabed it is (waterBodyFogBed), faded along the sight line from in it.
  {
    float waterKept = min(waterTintShown, 1.0);
    #ifdef ZONE_SEA_SECTION
    if(dot(waterSectionPlane.xyz, vObjectPos) + waterSectionPlane.w > 0.0)
      waterKept = 0.0;
    #endif
    #ifdef ZONE_SEA_FENCE
    // The side the block keeps (fenceParams' y aside: the peel patch draws the other).
    if(fenceParams.x > 0.5 && fenceSide(fenceMap, fenceToUv, fenceSize, vObjectPos.xz) < 0.0)
      waterKept = 0.0;
    #endif
    vec3 bedNormal = normalize(normal * mat3(viewMatrix));
    float bedFacing = smoothstep(-0.15, 0.15, bedNormal.y);
    vec3 bedWorld = waterBodyWorldOf(vViewPosition);
    vec3 underWater = waterTintShown > 1.5 ? waterBodyFogBed(outgoingLight, bedWorld) : waterBodyDim(outgoingLight, bedWorld);
    outgoingLight = mix(outgoingLight, underWater, bedFacing * waterKept);
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
