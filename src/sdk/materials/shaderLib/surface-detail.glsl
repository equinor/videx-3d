// Procedural surface detail (see surface-detail.ts): texture-free relief anchored in WORLD
// space, so a feature keeps its size wherever it is drawn and two surfaces meeting along an
// edge share the pattern's scale and phase. Defines: SURFACE_DETAIL and one per layer
// (_GRANULAR, _GRAIN, _DUNES); _BEDDING for a surface with a unit-relative height.
// ⚠️ Needs procedural-normal.glsl, included once by the shader that includes this.

#ifdef SURFACE_DETAIL
// Packed so a preset costs a handful of uniforms rather than a dozen; the layout is
// mirrored by `applySurfaceDetail`, which is the only thing that writes them.
uniform float detailStrength;   // overall multiplier (the caller's one knob)
uniform vec2 detailShade;       // x: albedo modulation, y: bump height
uniform vec4 detailGranular;    // x: strength, y: frequency, z: octaves, w: anisotropy
uniform vec4 detailGrain;       // x: strength, y: frequency, z: angle, w: sharpness
uniform vec4 detailGrainB;      // x: uniformity, y: octaves, z: bedding mix, w: laminae
uniform vec4 detailDunes;       // x: strength, y: wavelength, zw: direction

// Tilt the view-space `normal` of the surface at `world`, seen at view-space `position`,
// and return the factor its albedo takes. `bedding` is the height in the unit (0..1),
// read with SURFACE_DETAIL_BEDDING. `shown` false zeroes the noise rather than branching
// around it. ⚠️ Derivatives: call under uniform control flow.
float surfaceDetail(inout vec3 normal, vec3 world, vec3 position, float bedding, bool shown) {
  // View -> world. `mat3(viewMatrix)` is orthonormal (the view transform is rigid),
  // so multiplying from the right is its inverse.
  vec3 worldNormal = normalize(normal * mat3(viewMatrix));
  vec3 axis = abs(worldNormal);
  // Project onto the plane the face most nearly lies in: XZ for a cap, one of the
  // two vertical planes for a wall. A cap and the wall hanging from it then share
  // the pattern's scale and phase along their common edge.
  bool horizontal = axis.y >= axis.x && axis.y >= axis.z;
  bool alongX = axis.x >= axis.z;
  vec2 q = horizontal
    ? world.xz
    : (alongX ? vec2(world.z, world.y) : vec2(world.x, world.y));
  // The plane's unit axes and its normal, for tilting from an analytic slope.
  vec3 planeU = horizontal ? vec3(1.0, 0.0, 0.0) : (alongX ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0));
  vec3 planeV = horizontal ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 planeN = horizontal ? vec3(0.0, 1.0, 0.0) : (alongX ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0));
  // A back face's normal is flipped, so its relief has to tilt the other way.
  float facing = dot(worldNormal, planeN) >= 0.0 ? 1.0 : -1.0;

  float height = 0.0; // fine relief, perturbed from its screen-space gradient
  float shade = 0.0;  // the same relief as a faint albedo modulation
  vec2 slope = vec2(0.0); // relief with an EXACT slope, tilted in the plane above

  #ifdef SURFACE_DETAIL_DUNES
  {
    // Dunes tilt the WORLD normal from their exact analytic slope rather than going
    // through perturbNormalHeight: the ridges are tens of metres wide, and a
    // screen-space gradient degrades at exactly the grazing angles a sea bed is seen
    // at. The slope is a horizontal-plane one, so it fades out as a face turns
    // vertical (a wall gets none).
    float texel = max(length(fwidth(world.xz)), 1e-3);
    if (shown) {
      float crest;
      vec2 g = pnDunes(world.xz, detailDunes.y, detailDunes.zw, texel, crest);
      worldNormal = normalize(worldNormal + vec3(-g.x, 0.0, -g.y) * (detailDunes.x * detailStrength * axis.y));
      shade += crest * detailDunes.x;
    }
  }
  #endif

  #ifdef SURFACE_DETAIL_GRANULAR
  {
    int octaves = shown ? int(detailGranular.z) : 0;
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

  #ifdef SURFACE_DETAIL_GRAIN
  {
    vec2 g = q;
    #ifdef SURFACE_DETAIL_BEDDING
    // Bedding follows the UNIT: `bedding` spans 0..1 whatever the interval's
    // thickness, so `laminae` beds fit between its top and base either way.
    g.y = mix(q.y, bedding * detailGrainB.w / max(detailGrain.y, 1e-4), detailGrainB.z);
    #endif
    int octaves = shown ? int(detailGrainB.y) : 0;
    vec2 uv = g * detailGrain.y;
    // Fades on the BASE frequency (octaves = 1), not the finest: the flute component
    // band-limits itself and the irregular one is octave-filtered, so the whole layer
    // only has to go once its coarsest structure stops being resolvable.
    float fade = pnFootprintFade(uv, 1) * (shown ? 1.0 : 0.0);
    // pnGrain is positive (0..1); centring it keeps the albedo modulation unbiased.
    // ⚠️ This one keeps the screen-space path: its shape function (a pow and a
    // footprint-widened smoothstep) has no cheap closed-form gradient.
    float n = pnGrainFiltered(uv, detailGrain.z, detailGrain.w, detailGrainB.x, octaves) - 0.5;
    height += detailGrain.x * fade * n / max(detailGrain.y, 1e-4);
    shade += n * fade * detailGrain.x * 0.5;
  }
  #endif

  #ifdef SURFACE_DETAIL_GRANULAR
  slope *= detailStrength * detailShade.y * facing;
  worldNormal = normalize(worldNormal - (slope.x * planeU + slope.y * planeV));
  #endif
  #if defined(SURFACE_DETAIL_DUNES) || defined(SURFACE_DETAIL_GRANULAR)
  normal = normalize(mat3(viewMatrix) * worldNormal);
  #endif
  #ifdef SURFACE_DETAIL_GRAIN
  normal = perturbNormalHeight(normal, position, height * detailStrength * detailShade.y);
  #endif
  return 1.0 + clamp(shade * detailShade.x * detailStrength, -0.5, 0.5);
}
#endif
