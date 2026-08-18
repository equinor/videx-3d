import {
  DoubleSide,
  IUniform,
  Material,
  MeshBasicMaterial,
  Vector4,
} from 'three';
import { makeOitCompatible } from '../../rendering/oit-material';
// ⚠️ Imported as a STRING, not `#include`d: this shader is assembled at runtime in
// `onBeforeCompile`, where the glsl plugin's include resolution has long finished.
import fenceFieldShader from '../../sdk/materials/shaderLib/fence-field.glsl';
import { ChunkFenceUniforms } from './chunk-material';

/**
 * How the INVENTED part of a chunk is marked — the geometry a seal built where no
 * surface was mapped, and the faces where a unit ends because we stopped knowing
 * rather than because the geology did.
 *
 * ⭐ Every style is a PATTERN, never a colour. A recoloured region says something
 * ended without saying what, and worse, it is indistinguishable from a unit that
 * simply has a different colour — which is the one reading that must not be
 * possible. A pattern cannot be mistaken for data.
 *
 * - `none` — draw nothing; the inference is reported in the diagnostics only.
 * - `hatched` — diagonal hatching, the drafting convention for a section.
 * - `checker` — a chequerboard.
 * - `zigzag` — zigzag lines.
 *
 * @group Components
 */
export type ChunkInferenceStyle = 'none' | 'hatched' | 'checker' | 'zigzag';

/** Options for {@link createInferenceMaterial}. */
export type InferenceMaterialOptions = {
  /** pattern period in METRES (it is anchored in world space). Default 40. */
  spacing?: number;
  /** line width as a fraction of the spacing; ignored by `checker`. Default 0.35. */
  width?: number;
  /**
   * How much the pattern darkens what is under it, 0..1. Default 0.5.
   *
   * Together with `opacity` this becomes the material's own `opacity`, since it IS
   * the strongest alpha the overlay can produce — which is what the OIT pass needs
   * in order to route it as transparent.
   */
  strength?: number;
  /** the opacity of what is being marked, so a translucent unit is marked as faintly. Default 1. */
  opacity?: number;
  /**
   * The stack's section plane (see `ChunkSection`), so the marking is cut with the
   * geometry it marks.
   *
   * ⚠️ Not optional in practice once a stack is sectioned: this is a SEPARATE mesh
   * from the one it marks, and only `ChunkMaterial` knows about the plane — so
   * without it the hatching goes on drawing in the half that was cut away, hanging
   * in the air where the block used to be.
   */
  sectionPlane?: IUniform<Vector4>;
  /**
   * Cut the overlay with a fence, matching {@link ChunkMaterialParameters.fence}.
   */
  fence?: ChunkFenceUniforms;
};

/** GLSL float literal (an integer-looking value would be an int in GLSL). */
const f = (value: number) => value.toFixed(4);

/** Per-style pattern, given metric plane coordinates `q` and yielding `p` in 0..1. */
function pattern(style: ChunkInferenceStyle, spacing: number, width: number) {
  const s = f(spacing);
  const w = f(width);
  if (style === 'checker') {
    return `
  vec2 c = q / ${s};
  vec2 e = fwidth(c) + 1e-5;
  vec2 sq = smoothstep(0.5 - e, 0.5 + e, fract(c));
  float p = abs(sq.x - sq.y);`;
  }
  if (style === 'zigzag') {
    return `
  float tri = abs(fract(q.x / ${s}) - 0.5) * 2.0 - 0.5;
  float p = chunkStripe(q.y / ${s} + tri, ${w});`;
  }
  return `
  float p = chunkStripe((q.x - q.y) / ${s}, ${w});`;
}

/**
 * Build the OVERLAY material that marks a chunk's inferred geometry, or `null` for
 * `'none'`.
 *
 * ⭐ An overlay rather than a property of the unit's own material, for three
 * reasons: it works over a CALLER-SUPPLIED material (which the chunk cannot patch
 * and may be textured); it darkens multiplicatively, so the unit keeps its own
 * colour and shading by construction; and it needs no cooperation from whatever it
 * is drawn over. The cost is one extra draw per mesh that has anything to mark,
 * and only those meshes carry the `inferred` attribute it reads.
 *
 * The pattern is anchored in WORLD space and projected onto whichever plane the
 * face most nearly lies in, so a cap and the wall below it carry the same pattern
 * at the same scale — a wall is vertical, so an XZ projection alone would smear
 * down it.
 *
 * The result is OIT-compatible and owned by the caller.
 *
 * @group Components
 */
