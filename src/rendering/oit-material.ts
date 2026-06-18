import {
  AddEquation,
  CustomBlending,
  IUniform,
  Material,
  MinEquation,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Side,
  SrcAlphaFactor,
  Texture,
  Uniform,
  Vector2,
  WebGLProgramParametersWithUniforms,
} from 'three';
import oitChunk from '../sdk/materials/shaderLib/oit.glsl';

/**
 * The OIT render passes a material provides a variant for.
 * - `depthMin`: min view-space linear depth pre-pass (front-layer detection)
 * - `accum`: single-buffer weighted-blended OIT tail (b-weighted, carries coverage)
 * - `front`: exact depth-peeled front layer (alpha-over)
 * - `occlusion`: optional depth-only stamp that writes depth where the surface's own
 *   alpha clears `oitOcclusionThreshold` (used to occlude annotation labels). Off by
 *   default; its program is only compiled by Three when the pass actually renders it.
 */
export type OitPass = 'depthMin' | 'accum' | 'front' | 'occlusion';

/** The set of per-pass variant materials used by the OITRenderPass. */
export type OitVariants = Record<OitPass, Material>;

/** The OIT uniforms shared across a material's variants and set by the pass. */
export type OitUniforms = {
  oitDepthFar: IUniform<number>;
  oitScreenSize: IUniform<Vector2>;
  oitMinDepthTexture: IUniform<Texture | null>;
  oitSkipFront: IUniform<number>;
  oitOcclusionThreshold: IUniform<number>;
};

/**
 * A material that can participate in the {@link OITRenderPass} hybrid pipeline.
 * Implemented by library materials (via {@link attachOitVariants}) and by patched
 * stock / user materials (via {@link makeOitCompatible}).
 */
export interface OitCapableMaterial {
  /** Returns the lazily-built per-pass variant materials (shared uniforms). */
  getOitVariants(): OitVariants;
  /** Returns the OIT uniforms object the pass updates each frame. */
  getOitUniforms(): OitUniforms;
}

/** Options for making a material OIT-compatible. */
export type OitMaterialOptions = {
  /**
   * Force a specific `side` on all variants (e.g. `DoubleSide` for surfaces so back
   * faces contribute to the tail). Defaults to the base material's side.
   */
  side?: Side;
  /**
   * Names of properties on the material that hold uniform containers (objects of
   * `IUniform`) which should be shared *by reference* with each per-pass variant.
   * `ShaderMaterial` variants already share `uniforms`, but non-`ShaderMaterial`
   * materials are cloned, so any custom uniform object they read in
   * `onBeforeCompile` (e.g. a `uniforms` field used for slicing) must be listed
   * here for live per-frame updates to reach the variants.
   */
  shareUniforms?: string[];
  /**
   * Names of **value** properties to keep in sync from the base material onto the
   * per-pass variants every frame. Only relevant for stock/built-in materials, whose
   * variants are *cloned* and would otherwise snapshot their appearance at build time
   * (`ShaderMaterial` variants share `uniforms` and are always live, so this is
   * ignored for them).
   *
   * Restricted to value properties that do **not** affect the compiled program:
   * - primitives (e.g. `metalness`, `roughness`, `emissiveIntensity`), and
   * - copyable value objects with a `.copy()` method (e.g. `color`, `emissive` —
   *   `Color`; or `Vector2/3/4`), which are copied in place (no allocation, no
   *   recompile).
   *
   * Do **not** list program-affecting properties here (textures such as `map`,
   * `vertexColors`, anything that toggles a shader `#define`) — changing those needs
   * a recompile and is intentionally unsupported through this fast path. `opacity` is
   * always kept live and need not be listed. Use {@link COMMON_OIT_SYNC_PROPS} for a
   * sensible default set.
   *
   * @example
   * ```ts
   * makeOitCompatible(material, { syncProperties: ['color', 'metalness'] });
   * // or spread the common set:
   * makeOitCompatible(material, { syncProperties: [...COMMON_OIT_SYNC_PROPS] });
   * ```
   */
  syncProperties?: string[];
};

/**
 * A convenient default set of common appearance properties to pass as
 * {@link OitMaterialOptions.syncProperties} so runtime changes (e.g. recoloring) are
 * reflected through the OIT passes for cloned built-in materials. Properties not
 * present on a given material are ignored.
 *
 * @group Rendering
 */
