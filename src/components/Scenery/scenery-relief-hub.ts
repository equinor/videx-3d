import type { DataArrayTexture } from 'three';
import { tileAncestors } from '../../sdk/tiles/tile-cover';

/**
 * The relief tiles a stage draws, as it draws them this frame: for what lies on them to
 * meet them exactly (a `GeoTileLayer` with `drape`). Read the arrays when told (see
 * {@link SceneryReliefHub.subscribe}), or in the frame loop: they are the relief's own,
 * written again each time it chooses.
 */
export type SceneryReliefDrawn = {
  /** heights, metres over the sea, one slot per tile in (see `SceneryReliefTileTextures`) */
  heights: DataArrayTexture;
  /** cells along a tile's patch: its heights are `cells + 3` texels a side, a border of one round them and one more node */
  cells: number;
  /** each tile drawn, by its key: where its instance is in the arrays below */
  index: Map<number, number>;
  /** every strict ancestor of the tiles drawn (see `tilesUnder`) */
  ancestors: Set<number>;
  /** per instance, 4 floats: its west and east edges on the globe, its depth and the slot of its heights (the 4th) */
  tiles: Float32Array;
  /** per instance, 4 floats: where it lies in the tile it blends from (`tileOffsetIn`), and that tile's slot, -1 for none */
  froms: Float32Array;
  /** per instance: from the look of the tile it replaces (0) to its own (1) */
  blends: Float32Array;
  /** the lowest and highest ground in so far, metres over the sea */
  lowest: number;
  highest: number;
  /** the lowest and highest ground over a geographic tile, metres over the sea, from the finest relief tile in over it; null where none is */
  rangeAt: (key: number) => [low: number, high: number] | null;
  /** the ground at a point (degrees), metres over the sea, from the finest relief tile in there, on its triangles; null where none is */
  heightAt: (longitude: number, latitude: number) => number | null;
  /** counts the relief tiles loaded and let go: `rangeAt` may answer otherwise when it changes */
  resident: number;
  /**
   * counts changes to the set of tiles drawn (`index`, `ancestors`): while it holds, only
   * their arrays change (slots, swaps' blends), and what was found over them still is
   */
  keysVersion: number;
};

/**
 * Where a stage's relief tells what it draws (see {@link SceneryReliefDrawn}): one per
 * `Scenery`, shared through its `SceneryOceanContext`. Its `current` is null while no
 * relief is shown; with no tile drawn (past the far plane, say) its tiles are none, but
 * `heightAt` and `rangeAt` still answer from the tiles in.
 */
export class SceneryReliefHub {
  current: SceneryReliefDrawn | null = null;
  /** counts every change: a new choice of tiles, or the relief gone */
  version = 0;
  private readonly listeners = new Set<() => void>();
  private owner: object | null = null;
  // The tiles drawn last, and what was made of them: kept while the same are drawn.
  private keys: number[] = [];
  private index = new Map<number, number>();
  private ancestors = new Set<number>();
  private keysVersion = 0;

  /**
   * Tell what `owner` draws now: `drawn` its instances' arrays and how many there are, or
   * null for nothing. A second stage's relief is ignored while the first one's is there.
   */
  publish(
    owner: object,
    drawn:
      | (Omit<SceneryReliefDrawn, 'index' | 'ancestors' | 'keysVersion'> & {
          keys: readonly number[];
        })
      | null,
  ) {
    if (this.owner && this.owner !== owner) return;
    if (!drawn) {
      if (!this.current && !this.owner) return;
      this.owner = null;
      this.current = null;
      this.keys = [];
      this.keysVersion++;
    } else {
      this.owner = owner;
      const keys = drawn.keys;
      const same =
        keys.length === this.keys.length &&
        keys.every((key, i) => key === this.keys[i]);
      if (!same) {
        this.keys = keys.slice();
        this.index = new Map<number, number>();
        keys.forEach((key, i) => this.index.set(key, i));
        this.ancestors = tileAncestors(keys);
        this.keysVersion++;
      }
      this.current = {
        heights: drawn.heights,
        cells: drawn.cells,
        index: this.index,
        ancestors: this.ancestors,
        tiles: drawn.tiles,
        froms: drawn.froms,
        blends: drawn.blends,
        lowest: drawn.lowest,
        highest: drawn.highest,
        rangeAt: drawn.rangeAt,
        heightAt: drawn.heightAt,
        resident: drawn.resident,
        keysVersion: this.keysVersion,
      };
    }
    this.version++;
    for (const listener of this.listeners) listener();
  }

  /** Called right after each change, in the relief's frame loop. Returns the release. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
