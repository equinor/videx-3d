import {
  MeshStandardMaterial,
  MeshStandardMaterialParameters,
  Uniform,
  WebGLProgramParametersWithUniforms,
} from 'three';
import { makeOitCompatible } from '../../../rendering/oit-material';
import fragmentInject from './shaders/fragment-inject.glsl';
import vertexShader from './shaders/vertex.glsl';

/**
 * Parameters accepted by {@link CasingMaterial}. A `MeshStandardMaterial` at heart, so
 * it takes the familiar PBR knobs (`color`, `roughness`, `metalness`, `emissive`,
 * `envMap`, `envMapIntensity`, ...) plus the casing texture-UV units and the grouped
 * {@link CasingEffects | effects} below.
 *
 * @expand
 */
export type CasingMaterialParameters = MeshStandardMaterialParameters & {
  /** UV units for the base `map` (and the aoMap/lightMap/emissiveMap/metalnessMap/
   * roughnessMap group): `'normalized'` = 0..1 around/along, `'world'` = object-space
   * distance (arc length x trajectory distance) so `texture.repeat` becomes a density
   * that stays consistent across sections of different radius and length. Default
   * `'normalized'`. */
  mapUvUnits?: 'normalized' | 'world';
  /** UV units for `normalMap` / `bumpMap`, independent of {@link mapUvUnits}. Default
   * `'normalized'`. */
  normalMapUvUnits?: 'normalized' | 'world';
  /** Grouped casing stylization effects (silhouette outline, section edge shading,
   * procedural weathering, per-section variation and micro-normal surface detail).
   * Every sub-effect is optional and independent; omitted ones fall back to their
   * defaults (mostly off). */
  effects?: CasingEffects;
};

/**
 * Composable casing stylization effects for {@link CasingMaterial}. Every field is
 * optional and independent; the procedural surface-detail layers (`granular`,
 * `brushed`, `scratches`) simply sum. Strengths default to 0 (off) unless noted.
 * @expand
 */
export type CasingEffects = {
  /** View-space silhouette darkening that outlines each shell, helping nested strings
   * read apart (especially under slicing / auto-slice). */
  silhouette?: {
    /** 0-1 strength (0 = off). Default 0. */
    strength?: number;
    /** Exponent tightening the rim toward the edge (higher = tighter). Default 3. */
    power?: number;
  };
  /** Darkening at each section's own top/bottom edges. */
  edgeShading?: {
    /** 0-1 strength (0 = off). Default 0. */
    strength?: number;
    /** Distance in metres the darkening reaches from each edge, independent of section
     * length. Default 0.2. */
    width?: number;
  };
  /** Procedural wear/tear/spill (no textures), pinned in world space. */
  weathering?: {
    /** 0-1 strength (0 = off). Default 0. */
    strength?: number;
    /** Noise frequency in cells per real-world metre (lower = larger, sparser smears).
     * Default 1.5. */
    scale?: number;
    /** 0-1 per-material multiplier (1 = full wear, 0 = none) so a preset such as the
     * matte shoe can resist the weathering. Default 1. */
    resistance?: number;
  };
  /** 0-1 per-section wear variation so adjacent telescoping strings read apart by
   * looking differently worn rather than by a colour/value ramp. Default 0. */
  sectionVariation?: number;
  /** 0-1 performance vs. quality of the procedural surface detail (a fill-rate knob;
   * off-effects always cost nothing regardless). Lower = cheaper: fewer weathering fbm
   * octaves (2 at 0 .. 4 at 1) and the coarse/long scratch family only runs at >= 0.66.
   * 1 = full-detail reference. Default 0.6. */
  detailQuality?: number;
  /** Isotropic value-noise bumps. */
  granular?: {
    /** 0-1 strength (0 = off). Default 0. */
    strength?: number;
    /** Cells per world (object-distance) unit. Default 2. */
    frequency?: number;
    /** 1-5 fbm octaves. Default 3. */
    octaves?: number;
    /** 0-1 stretch of the cells along the trajectory axis. Default 0. */
    anisotropy?: number;
  };
  /** Directional fine grain (many thin parallel ridges). */
  brushed?: {
    /** 0-1 strength (0 = off). Default 0. */
    strength?: number;
    /** Cells per world (object-distance) unit. Default 2. */
    frequency?: number;
    /** 1-5 fbm octaves. Default 3. */
    octaves?: number;
    /** Grain direction in radians (0 = along the trajectory axis; non-zero angles
     * reintroduce a faint seam on a full shell). Default 0. */
    angle?: number;
    /** 0-1 line thinness. Default 0.5. */
    sharpness?: number;
    /** 0-1 blend from an irregular grain (0) to regular, evenly-spaced flutes (1).
     * Default 0. */
    uniformity?: number;
  };
  /** Sparse, hair-thin surface scuffs that glint under changing light (their relief is
   * kept very shallow - visibility comes from a localized polish, not depth). */
  scratches?: {
    /** 0-1 strength (0 = off). Default 0. */
    strength?: number;
    /** Cells per world (object-distance) unit. Default 10. */
    frequency?: number;
    /** 1-5 fbm octaves. Default 3. */
    octaves?: number;
    /** Scratch direction in radians (0 = along the trajectory axis). Default 0. */
    angle?: number;
    /** 0-1 how many scratches survive. Default 0.4. */
    density?: number;
    /** Average scratch length multiplier (>0). Default 0.6. */
    length?: number;
    /** 0-1 how much the scratch direction drifts. Default 1. */
    wander?: number;
    /** 0-1 groove width, frequency-independent (world-scaled, hair/needle-thin:
     * ~0.02..0.12mm half-width). Default 0.15. */
    width?: number;
  };
};