export const COMMON_OIT_SYNC_PROPS = [
  'color',
  'emissive',
  'emissiveIntensity',
  'metalness',
  'roughness',
] as const;

/** Type guard for {@link OitCapableMaterial}. */
export function isOitCapable(
  material: Material | null | undefined,
): material is Material & OitCapableMaterial {
  return (
    !!material &&
    typeof (material as Partial<OitCapableMaterial>).getOitVariants ===
      'function' &&
    typeof (material as Partial<OitCapableMaterial>).getOitUniforms ===
      'function'
  );
}

function isShaderMaterial(material: Material): material is ShaderMaterial {
  return (material as ShaderMaterial).isShaderMaterial === true;
}

/** A value object that can be copied in place (e.g. `Color`, `Vector2/3/4`). */
type Copyable = { copy(source: unknown): unknown };

function isCopyable(value: unknown): value is Copyable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Copyable).copy === 'function'
  );
}

function createOitUniforms(): OitUniforms {
  return {
    oitDepthFar: new Uniform(1),
    oitScreenSize: new Uniform(new Vector2(1, 1)),
    oitMinDepthTexture: new Uniform<Texture | null>(null),
    oitSkipFront: new Uniform(0),
    oitOcclusionThreshold: new Uniform(1),
  };
}

/**
 * Material fields beyond uniforms that affect the compiled program or the way a
 * variant rasterises, and which can change at runtime on the base material (and so
 * must be mirrored onto the variants).
 */
type ProgramState = Material & {
  defines?: Record<string, unknown>;
  wireframe?: boolean;
  flatShading?: boolean;
  uniformsGroups?: unknown[];
};

/** Per-pass extra define (besides `USE_OIT`). `accum` needs none. */
const PASS_DEFINE: Record<OitPass, string | null> = {
  depthMin: 'OIT_DEPTH_PASS',
  accum: null,
  front: 'OIT_FRONT_PASS',
  occlusion: 'OIT_OCCLUSION_PASS',
};

/**
 * Configure a variant's static blend mode and depth state for a specific OIT pass.
 * Depth is shared with the opaque pass, so all variants test against it but never
 * write. This state does not change at runtime, so it is set once at build time.
 */
function configureVariantBlend(
  variant: Material,
  pass: OitPass,
  side: Side | undefined,
) {
  variant.transparent = true;
  variant.depthTest = true;
  variant.depthWrite = false;
  variant.blending = CustomBlending;
  variant.toneMapped = false;
  if (side !== undefined) variant.side = side;

  switch (pass) {
    case 'depthMin':
      variant.blendEquation = MinEquation;
      variant.blendSrc = OneFactor;
      variant.blendDst = OneFactor;
      variant.blendEquationAlpha = MinEquation;
      variant.blendSrcAlpha = OneFactor;
      variant.blendDstAlpha = OneFactor;
      break;
    case 'accum':
      variant.blendEquation = AddEquation;
      variant.blendSrc = OneFactor;
      variant.blendDst = OneFactor;
      variant.blendEquationAlpha = AddEquation;
      variant.blendSrcAlpha = OneFactor;
      variant.blendDstAlpha = OneFactor;
      break;
    case 'front':
      variant.blendEquation = AddEquation;
      variant.blendSrc = SrcAlphaFactor;
      variant.blendDst = OneMinusSrcAlphaFactor;
      variant.blendEquationAlpha = AddEquation;
      variant.blendSrcAlpha = OneFactor;
      variant.blendDstAlpha = OneMinusSrcAlphaFactor;
      break;
    case 'occlusion':
      // Depth-only stamp: write depth (tested against the opaque depth) where the
      // fragment shader keeps the fragment, and write no colour.
      variant.transparent = false;
      variant.depthWrite = true;
      variant.colorWrite = false;
      variant.blending = NoBlending;
      break;
  }
}

/**
 * A compact signature of the base material's program-affecting state, used to detect
 * when variants need re-syncing (and a recompile).
 */
function programSignature(base: Material): string {
  const b = base as ProgramState;
  return [
    JSON.stringify(b.defines ?? {}),
    b.wireframe ? 1 : 0,
    b.flatShading ? 1 : 0,
    b.uniformsGroups ? b.uniformsGroups.length : 0,
    base.vertexColors ? 1 : 0,
  ].join('|');
}

