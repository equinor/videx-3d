import { IUniform, Texture, Vector4 } from 'three';

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
};

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
    },
    set(clip) {
      current = clip;
    },
  };
}