// -----------------------------------------------------------------------------
// Fragment effect snippets spliced into MeshStandardMaterial's stock physical
// fragment at the chunk seams (see onBeforeCompile). Shared helpers/uniforms are
// injected once after <common> via fragment-inject.glsl.
// -----------------------------------------------------------------------------

// After <color_fragment>: procedural wear (albedo darken/rust). Declares the shared
// floats (detailFade, casingWear, casingDull) used by the roughness/normal/shadow
// seams below.
const CASING_ALBEDO = /* glsl */ `
  // Distance/footprint fade for high-frequency decorative detail (rails, weathering,
  // edge shading), full strength up close and dialed down toward field-view distances so
  // it never becomes a noisy, aliasing signal.
  float detailFade = 1.0 - smoothstep(detailFadeNear, detailFadeFar, vViewPosition.z);

  // Procedural wear/tear/spill (no textures), sampled from a world-space 3D value-noise
  // field (vWorldPos) so it is pinned to world coordinates (no drift under slicing, no
  // circumferential seam). Sparse smears + specks + gravity drips, offset/scaled per
  // section so concentric strings read apart by looking differently worn.
  float casingWear = 0.0;
  float casingDull = 0.0;
  if (schematic < 0.5 && weathering > 0.0) {
    // Quality knob -> fbm octave count (2..4). Dropping the top octave(s) trims
    // barely-visible fine corrosion detail for a real per-fragment cost cut; at
    // detailQuality == 1 this is 4 octaves = the full-detail reference.
    int casingWOct = int(mix(2.0, 4.0, clamp(detailQuality, 0.0, 1.0)) + 0.5);
    float casingDown = clamp(-vWorldRadial.y, 0.0, 1.0);
    vec3 casingWp = vWorldPos * weatheringScale + sectionIndex * 37.0;
    float casingBase = casingFbm3(casingWp, casingWOct);
    float casingSmear = smoothstep(0.45, 0.75, casingBase);
    float casingSpeck = smoothstep(0.78, 0.95, casingNoise3(casingWp * 3.0));
    float casingDrip = smoothstep(0.6, 0.9, casingFbm3(casingWp * vec3(1.5, 0.1, 1.5), casingWOct)) * casingDown;
    float casingAmount = mix(1.0, 0.4 + 1.2 * casingHash(vec2(sectionIndex, 3.0)), sectionVariation);
    casingWear = weathering * casingAmount * detailFade * clamp(casingSmear * 0.8 + casingSpeck * 0.4 + casingDrip * 0.6, 0.0, 1.0);
    vec3 casingRust = vec3(0.34, 0.17, 0.08);
    diffuseColor.rgb = mix(diffuseColor.rgb, casingRust, 0.4 * casingWear * casingWear);
    diffuseColor.rgb *= (1.0 - 0.4 * casingWear);
    // Broad, continuous world-space wear field (+ heavy-patch boost) driving the PBR
    // roughening/de-metalising below, so the whole surface's shine clearly responds to
    // the wear slider - not just the sparse albedo patches. weathering is already
    // per-material wearResistance-scaled, so coated/shoe surfaces dull less.
    casingDull = clamp(weathering * (0.35 + 0.65 * casingBase) + casingWear, 0.0, 1.0);
  }
`;