/**
 * Mirror the base material's program-affecting state (defines, wireframe, flat
 * shading, uniform groups, vertex colors) onto a variant for the given pass, then
 * append the OIT defines. Triggers a variant recompile via `needsUpdate`.
 *
 * The base material's appearance is toggled at runtime through these fields (e.g. a
 * surface's color-ramp / contours / wireframe), so without this sync the cached
 * variants would keep stale programs and render incorrectly in the OIT passes.
 */
function syncVariantProgram(variant: Material, base: Material, pass: OitPass) {
  const b = base as ProgramState;
  const v = variant as ProgramState;

  // Per-pass defines give each variant a distinct program cache key. USE_OIT enables
  // the shared OIT shader logic; the base material never defines it.
  const defines: Record<string, unknown> = {
    ...(b.defines ?? {}),
    USE_OIT: '',
  };
  const passDefine = PASS_DEFINE[pass];
  if (passDefine) defines[passDefine] = '';
  v.defines = defines;

  if ('wireframe' in b) v.wireframe = b.wireframe;
  if ('flatShading' in b) v.flatShading = b.flatShading;
  if (b.uniformsGroups) v.uniformsGroups = b.uniformsGroups;
  variant.vertexColors = base.vertexColors;

  variant.needsUpdate = true;
}

/**
 * Build a single variant for the given pass. ShaderMaterials are copied and share
 * the base uniforms object (live updates propagate); other materials are cloned
 * (appearance is snapshotted at build time). In both cases `onBeforeCompile` and the
 * program cache key are re-linked, since `Material.copy`/`clone` drop them.
 */
function buildVariant(
  base: Material,
  pass: OitPass,
  options?: OitMaterialOptions,
): Material {
  let variant: Material;
  if (isShaderMaterial(base)) {
    const v = new ShaderMaterial();
    v.copy(base);
    // Share the base uniforms object so live uniform updates (and the OIT uniforms
    // set by the pass) propagate to every variant.
    v.uniforms = base.uniforms;
    variant = v;
  } else {
    variant = base.clone();
  }

  // Share designated custom uniform containers by reference so per-frame updates
  // on the base material reach every cloned variant (e.g. casing slice uniforms).
  if (options?.shareUniforms) {
    const src = base as unknown as Record<string, unknown>;
    const dst = variant as unknown as Record<string, unknown>;
    for (const key of options.shareUniforms) {
      dst[key] = src[key];
    }
  }

  variant.onBeforeCompile = base.onBeforeCompile;
  variant.customProgramCacheKey = base.customProgramCacheKey;
  configureVariantBlend(variant, pass, options?.side);
  syncVariantProgram(variant, base, pass);
  return variant;
}

const OIT_PASSES: OitPass[] = ['depthMin', 'accum', 'front', 'occlusion'];

/**
 * Attach the OIT variant machinery to a material. Used both by library materials
 * (whose shaders already `#include` `oit.glsl`) via {@link attachOitVariants} and by
 * the injection path in {@link makeOitCompatible}. Variants are built lazily and
 * cached; disposing the material frees the variant programs.
 */
