import type { Matrix3, Texture } from 'three';

/**
 * A depth grid as `shaderLib/depth-map.glsl` samples it: RG float per texel (R the height,
 * filled everywhere, G 1 where the grid holds data), placed by `toUv` from X/Z
 * (`uv = toUv · (x, z, 1)`). `buildSurfaceDepthMap`'s and `buildChannelDepthMap`'s textures, a
 * bathymetry's.
 *
 * @group Materials
 */
export type DepthMapSource = {
  texture: Texture;
  toUv: Matrix3;
};

/**
 * The height `depth-map.glsl`'s `sampleDepthMap` reads at X/Z `x`, `z`, on the CPU: the same
 * four texels, the same Hermite-smoothed weights, an unmapped or outside texel left out; null
 * where the grid's coverage there is under a half (where the shader's callers fall back). For
 * what must agree with the drawn grid, floating objects riding waves that answer its depth.
 *
 * ⚠️ Needs the texture's data on the CPU (a `DataTexture`); null without it.
 *
 * @group Materials
 */
export function depthMapHeightAt(
  map: DepthMapSource,
  x: number,
  z: number,
): number | null {
  const image = map.texture.image as {
    data?: ArrayLike<number>;
    width: number;
    height: number;
  } | null;
  const data = image?.data;
  if (!data || !image) return null;
  const { width, height } = image;
  const e = map.toUv.elements;
  const tu = (e[0] * x + e[3] * z + e[6]) * width - 0.5;
  const tv = (e[1] * x + e[4] * z + e[7]) * height - 0.5;
  const bu = Math.floor(tu);
  const bv = Math.floor(tv);
  let fu = tu - bu;
  let fv = tv - bv;
  fu = fu * fu * (3 - 2 * fu);
  fv = fv * fv * (3 - 2 * fv);
  let sum = 0;
  let weight = 0;
  let coverage = 0;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const u = bu + i;
      const v = bv + j;
      if (u < 0 || v < 0 || u > width - 1 || v > height - 1) continue;
      const w = (i === 0 ? 1 - fu : fu) * (j === 0 ? 1 - fv : fv);
      const at = 2 * (v * width + u);
      sum += data[at] * w;
      weight += w;
      coverage += data[at + 1] * w;
    }
  }
  return coverage > 0.5 && weight > 0 ? sum / weight : null;
}