// After <roughnessmap_fragment>: wear slightly roughens (softens) the reflection. Kept
// mild - the bulk of the "worn = dull" darkening is done by dimming the specular
// reflection after lighting (see CASING_SHADOW), because roughening a metal under a
// bright env can otherwise brighten it by averaging the hemisphere.
const CASING_ROUGHNESS = /* glsl */ `
  roughnessFactor = clamp(mix(roughnessFactor, 1.0, casingDull * 0.5), 0.04, 1.0);
`;

// After <normal_fragment_maps> (final normal available here): procedural micro-normal
// surface detail - composable granular bumps + brushed grain + scratches, driven by a
// U-tiling world coordinate so it aligns seamlessly around a full (un-sliced) shell.
// Perturbs the shading normal (+ a subtle albedo groove), replacing the old brushed
// rails. Then geometric roughness AA (Toksvig-style) widens roughness where the shading
// normal varies sub-pixel, taming the metallic sparkle on the casing's thin walls.
const CASING_NORMAL_AA = /* glsl */ `
  // Fresh-scratch polish weight (accumulated below); used after the roughness AA to
  // locally sharpen the specular inside scratch grooves.
  float casingScratch = 0.0;
  // detailFade > 0.0 short-circuits ALL of the high-frequency micro-normal work past the
  // fade distance, where its (detailFade-scaled) result is already zero anyway - so this
  // is appearance-neutral and just skips the noise on minified/far fragments. schematic
  // mode skips it too (unlit flat shading ignores the shading normal entirely).
  if (schematic < 0.5 && detailFade > 0.0 && (granularStrength + brushedStrength + scratchStrength) > 0.0) {
    // Each layer samples the procedural world UV directly, scaled by its frequency (cells
    // per world metre). vWorldUv is already object-distance units for every face (walls:
    // arc-length x along-trajectory; caps: cross-section Cartesian; edges: radial x along),
    // so no per-fragment circumference rounding is needed - that round() stepped with the
    // varying radius and produced concentric banding on caps/tapers. Each layer's height is
    // divided by its frequency so strength stays (roughly) frequency-independent; layers sum.
    float casingMnH = 0.0;
    float casingMnLines = 0.0;
    if (granularStrength > 0.0) {
      float f = max(granularFrequency, 0.01);
      // Wrap the along-trajectory coord in the METRE domain (where it is still precise)
      // before scaling by frequency, so deep sections don't push metres*f into the range
      // where fract() quantises -> banding. The noise tiles at PN_WRAP so the wrap is seamless.
      vec2 uv = vec2(vWorldUv.x, mod(vWorldUv.y, PN_WRAP / f)) * f;
      float aa = pnFootprintFade(uv, granularOctaves);
      // x7.5: the smooth granular field has a gentle gradient, so it needs much more
      // height than the sharp grain/scratch lines to read at the same strength.
      casingMnH += (granularStrength * aa * 7.5 / max(f, 1.0)) * pnGranular(uv, granularAnisotropy, granularOctaves, 0.0);
    }
    if (brushedStrength > 0.0) {
      float f = max(brushedFrequency, 0.01);
      vec2 uv = vec2(vWorldUv.x, mod(vWorldUv.y, PN_WRAP / f)) * f;
      float p = pnGrain(uv, brushedAngle, brushedSharpness, brushedUniformity, brushedOctaves, 0.0) * pnFootprintFade(uv, brushedOctaves);
      casingMnH += (brushedStrength / max(f, 1.0)) * p;
      casingMnLines += brushedStrength * p;
    }
    if (scratchStrength > 0.0) {
      float f = max(scratchFrequency, 0.01);
      vec2 uv = vec2(vWorldUv.x, mod(vWorldUv.y, PN_WRAP / f)) * f;
      // Hair/needle-thin groove half-width in WORLD metres (~0.02..0.12mm), converted to
      // sample-space cells by x f so it is FREQUENCY-INDEPENDENT: lowering scratchFrequency
      // yields longer, sparser scratches WITHOUT widening them (width is its own control).
      float scratchHalfW = mix(0.00002, 0.00012, clamp(scratchWidth, 0.0, 1.0)) * f;
      // Quality knob gates the coarse (long-groove) family: it is the most
      // repetition-prone AND doubles the scratch cost, so it is only summed in at high
      // detailQuality (>= 0.66) and otherwise skipped entirely.
      float scratchCoarse = step(0.66, clamp(detailQuality, 0.0, 1.0)) * 0.4;
      float p = pnScratches(uv, scratchAngle, scratchDensity, scratchLength, scratchHalfW, scratchWander, 0.0, scratchCoarse) * pnFootprintFade(uv, scratchOctaves);
      // Very shallow surface scuffs: only a whisper of normal tilt (much LESS than the
      // granular/brushed layers) so they never read as carved gouges. Their visibility
      // comes almost entirely from the localized polish (roughness drop below), which
      // makes them glint as the view/light direction changes.
      casingMnH += (scratchStrength * 0.6 / max(f, 1.0)) * p;
      casingScratch += scratchStrength * clamp(abs(p), 0.0, 1.0);
    }
    normal = perturbNormalHeight(normal, -vViewPosition, casingMnH * detailFade * 0.015);
    // Subtle albedo groove (kept from the old rails look): darken along the brushed grain
    // only - scratches are deliberately excluded so they stay invisible except as glints.
    diffuseColor.rgb *= (1.0 - 0.12 * detailFade * clamp(abs(casingMnLines), 0.0, 1.0));
  }

  // Geometric roughness AA (Toksvig) + fresh-scratch polish. Both feed the PBR lighting,
  // which schematic (unlit) mode discards - so skip the whole block there.
  if (schematic < 0.5) {
    vec3 casingDNx = dFdx(normal);
    vec3 casingDNy = dFdy(normal);
    float casingNvar = 0.5 * (dot(casingDNx, casingDNx) + dot(casingDNy, casingDNy));
    roughnessFactor = min(1.0, sqrt(roughnessFactor * roughnessFactor + casingNvar));
    // Fresh scratches expose polished metal: drop roughness inside the groove AFTER the
    // roughness AA above (which would otherwise re-dull them via their own normal variance),
    // so they read as bright anisotropic specular streaks that glint as the piece turns.
    // This localized polish is the PRIMARY visibility cue for the hair-thin scuffs.
    roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.3, clamp(casingScratch, 0.0, 1.0) * detailFade);
  }
`;