function installOitVariants<T extends Material>(
  material: T,
  uniforms: OitUniforms,
  options?: OitMaterialOptions,
): T & OitCapableMaterial {
  const capable = material as T & OitCapableMaterial;
  let variants: OitVariants | null = null;
  let lastSignature = '';

  // ShaderMaterial variants share the base `uniforms` object, so live opacity
  // updates propagate automatically. Cloned (built-in) variants snapshot `opacity`
  // at build time, so it must be re-synced from the base each frame.
  const clonedVariants = !isShaderMaterial(material);

  // Extra value properties to keep live on cloned variants (e.g. `color`). Filtered
  // once to those actually present on the material, and only meaningful when cloned
  // (ShaderMaterial variants are already live via shared uniforms). `opacity` is
  // always synced below and excluded here to avoid redundant work.
  const baseRecord = material as unknown as Record<string, unknown>;
  const syncProps =
    clonedVariants && options?.syncProperties
      ? options.syncProperties.filter(p => p !== 'opacity' && p in baseRecord)
      : [];

  capable.getOitUniforms = () => uniforms;

  capable.getOitVariants = () => {
    if (!variants) {
      variants = {
        depthMin: buildVariant(material, 'depthMin', options),
        accum: buildVariant(material, 'accum', options),
        front: buildVariant(material, 'front', options),
        occlusion: buildVariant(material, 'occlusion', options),
      };
      lastSignature = programSignature(material);
    } else {
      // Re-sync variant programs if the base material's program-affecting state
      // (defines/wireframe/etc.) changed since the last call. Cheap when unchanged.
      const signature = programSignature(material);
      if (signature !== lastSignature) {
        lastSignature = signature;
        for (const pass of OIT_PASSES) {
          syncVariantProgram(variants[pass], material, pass);
        }
      }
    }

    // Keep cloned variants' live alpha in sync (drives the OIT fragment alpha), plus
    // any user-requested value properties (e.g. `color`). Copyable value objects are
    // copied in place (no allocation, no recompile); primitives are assigned.
    if (clonedVariants) {
      for (const pass of OIT_PASSES) {
        const variant = variants[pass];
        variant.opacity = material.opacity;
        if (syncProps.length) {
          const variantRecord = variant as unknown as Record<string, unknown>;
          for (const p of syncProps) {
            const baseVal = baseRecord[p];
            const variantVal = variantRecord[p];
            if (
              isCopyable(variantVal) &&
              isCopyable(baseVal) &&
              variantVal.constructor === baseVal.constructor
            ) {
              variantVal.copy(baseVal);
            } else {
              variantRecord[p] = baseVal;
            }
          }
        }
      }
    }

    return variants;
  };

  const baseDispose = material.dispose.bind(material);
  material.dispose = () => {
    if (variants) {
      for (const pass of OIT_PASSES) {
        // Free only the variant's program; never touch shared uniforms/textures.
        Material.prototype.dispose.call(variants[pass]);
      }
      variants = null;
    }
    baseDispose();
  };

  return capable;
}

/**
 * Make a library `ShaderMaterial` OIT-capable. The material's fragment shader is
 * expected to already `#include` `oit.glsl` and call `oitProcess(gl_FragColor)`
 * guarded by `#ifdef USE_OIT` (a no-op in the default pipeline). This adds the OIT
 * uniforms to the material and attaches the per-pass variant machinery.
 *
 * @param material - the library ShaderMaterial to extend
 * @param options - optional overrides (e.g. `side`)
 * @returns the same material, typed as {@link OitCapableMaterial}
 *
 * @group Rendering
 * @see {@link makeOitCompatible}
 */
export function attachOitVariants<T extends ShaderMaterial>(
  material: T,
  options?: OitMaterialOptions,
): T & OitCapableMaterial {
  const uniforms = createOitUniforms();
  const u = material.uniforms as Record<string, IUniform>;
  // Add OIT uniforms without clobbering anything already present.
  u.oitDepthFar ??= uniforms.oitDepthFar;
  u.oitScreenSize ??= uniforms.oitScreenSize;
  u.oitMinDepthTexture ??= uniforms.oitMinDepthTexture;
  u.oitSkipFront ??= uniforms.oitSkipFront;
  u.oitOcclusionThreshold ??= uniforms.oitOcclusionThreshold;

  const bound: OitUniforms = {
    oitDepthFar: u.oitDepthFar,
    oitScreenSize: u.oitScreenSize,
    oitMinDepthTexture: u.oitMinDepthTexture,
    oitSkipFront: u.oitSkipFront,
    oitOcclusionThreshold: u.oitOcclusionThreshold,
  };

  return installOitVariants(material, bound, options);
}

const MAIN_SIGNATURE = /\bvoid\s+main\s*\(\s*\)\s*\{/;

function hasViewPosition(src: string): boolean {
  return /\bvViewPosition\b/.test(src);
}

/**
 * Find the index just past the opening brace of `main()` and the index of its
 * matching closing brace. Returns null if not found.
 */
function findMainBraces(src: string): { open: number; close: number } | null {
  const match = MAIN_SIGNATURE.exec(src);
  if (!match) return null;
  const open = match.index + match[0].length;
  let depth = 1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { open, close: i };
    }
  }
  return null;
}

