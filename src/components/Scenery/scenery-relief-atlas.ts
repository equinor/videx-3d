import {
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  Uniform,
  Vector4,
} from 'three';
import {
  buildHeightFieldIndex,
  type HeightFieldTile,
} from '../../sdk/geometries/height-field-clip';
import type { SceneryReliefTileTextures } from './scenery-relief-tiles';

// Where no tile is: one entry, no slot.
const EMPTY = new Float32Array([0, 0, 1, -1]);

/**
 * A relief's tiles as one map for a shader to read per pixel (`relief-atlas.glsl`): the
 * tiles' textures, and an index over a region of which tile is drawn where. Shared by the
 * minimap and the stage's overview: each sets the tiles it draws, squares in coordinates of
 * its own choosing — degrees east and south of an origin (`geoTileSquare`, or
 * `geoTileSquareFrom` about a point, for precision) — and reads the ground at a point in the
 * same coordinates.
 */
export class SceneryReliefAtlas {
  readonly uniforms: {
    uReliefAtlasHeights: Uniform;
    uReliefAtlasNormals: Uniform;
    uReliefAtlasLayers: Uniform;
    uReliefAtlasIndex: Uniform<DataTexture>;
    uReliefAtlasRegion: Uniform<Vector4>;
  };

  constructor(textures: SceneryReliefTileTextures) {
    this.uniforms = {
      uReliefAtlasHeights: new Uniform(textures.heights),
      uReliefAtlasNormals: new Uniform(textures.normals),
      uReliefAtlasLayers: new Uniform(textures.layers),
      uReliefAtlasIndex: new Uniform(indexTexture(EMPTY, 1, 1)),
      uReliefAtlasRegion: new Uniform(new Vector4(0, 0, 1, textures.nodes - 3)),
    };
  }

  /**
   * Index `tiles` (their squares and slots, the first winning where they overlap: the
   * finest first) over `region` (min X, min Z, max X, max Z, in their coordinates).
   *
   * @param maxEntries the most entries along a side (see `buildHeightFieldIndex`): tiles
   *   narrower than an entry then show only where they hold the entry's middle
   */
  set(
    tiles: HeightFieldTile[],
    region: [number, number, number, number],
    maxEntries?: number,
  ) {
    const index = buildHeightFieldIndex(tiles, region, undefined, maxEntries);
    const region4 = this.uniforms.uReliefAtlasRegion.value;
    if (!index) {
      this.write(EMPTY, 1, 1);
      region4.set(0, 0, 1, region4.w);
      return;
    }
    const [nx, nz] = index.size;
    this.write(index.data, nx, nz);
    region4.set(index.origin[0], index.origin[1], index.entry, region4.w);
  }

  dispose() {
    this.uniforms.uReliefAtlasIndex.value.dispose();
  }

  private write(data: Float32Array, width: number, height: number) {
    const uniform = this.uniforms.uReliefAtlasIndex;
    const texture = uniform.value;
    if (texture.image.width === width && texture.image.height === height) {
      (texture.image.data as Float32Array).set(data);
      texture.needsUpdate = true;
      return;
    }
    texture.dispose();
    uniform.value = indexTexture(data, width, height);
  }
}

function indexTexture(data: Float32Array, width: number, height: number) {
  const texture = new DataTexture(
    data.slice(),
    width,
    height,
    RGBAFormat,
    FloatType,
  );
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