// Before <aomap_fragment> (reflectedLight fully accumulated): worn/oxidised metal dims its
// specular reflection (driven by the procedural weathering wear field).
const CASING_SHADOW = /* glsl */ `
  // Worn/oxidised metal reflects + shines less. Dim the specular reflection DIRECTLY by
  // the broad wear field (roughening a metal under a bright studio env can otherwise
  // brighten it by averaging the hemisphere - the opposite of the intended dull look).
  if (schematic < 0.5 && casingDull > 0.0) {
    float casingShine = 1.0 - 0.75 * casingDull;
    reflectedLight.directSpecular *= casingShine;
    reflectedLight.indirectSpecular *= casingShine;
  }
`;

// Before <opaque_fragment> (outgoingLight declared): view-space silhouette darkening
// (outlines each shell to tell them apart) + edge shading at each section's own
// top/bottom edges.
const CASING_EDGE_SHADING = /* glsl */ `
  if (schematic > 0.5) {
    // Unlit "schematic" shading: replace the whole PBR result with the flat material
    // color (the diffuse uniform = the color property). Taking the raw color uniform
    // - not diffuseColor - means map / weathering / emissive / metalness / roughness /
    // env are ALL ignored (only color survives), and dropping the lighting removes the
    // specular shimmer that dominates casing aliasing. Opacity still flows via
    // diffuseColor.a below. The silhouette outline is applied on top (both modes).
    outgoingLight = diffuse;
  }
  if (silhouette > 0.0) {
    // Tight Fresnel rim: darkens toward the grazing-angle silhouette so nested shells
    // read apart by their outline (especially under slicing / auto-slice). silhouettePower
    // tightens the band toward the very edge (higher = tighter). The fwidth() floor caps
    // the peak when the rim goes sub-pixel, anti-aliasing the outline at a distance.
    float casingNdv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
    float casingNdvAA = max(casingNdv, fwidth(casingNdv));
    float casingFresnel = pow(1.0 - casingNdvAA, silhouettePower);
    outgoingLight *= (1.0 - silhouette * casingFresnel);
  }
  if (schematic < 0.5 && edgeShading > 0.0) {
    // Dark band at THIS section's own top and bottom edges (vSectionPos is 0 at the
    // section top, 1 at the bottom). Purely section-local - independent of any shells
    // nested inside or outside it. The darkening reaches a FIXED world distance
    // (edgeShadingWidth metres) from each edge regardless of section length, with a
    // slight per-section variation so the edges don't read perfectly uniform.
    // Footprint-AA'd so it never falls below a pixel (no aliasing) when zoomed out.
    float edgeVar = mix(0.7, 1.3, casingHash(vec2(sectionIndex, 7.0)));
    float casingBandSP = (edgeShadingWidth * edgeVar) / max(vSectionLength, 1e-3);
    float casingBand = max(casingBandSP, fwidth(vSectionPos));
    float casingEdge = max(1.0 - smoothstep(0.0, casingBand, vSectionPos), 1.0 - smoothstep(0.0, casingBand, 1.0 - vSectionPos));
    casingEdge *= (1.0 - vWall) * edgeShading * detailFade;
    outgoingLight *= (1.0 - 0.6 * casingEdge);
  }
`;