/** Insert `declarations` before `void main` and `body` before main's closing brace. */
function insertAroundMain(
  src: string,
  declarations: string,
  body: string,
): string {
  const match = MAIN_SIGNATURE.exec(src);
  if (!match) return src;
  const withDecls =
    src.slice(0, match.index) + declarations + src.slice(match.index);
  const braces = findMainBraces(withDecls);
  if (!braces) return withDecls;
  return (
    withDecls.slice(0, braces.close) + body + withDecls.slice(braces.close)
  );
}

/**
 * Make any stock Three.js material or user-authored material OIT-compatible by
 * patching its shaders at compile time (via `onBeforeCompile`) to include the OIT
 * logic, and attaching the per-pass variant machinery.
 *
 * Works with lit built-in materials (which provide `vViewPosition`) and with
 * materials lacking it (e.g. `LineBasicMaterial`), in which case `vViewPosition` is
 * injected automatically. All injected code is guarded by `#ifdef USE_OIT`, so the
 * base program is unchanged outside the OIT pipeline.
 *
 * Note: targets materials compiled by Three.js (built-ins, `ShaderMaterial`). Raw
 * `RawShaderMaterial` (no Three.js shader prelude) is not auto-patched.
 *
 * @param material - the material to patch
 * @param options - optional overrides (e.g. `side`)
 * @returns the same material, typed as {@link OitCapableMaterial}
 *
 * @group Rendering
 * @see {@link attachOitVariants}
 */
export function makeOitCompatible<T extends Material>(
  material: T,
  options?: OitMaterialOptions,
): T & OitCapableMaterial {
  const uniforms = createOitUniforms();
  const shaderMat = isShaderMaterial(material) ? material : null;

  // For ShaderMaterials we can add the uniforms directly; for built-ins we bind a
  // standalone object via onBeforeCompile.
  if (shaderMat) {
    const u = shaderMat.uniforms as Record<string, IUniform>;
    u.oitDepthFar ??= uniforms.oitDepthFar;
    u.oitScreenSize ??= uniforms.oitScreenSize;
    u.oitMinDepthTexture ??= uniforms.oitMinDepthTexture;
    u.oitSkipFront ??= uniforms.oitSkipFront;
    u.oitOcclusionThreshold ??= uniforms.oitOcclusionThreshold;
  }

  const prevOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = function (
    this: Material,
    shader: WebGLProgramParametersWithUniforms,
    renderer,
  ) {
    prevOnBeforeCompile?.call(this, shader, renderer);

    // Bind OIT uniforms into the program.
    shader.uniforms.oitDepthFar = uniforms.oitDepthFar;
    shader.uniforms.oitScreenSize = uniforms.oitScreenSize;
    shader.uniforms.oitMinDepthTexture = uniforms.oitMinDepthTexture;
    shader.uniforms.oitSkipFront = uniforms.oitSkipFront;
    shader.uniforms.oitOcclusionThreshold = uniforms.oitOcclusionThreshold;

    const needsViewPosition = !hasViewPosition(shader.fragmentShader);

    // Fragment: declare vViewPosition (if missing), include the OIT chunk, and call
    // oitProcess on the final color. All guarded by USE_OIT for program stability.
    const fragDecls =
      (needsViewPosition
        ? '#ifdef USE_OIT\nvarying vec3 vViewPosition;\n#endif\n'
        : '') +
      '#ifdef USE_OIT\n' +
      oitChunk +
      '\n#endif\n';
    const fragBody =
      '\n#ifdef USE_OIT\n  gl_FragColor = oitProcess(gl_FragColor);\n#endif\n';
    shader.fragmentShader = insertAroundMain(
      shader.fragmentShader,
      fragDecls,
      fragBody,
    );

    if (needsViewPosition) {
      const vertDecls = '#ifdef USE_OIT\nvarying vec3 vViewPosition;\n#endif\n';
      const vertBody =
        '\n#ifdef USE_OIT\n  vViewPosition = -(modelViewMatrix * vec4(position, 1.0)).xyz;\n#endif\n';
      shader.vertexShader = insertAroundMain(
        shader.vertexShader,
        vertDecls,
        vertBody,
      );
    }
  };
  material.needsUpdate = true;

  return installOitVariants(material, uniforms, options);
}