export function createInferenceMaterial(
  style: ChunkInferenceStyle,
  options: InferenceMaterialOptions = {},
): Material | null {
  if (style === 'none') return null;
  const {
    spacing = 40,
    width = 0.35,
    strength = 0.5,
    opacity = 1,
    sectionPlane,
    fence,
  } = options;

  const material = new MeshBasicMaterial({
    color: '#000000',
    side: DoubleSide,
    transparent: true,
    // ⚠️ This is the overlay's PEAK alpha, not a separate dimmer: `OITRenderPass`
    // routes by `material.opacity`, and a transparent material at 1 is treated as
    // opaque and drawn in the opaque pass — where the shader's alpha is never
    // applied and the whole mesh comes out solid black. A per-fragment alpha has no
    // honest scalar summary; see the `shaderAlpha` follow-up in
    // `documents/oit-guide.md` §8, which would let this stop pretending.
    opacity: Math.min(strength * opacity, 0.999),
    // It shares its geometry with the mesh underneath, so it must neither write
    // depth nor fight for it.
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: false,
  });

  material.onBeforeCompile = shader => {
    // ⭐ Bound HERE rather than on the material: `makeOitCompatible` CLONES a
    // non-`ShaderMaterial` for its per-pass variants and re-links `onBeforeCompile`
    // onto each clone, so binding the same uniform object from inside the closure
    // is what makes one write per frame reach every variant.
    if (sectionPlane) shader.uniforms.sectionPlane = sectionPlane;
    if (fence) {
      shader.uniforms.fenceParams = fence.params;
      shader.uniforms.fenceMap = fence.map;
      shader.uniforms.fenceToUv = fence.toUv;
      shader.uniforms.fenceSize = fence.size;
      shader.uniforms.fenceCells = fence.cells;
      shader.uniforms.fenceSegments = fence.segments;
      shader.uniforms.fenceIndex = fence.index;
      shader.uniforms.fenceIndexSize = fence.indexSize;
      shader.uniforms.fenceSegmentsSize = fence.segmentsSize;
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float inferred;
varying float vInferred;
varying vec3 vInferPos;
varying vec3 vInferNormal;${
          sectionPlane
            ? `
uniform vec4 sectionPlane;
varying float vSectionDist;`
            : ''
        }${
          fence
            ? `
varying vec3 vFencePos;`
            : ''
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  vInferred = inferred;
  vInferPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vInferNormal = normalize(mat3(modelMatrix) * normal);${
    sectionPlane
      ? `
  vSectionDist = dot(sectionPlane.xyz, transformed) + sectionPlane.w;`
      : ''
  }${
    fence
      ? `
  vFencePos = transformed;`
      : ''
  }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vInferred;
varying vec3 vInferPos;
varying vec3 vInferNormal;${
          sectionPlane
            ? `
varying float vSectionDist;`
            : ''
        }${
          fence
            ? `
uniform vec2 fenceParams;
uniform sampler2D fenceMap;
uniform mat3 fenceToUv;
uniform vec2 fenceSize;
varying vec3 vFencePos;
${fenceFieldShader}`
            : ''
        }

float chunkStripe(float h, float w) {
  float fr = fract(h);
  float d = min(fr, 1.0 - fr);
  float aa = max(fwidth(h), 1e-5);
  return 1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, d);
}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `${
          sectionPlane
            ? `if (vSectionDist > 0.0) discard;
  `
            : ''
        }${
          fence
            ? `if (fenceParams.x > 0.5 && fenceParams.y * fenceSide(fenceMap, fenceToUv, fenceSize, vFencePos.xz) < 0.0) discard;
  `
            : ''
        }#include <clipping_planes_fragment>`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 an = abs(vInferNormal);
  vec2 q = an.y >= an.x && an.y >= an.z
    ? vInferPos.xz
    : (an.x >= an.z ? vInferPos.zy : vInferPos.xy);
${pattern(style, spacing, width)}
  diffuseColor.a *= p * clamp(vInferred, 0.0, 1.0);
}`,
      );
  };
  // ⚠️ three's default program cache key is `onBeforeCompile.toString()`, which is
  // IDENTICAL for two closures over different constants — two overlays with
  // different spacing would silently share one compiled program. `strength` is not
  // in the shader, so it is not in the key.
  material.customProgramCacheKey = () =>
    `chunk-inferred-${style}-${spacing}-${width}-${sectionPlane ? 'cut' : 'whole'}-${fence ? 'fence' : 'nofence'}`;
  return makeOitCompatible(material);
}