/**
 * Physically-based (PBR) material for `Casings` / `CasingSection`. A
 * `MeshStandardMaterial` at its core - so casings pick up real image-based
 * reflections from the scene `environment`, exactly matching neighbouring
 * `CompletionTools` - with the casing-specific stylization (procedural weathering,
 * granular/brushed/scratch micro-normal detail, silhouette darkening and edge shading)
 * spliced into its shaders via `onBeforeCompile`, and the slicing/vertex
 * transform driven by the same custom attributes as the picking material.
 *
 * OIT-capable via {@link makeOitCompatible} so casings participate in the
 * `OITRenderPass` hybrid pipeline (a no-op in the default render loop).
 */
export class CasingMaterial extends MeshStandardMaterial {
  isCasingMaterial = true;

  private _weathering = 0;
  private _wearResistance = 1;
  private _wellLength = 1;

  /** Custom uniforms bound into the patched program in {@link onBeforeCompile} and
   * shared by reference with the OIT variants so per-frame updates propagate. */
  uniforms = {
    // slicing / vertex transform (unchanged geometry contract with the picking material)
    sizeMultiplier: new Uniform(1),
    radius: new Uniform(0),
    innerRadius: new Uniform(0),
    sliceOffset: new Uniform(0),
    sliceAngle: new Uniform(0),
    autoSlicePosition: new Uniform(false),
    // stylization
    sectionVariation: new Uniform(0),
    silhouette: new Uniform(0),
    silhouettePower: new Uniform(3),
    edgeShading: new Uniform(0),
    edgeShadingWidth: new Uniform(0.2),
    sectionIndex: new Uniform(-1),
    detailFadeNear: new Uniform(120),
    detailFadeFar: new Uniform(600),
    detailQuality: new Uniform(0.6),
    schematic: new Uniform(0),
    // texture UV units (per texture type): 0 = normalized 0..1, 1 = world distance
    mapUvWorld: new Uniform(0),
    normalMapUvWorld: new Uniform(0),
    wellLength: new Uniform(1),
    // procedural micro-normal: three layers that sum, each with its own strength/freq/octaves
    granularStrength: new Uniform(0),
    granularFrequency: new Uniform(2),
    granularOctaves: new Uniform(3),
    granularAnisotropy: new Uniform(0),
    brushedStrength: new Uniform(0),
    brushedFrequency: new Uniform(2),
    brushedOctaves: new Uniform(3),
    brushedAngle: new Uniform(0),
    brushedSharpness: new Uniform(0.5),
    brushedUniformity: new Uniform(0),
    scratchStrength: new Uniform(0),
    scratchFrequency: new Uniform(10),
    scratchOctaves: new Uniform(3),
    scratchAngle: new Uniform(0),
    scratchDensity: new Uniform(0.4),
    scratchLength: new Uniform(0.6),
    scratchWander: new Uniform(1),
    scratchWidth: new Uniform(0.15),
    // procedural wear
    weathering: new Uniform(0),
    weatheringScale: new Uniform(1.5),
  };

  constructor(parameters: CasingMaterialParameters = {}) {
    // Custom setters touch `this.uniforms`/private fields, which only exist AFTER the
    // super() field initialisers run, so keep them out of the MeshStandardMaterial
    // constructor and apply them below.
    const { mapUvUnits, normalMapUvUnits, effects, ...standard } = parameters;
    super(standard);

    if (mapUvUnits !== undefined) this.mapUvUnits = mapUvUnits;
    if (normalMapUvUnits !== undefined)
      this.normalMapUvUnits = normalMapUvUnits;
    if (effects !== undefined) this.effects = effects;

    // Participate in the OIT pipeline (no-op otherwise). The custom `uniforms` object is
    // shared by reference with the per-pass variants so per-frame slicing/stylization
    // updates keep working.
    makeOitCompatible(this, { shareUniforms: ['uniforms'] });
  }

