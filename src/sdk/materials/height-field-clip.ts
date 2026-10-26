import { IUniform, Matrix4, Texture, Vector4 } from 'three';

/**
 * The uniforms `shaderLib/height-field-clip.glsl` reads.
 *
 * @group Materials
 */
export type HeightFieldClipUniforms = {
  /** per slot, a tile's heights over its (cells + 3)² nodes, its border of one included */
  heightClipTiles: IUniform<Texture | null>;
  /** per entry of the index: min X, min Z, width and slot (below 0: none) of the tile drawn there */
  heightClipIndex: IUniform<Texture | null>;
  /** x, y: the index's min X/Z; z: an entry's width */
  heightClipRegion: IUniform<Vector4>;
  /**
   * x: 1 while live; y: the Y heights are measured from; z: the Y at and below which
   * nothing is clipped (the lowest ground); w: cells along a tile's side
   */
  heightClipParams: IUniform<Vector4>;
  /**
   * Where the tiles' squares are, from the consumer's X/Z (see {@link heightFieldWarp}):
   * the identity for tiles that are squares in X/Z ({@link HEIGHT_FIELD_NO_WARP})
   */
  heightClipWarp: IUniform<Matrix4>;
};

/**
 * The warp of tiles that are squares in the consumer's own X/Z: none.
 *
 * @group Materials
 */
export const HEIGHT_FIELD_NO_WARP: Readonly<Matrix4> = new Matrix4().fromArray([
  0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
]);

/**
 * Where `warp` (a `heightClipWarp`) takes X/Z: into the coordinates its tiles are squares
 * in, a quadratic about a point — for tiles laid out on the Earth (geographic tiles), in
 * longitude and latitude about the region, nearly linear over a field. Its columns: the
 * point (X, Z) and the coordinates there; the derivatives along X and Z of each
 * coordinate (dq₀/dx, dq₀/dz, dq₁/dx, dq₁/dz); and per coordinate its second-order terms
 * in dx², dx dz and dz². As `shaderLib/height-field-clip.glsl` reads it.
 *
 * @group Materials
 */
export function heightFieldWarp(
  warp: Readonly<Matrix4>,
  x: number,
  z: number,
  target: [number, number] = [0, 0],
): [number, number] {
  const m = warp.elements;
  const dx = x - m[0];
  const dz = z - m[1];
  const xx = dx * dx;
  const xz = dx * dz;
  const zz = dz * dz;
  target[0] = m[2] + m[4] * dx + m[5] * dz + m[8] * xx + m[9] * xz + m[10] * zz;
  target[1] =
    m[3] + m[6] * dx + m[7] * dz + m[12] * xx + m[13] * xz + m[14] * zz;
  return target;
}

/**
 * Ground drawn as a height field from tiles, for whatever must end where it is drawn: a
 * `ChunkStack`'s faces at the relief a `SkyBoxStage` draws over it, say
 * (`ChunkStackProps.clip`). Generic: anything that draws ground from tiles of heights can
 * hand one out. Its owner keeps it current every frame, over a region of the scene, in
 * the frame the ground is drawn in, as the triangles draw it — whatever their depth.
 *
 * @group Materials
 */
export type HeightFieldClip = {
  /** what `shaderLib/height-field-clip.glsl` reads (see `applyHeightFieldClip`) */
  uniforms: HeightFieldClipUniforms;
  /** the ground as drawn at X/Z, or null outside the region or where none is drawn */
  heightAt(x: number, z: number): number | null;
  /** the most the ground as drawn strays from its data over the region */
  readonly margin: number;
};

/**
 * Bind a clip's uniforms into a shader's uniforms, under the names
 * `shaderLib/height-field-clip.glsl` declares. The same objects, never copies.
 *
 * @group Materials
 */
export function applyHeightFieldClip(
  uniforms: Record<string, IUniform>,
  clip: HeightFieldClipUniforms,
) {
  uniforms.heightClipTiles = clip.heightClipTiles;
  uniforms.heightClipIndex = clip.heightClipIndex;
  uniforms.heightClipRegion = clip.heightClipRegion;
  uniforms.heightClipParams = clip.heightClipParams;
  uniforms.heightClipWarp = clip.heightClipWarp;
}

/**
 * Uniforms that read whichever {@link HeightFieldClip} is set, for materials built before
 * there is one, or that outlive it: `set` one, or null to clip nothing, and every material
 * bound to them follows with no rebuild and no copy — each value is read from the clip as
 * it is drawn.
 *
 * @group Materials
 */
export function createHeightFieldClipBinding(): {
  uniforms: HeightFieldClipUniforms;
  set(clip: HeightFieldClip | null): void;
} {
  let current: HeightFieldClip | null = null;
  const region = new Vector4();
  const off = new Vector4(0, 0, 0, 0);
  const read = <K extends keyof HeightFieldClipUniforms>(
    name: K,
    fallback: HeightFieldClipUniforms[K]['value'],
  ) =>
    ({
      get value() {
        return current ? current.uniforms[name].value : fallback;
      },
      // Written by no one: the clip owns its values.
      set value(_: unknown) {},
    }) as HeightFieldClipUniforms[K];
  return {
    uniforms: {
      heightClipTiles: read('heightClipTiles', null),
      heightClipIndex: read('heightClipIndex', null),
      heightClipRegion: read('heightClipRegion', region),
      heightClipParams: read('heightClipParams', off),
      heightClipWarp: read('heightClipWarp', HEIGHT_FIELD_NO_WARP as Matrix4),
    },
    set(clip) {
      current = clip;
    },
  };
}