  get sizeMultiplier() {
    return this.uniforms.sizeMultiplier.value;
  }

  set sizeMultiplier(v: number) {
    this.uniforms.sizeMultiplier.value = v;
  }

  get radius() {
    return this.uniforms.radius.value;
  }

  set radius(v: number) {
    this.uniforms.radius.value = v;
  }

  get innerRadius() {
    return this.uniforms.innerRadius.value;
  }

  set innerRadius(v: number) {
    this.uniforms.innerRadius.value = v;
  }

  get sliceOffset() {
    return this.uniforms.sliceOffset.value;
  }

  set sliceOffset(v: number) {
    this.uniforms.sliceOffset.value = v;
  }

  get sliceAngle() {
    return this.uniforms.sliceAngle.value;
  }

  set sliceAngle(v: number) {
    this.uniforms.sliceAngle.value = v;
  }

  get autoSlicePosition() {
    return this.uniforms.autoSlicePosition.value;
  }

  set autoSlicePosition(v: boolean) {
    this.uniforms.autoSlicePosition.value = !!v;
  }

  /** 0-1 strength of the per-section wear variation: how much each section's
   * procedural wear is offset (seed) and scaled (amount) by its index, so adjacent
   * telescoping strings read apart by looking differently worn rather than by a
   * colour/value ramp. */
  get sectionVariation() {
    return this.uniforms.sectionVariation.value;
  }

  set sectionVariation(v: number) {
    this.uniforms.sectionVariation.value = v;
  }

  /** 0-1 strength of the view-space silhouette darkening (outlines each shell). */
  get silhouette() {
    return this.uniforms.silhouette.value;
  }

  set silhouette(v: number) {
    this.uniforms.silhouette.value = v;
  }

  /** Exponent tightening the silhouette rim toward the edge (higher = tighter). Default 3. */
  get silhouettePower() {
    return this.uniforms.silhouettePower.value;
  }

  set silhouettePower(v: number) {
    this.uniforms.silhouettePower.value = v;
  }

  /** 0-1 strength of the edge shading (darkening at each section's own top/bottom edges). */
  get edgeShading() {
    return this.uniforms.edgeShading.value;
  }

  set edgeShading(v: number) {
    this.uniforms.edgeShading.value = v;
  }

  /** Distance in metres the edge shading reaches from each section edge. Default 0.2. */
  get edgeShadingWidth() {
    return this.uniforms.edgeShadingWidth.value;
  }

  set edgeShadingWidth(v: number) {
    this.uniforms.edgeShadingWidth.value = v;
  }

  /** Index of this section within the wellbore's casing stack, used to seed the
   * per-section variation of the stylization effects. */
  get sectionIndex() {
    return this.uniforms.sectionIndex.value;
  }

  set sectionIndex(v: number) {
    this.uniforms.sectionIndex.value = v;
  }

  /** 0-1 performance vs. quality of the procedural surface detail (fill-rate knob).
   * Lower = cheaper (fewer weathering fbm octaves; the coarse scratch family only runs
   * at >= 0.66); 1 = full-detail reference. */
  get detailQuality() {
    return this.uniforms.detailQuality.value;
  }

  set detailQuality(v: number) {
    this.uniforms.detailQuality.value = v;
  }

  /** Unlit "schematic" shading mode: flat material `color` + `silhouette` outline only,
   * with all lighting/env, textures and realism detail ignored. Set by the `Casings`
   * component's `schematic` prop; the slice is locked separately (component side). */
  get schematic() {
    return this.uniforms.schematic.value > 0.5;
  }

  set schematic(v: boolean) {
    this.uniforms.schematic.value = v ? 1 : 0;
  }

  /** 0-1 strength of the procedural wear/tear/spill surface detail (no textures). The
   * effective amount is scaled per-material by {@link wearResistance}. */
  get weathering() {
    return this._weathering;
  }

  set weathering(v: number) {
    this._weathering = v;
    this.uniforms.weathering.value = v * this._wearResistance;
  }

  /** 0-1 per-material wear multiplier (1 = full wear, 0 = none). Lets material presets
   * (e.g. the matte shoe) resist the procedural weathering the component applies
   * globally via {@link weathering}. */
  get wearResistance() {
    return this._wearResistance;
  }

  set wearResistance(v: number) {
    this._wearResistance = v;
    this.uniforms.weathering.value = this._weathering * v;
  }

  /** Weathering noise frequency in cells per real-world metre (lower = larger,
   * sparser smears). */
  get weatheringScale() {
    return this.uniforms.weatheringScale.value;
  }

  set weatheringScale(v: number) {
    this.uniforms.weatheringScale.value = v;
  }

  /** Real-world total length (metres) of the whole wellbore trajectory. Retained for
   * API compatibility with the component wiring; the weathering is now pinned in world
   * space (via `vWorldPos`) so this no longer feeds the shader. */
  get wellLength() {
    return this._wellLength;
  }

  set wellLength(v: number) {
    this._wellLength = Math.max(v, 1e-3);
    this.uniforms.wellLength.value = this._wellLength;
  }

  /** UV units for the base `map` group. `'world'` uses object-space distance so
   * `texture.repeat` is a radius/length-consistent density. */
  get mapUvUnits(): 'normalized' | 'world' {
    return this.uniforms.mapUvWorld.value > 0.5 ? 'world' : 'normalized';
  }

  set mapUvUnits(v: 'normalized' | 'world') {
    this.uniforms.mapUvWorld.value = v === 'world' ? 1 : 0;
  }

  /** UV units for `normalMap` / `bumpMap`, independent of {@link mapUvUnits}. */
  get normalMapUvUnits(): 'normalized' | 'world' {
    return this.uniforms.normalMapUvWorld.value > 0.5 ? 'world' : 'normalized';
  }

  set normalMapUvUnits(v: 'normalized' | 'world') {
    this.uniforms.normalMapUvWorld.value = v === 'world' ? 1 : 0;
  }

  /** Grouped casing stylization effects (silhouette, edge shading, weathering,
   * per-section variation and the granular/brushed/scratch micro-normal layers).
   * Reading returns the current settings reconstructed from the uniforms. Assigning
   * applies the whole group at once - omitted sub-effects reset to their defaults. */
  get effects(): CasingEffects {
    const u = this.uniforms;
    return {
      silhouette: { strength: this.silhouette, power: this.silhouettePower },
      edgeShading: {
        strength: this.edgeShading,
        width: this.edgeShadingWidth,
      },
      weathering: {
        strength: this._weathering,
        scale: this.weatheringScale,
        resistance: this._wearResistance,
      },
      sectionVariation: this.sectionVariation,
      detailQuality: this.detailQuality,
      granular: {
        strength: u.granularStrength.value,
        frequency: u.granularFrequency.value,
        octaves: u.granularOctaves.value,
        anisotropy: u.granularAnisotropy.value,
      },
      brushed: {
        strength: u.brushedStrength.value,
        frequency: u.brushedFrequency.value,
        octaves: u.brushedOctaves.value,
        angle: u.brushedAngle.value,
        sharpness: u.brushedSharpness.value,
        uniformity: u.brushedUniformity.value,
      },
      scratches: {
        strength: u.scratchStrength.value,
        frequency: u.scratchFrequency.value,
        octaves: u.scratchOctaves.value,
        angle: u.scratchAngle.value,
        density: u.scratchDensity.value,
        length: u.scratchLength.value,
        wander: u.scratchWander.value,
        width: u.scratchWidth.value,
      },
    };
  }

  set effects(v: CasingEffects | undefined) {
    // Silhouette / edge shading fan out to the individual uniform setters.
    this.silhouette = v?.silhouette?.strength ?? 0;
    this.silhouettePower = v?.silhouette?.power ?? 3;
    this.edgeShading = v?.edgeShading?.strength ?? 0;
    this.edgeShadingWidth = v?.edgeShading?.width ?? 0.2;
    // Weathering: set resistance BEFORE strength so the derived (strength x resistance)
    // uniform ends up correct (both setters recompute it).
    this.wearResistance = v?.weathering?.resistance ?? 1;
    this.weathering = v?.weathering?.strength ?? 0;
    this.weatheringScale = v?.weathering?.scale ?? 1.5;
    this.sectionVariation = v?.sectionVariation ?? 0;
    this.detailQuality = v?.detailQuality ?? 0.6;
    // Micro-normal layers.
    const u = this.uniforms;
    u.granularStrength.value = v?.granular?.strength ?? 0;
    u.granularFrequency.value = v?.granular?.frequency ?? 2;
    u.granularOctaves.value = Math.max(
      1,
      Math.round(v?.granular?.octaves ?? 3),
    );
    u.granularAnisotropy.value = v?.granular?.anisotropy ?? 0;
    u.brushedStrength.value = v?.brushed?.strength ?? 0;
    u.brushedFrequency.value = v?.brushed?.frequency ?? 2;
    u.brushedOctaves.value = Math.max(1, Math.round(v?.brushed?.octaves ?? 3));
    u.brushedAngle.value = v?.brushed?.angle ?? 0;
    u.brushedSharpness.value = v?.brushed?.sharpness ?? 0.5;
    u.brushedUniformity.value = v?.brushed?.uniformity ?? 0;
    u.scratchStrength.value = v?.scratches?.strength ?? 0;
    u.scratchFrequency.value = v?.scratches?.frequency ?? 10;
    u.scratchOctaves.value = Math.max(
      1,
      Math.round(v?.scratches?.octaves ?? 3),
    );
    u.scratchAngle.value = v?.scratches?.angle ?? 0;
    u.scratchDensity.value = v?.scratches?.density ?? 0.4;
    u.scratchLength.value = v?.scratches?.length ?? 0.6;
    u.scratchWander.value = v?.scratches?.wander ?? 1;
    u.scratchWidth.value = v?.scratches?.width ?? 0.15;
  }

  // @ignore
  onBeforeCompile(parameters: WebGLProgramParametersWithUniforms): void {
    const u = this.uniforms;
    parameters.uniforms.sizeMultiplier = u.sizeMultiplier;
    parameters.uniforms.innerRadius = u.innerRadius;
    parameters.uniforms.sliceOffset = u.sliceOffset;
    parameters.uniforms.sliceAngle = u.sliceAngle;
    parameters.uniforms.autoSlicePosition = u.autoSlicePosition;
    parameters.uniforms.sectionVariation = u.sectionVariation;
    parameters.uniforms.silhouette = u.silhouette;
    parameters.uniforms.silhouettePower = u.silhouettePower;
    parameters.uniforms.edgeShading = u.edgeShading;
    parameters.uniforms.edgeShadingWidth = u.edgeShadingWidth;
    parameters.uniforms.sectionIndex = u.sectionIndex;
    parameters.uniforms.detailFadeNear = u.detailFadeNear;
    parameters.uniforms.detailFadeFar = u.detailFadeFar;
    parameters.uniforms.detailQuality = u.detailQuality;
    parameters.uniforms.schematic = u.schematic;
    parameters.uniforms.mapUvWorld = u.mapUvWorld;
    parameters.uniforms.normalMapUvWorld = u.normalMapUvWorld;
    parameters.uniforms.wellLength = u.wellLength;
    parameters.uniforms.granularStrength = u.granularStrength;
    parameters.uniforms.granularFrequency = u.granularFrequency;
    parameters.uniforms.granularOctaves = u.granularOctaves;
    parameters.uniforms.granularAnisotropy = u.granularAnisotropy;
    parameters.uniforms.brushedStrength = u.brushedStrength;
    parameters.uniforms.brushedFrequency = u.brushedFrequency;
    parameters.uniforms.brushedOctaves = u.brushedOctaves;
    parameters.uniforms.brushedAngle = u.brushedAngle;
    parameters.uniforms.brushedSharpness = u.brushedSharpness;
    parameters.uniforms.brushedUniformity = u.brushedUniformity;
    parameters.uniforms.scratchStrength = u.scratchStrength;
    parameters.uniforms.scratchFrequency = u.scratchFrequency;
    parameters.uniforms.scratchOctaves = u.scratchOctaves;
    parameters.uniforms.scratchAngle = u.scratchAngle;
    parameters.uniforms.scratchDensity = u.scratchDensity;
    parameters.uniforms.scratchLength = u.scratchLength;
    parameters.uniforms.scratchWander = u.scratchWander;
    parameters.uniforms.scratchWidth = u.scratchWidth;
    parameters.uniforms.weathering = u.weathering;
    parameters.uniforms.weatheringScale = u.weatheringScale;

    // Custom vertex transform (slicing + world varyings the fragment effects need).
    parameters.vertexShader = vertexShader;

    // Splice the casing stylization into the stock physical fragment at the chunk
    // seams, keeping the real PBR lighting + environment (IBL) reflection intact.
    parameters.fragmentShader = parameters.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragmentInject}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${CASING_ALBEDO}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n${CASING_ROUGHNESS}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${CASING_NORMAL_AA}`,
      )
      .replace(
        '#include <aomap_fragment>',
        `${CASING_SHADOW}\n#include <aomap_fragment>`,
      )
      .replace(
        '#include <opaque_fragment>',
        `${CASING_EDGE_SHADING}\n#include <opaque_fragment>`,
      );
  }
}
