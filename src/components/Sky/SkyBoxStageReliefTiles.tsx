import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box3,
  ColorRepresentation,
  Frustum,
  InstancedBufferAttribute,
  Matrix4,
  Vector4,
} from 'three';
import { useGenerator } from '../../hooks/useGenerator';
import {
  RELIEF_TILE_CELLS,
  ReliefTile,
  reliefTileHeightAt,
  ReliefTileSource,
} from '../../sdk/geometries/relief-tiles';
import type { HeightFieldClip } from '../../sdk/materials/height-field-clip';
import {
  selectPinnedTiles,
  selectQuadtreeTiles,
} from '../../sdk/tiles/quadtree';
import {
  TILE_ROOT_SIZE,
  tileAddress,
  tileKeyAt,
  tileParent,
  tileSquare,
} from '../../sdk/tiles/tile-keys';
import { TileStreamer } from '../../sdk/tiles/tile-streamer';
import { pixelsPerUnit } from '../../sdk/utils/lod';
import { skyReliefTile, SkyReliefTileResponse } from './sky-defs';
import type { SkyMaterial } from './sky-material';
import { SKY_EARTH_RADIUS } from './sky-model';
import {
  createReliefSampler,
  ReliefPins,
  ReliefSampler,
} from './sky-relief-sampler';
import {
  createSkyReliefTileMaterial,
  createSkyReliefTilePatch,
  createSkyReliefTileSeeThroughMaterial,
  createSkyReliefTileSubset,
  SKY_RELIEF_MAX_TILES,
  SkyReliefTileDebug,
  SkyReliefTileGround,
  SkyReliefTileGroundTile,
  SkyReliefTileOccupants,
  SkyReliefTileTextures,
} from './sky-relief-tiles';
import type { SkyStageBounds } from './sky-stage';

/** The most tiles in at once: a layer of each tile texture per tile. */
const MAX_SLOTS = 1024;
// What one tile holds: heights, normals and layer ids per node.
const TILE_BYTES = (RELIEF_TILE_CELLS + 3) ** 2 * (4 + 4 + 1);
// Triangles a tile draws: its grid, and its skirts.
const TILE_TRIANGLES = 2 * RELIEF_TILE_CELLS ** 2 + 8 * RELIEF_TILE_CELLS;
// The deepest tile: about 1 m cells.
const MAX_DEPTH = 16;
// The slope a tile's surface may stray from the ground's before its cells' size on screen
// splits it too: about 0.6°. Flat seabed is shaded alike at any depth.
const CELL_MIN_SLOPE = 0.01;
// Over the ground handed out (`onGround`), the most a tile's error may show on screen:
// a gap between a face and the ground is then never seen.
const GROUND_PIXEL_ERROR = 0.5;
// Frames between reports.
const STATS_EVERY = 15;

/**
 * What a stage's tiled relief draws and holds, for a debug view.
 *
 * @group Components
 */
export type SkyReliefTileStats = {
  /** tiles drawn this frame, and their triangles */
  drawn: number;
  triangles: number;
  /** the deepest tile drawn, and its cells' width */
  depth: number;
  cell: number;
  /** tiles in, loading and waiting */
  resident: number;
  loading: number;
  queued: number;
  /** what the tiles in hold, in bytes */
  bytes: number;
};

type SkyBoxStageReliefTilesProps = {
  sky: SkyMaterial;
  source: ReliefTileSource;
  color: 'ramp' | ColorRepresentation;
  /** how far from the camera to draw it */
  reach: number;
  /** the sea's level, which heights are measured from */
  level: number;
  /** the most a tile's error may show on screen, in pixels */
  pixelError: number;
  /** the most a tile's cell may span on screen, in pixels, where finer data lies under it */
  cellPixels: number;
  /** the sky's seabed detail (its key), compiled into the material with the sky's defines */
  bedDetail?: string;
  visible: boolean;
  onStats?: (stats: SkyReliefTileStats) => void;
  /**
   * Written each frame: the relief's height under the camera (world Y, on the finest tile
   * in there), or null where no tile is in.
   */
  cameraGround?: { current: number | null };
  /** the stage's own area (`bounds`), drawn see-through with `seeThrough` */
  stage: SkyStageBounds;
  /** the sea's seabed is see-through (`seabedOpacity` below 1): so is the relief over `stage` */
  seeThrough: boolean;
  /** a debug view of the tiles */
  debug?: SkyReliefTileDebug;
  /**
   * Hand out the ground as drawn over each of these regions (min X, min Z, max X, max Z),
   * as a `HeightFieldClip`, and null once gone. Over a region a tile's error then shows
   * no more than half a pixel, so what ends at it — a column built on the relief — never
   * stands off it visibly.
   */
  grounds?: SkyReliefTileGroundRequest[];
  /** the ground is drawn: the clips are live only while it is */
  groundLive?: boolean;
  /** the stage's occupants' outlines, and the cut of one of them (see `SkyReliefTileOccupants`) */
  occupants?: SkyReliefTileOccupants;
  /** told the relief's sampler (see `ReliefSampler`): a new one whenever pinned tiles come in, and null once gone */
  onSampler?: (sampler: ReliefSampler | null) => void;
};

/** A region a relief drawn from tiles hands out its ground over (see `grounds`). */
export type SkyReliefTileGroundRequest = {
  bounds: SkyStageBounds;
  onGround: (clip: HeightFieldClip | null) => void;
};

/**
 * A stage's relief drawn from tiles (see documents/tiles.md): each frame the tiles to
 * draw are chosen by their error and their cells' size on screen, those wanted are loaded
 * from the `skyReliefTile` generator, and every tile drawn is one instance of the same
 * patch. With a see-through seabed the tiles over the stage's own area are drawn again,
 * see-through, and the opaque draw leaves that area to them.
 */
export const SkyBoxStageReliefTiles = ({
  sky,
  source,
  color,
  reach,
  level,
  pixelError,
  cellPixels,
  bedDetail,
  visible,
  onStats,
  cameraGround,
  stage,
  seeThrough,
  debug,
  grounds,
  groundLive = false,
  occupants,
  onSampler,
}: SkyBoxStageReliefTilesProps) => {
  const gl = useThree(state => state.gl);
  const slots = useMemo(() => {
    const context = gl.getContext() as WebGL2RenderingContext;
    return Math.min(
      MAX_SLOTS,
      context.getParameter(context.MAX_ARRAY_TEXTURE_LAYERS) as number,
    );
  }, [gl]);
  const textures = useMemo(
    () => new SkyReliefTileTextures(RELIEF_TILE_CELLS, slots),
    [slots],
  );
  useEffect(() => () => textures.dispose(), [textures]);
  const geometry = useMemo(
    () => createSkyReliefTilePatch(RELIEF_TILE_CELLS),
    [],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  const ramp = color === 'ramp';
  const material = useMemo(
    () =>
      createSkyReliefTileMaterial(
        sky,
        textures,
        ramp ? 'ramp' : 0,
        seeThrough ? 'around' : undefined,
        debug,
        occupants,
      ),
    // The seabed's detail is compiled in, from the sky's defines: a new one needs a new material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sky, textures, ramp, bedDetail, seeThrough, debug, occupants],
  );
  useEffect(() => () => material.dispose(), [material]);
  const seeThroughMaterial = useMemo(
    () => (seeThrough ? createSkyReliefTileSeeThroughMaterial(material) : null),
    [material, seeThrough],
  );
  useEffect(() => () => seeThroughMaterial?.dispose(), [seeThroughMaterial]);
  // The tiles over the stage's area, drawn again see-through.
  const subset = useMemo(() => createSkyReliefTileSubset(geometry), [geometry]);
  // Its own tiles only: the vertices and triangles are the patch's.
  useEffect(
    () => () => {
      subset.deleteAttribute('reliefTile');
      subset.deleteAttribute('reliefTileSkirt');
      subset.dispose();
    },
    [subset],
  );
  const [stageMinX, stageMinZ, stageMaxX, stageMaxZ] = stage;
  useEffect(() => {
    (material.uniforms.uReliefStage.value as Vector4).set(
      stageMinX,
      stageMinZ,
      stageMaxX,
      stageMaxZ,
    );
  }, [material, stageMinX, stageMinZ, stageMaxX, stageMaxZ]);
  useEffect(() => {
    if (!ramp) material.uniforms.uReliefLandColor.value.set(color);
  }, [material, ramp, color]);
  useEffect(() => {
    material.uniforms.uReliefReach.value = reach;
  }, [material, reach]);

  const generate = useGenerator<SkyReliefTileResponse>(skyReliefTile);
  // What is placed on the relief pins the ground under it (see `ReliefSampler`).
  const pins = useMemo(() => new ReliefPins(), []);
  // By its content: a source written inline is a new object every render.
  const sourceKey = JSON.stringify(source);
  const streaming = useMemo(() => {
    const plain = JSON.parse(sourceKey) as ReliefTileSource;
    const slotOf = new Map<number, number>();
    // The highest ground in so far, for the horizon.
    const reached = { highest: 0 };
    // Tiles loaded or let go: what the ground's index is up to; and whether a tile under
    // a pin came in, which the sampler follows.
    const resident = { changes: 0, pinnedIn: false };
    const streamer = new TileStreamer<ReliefTile>(
      {
        load: key => generate(plain, key, RELIEF_TILE_CELLS),
        bytes: tile =>
          tile.heights.byteLength +
          tile.normals.byteLength +
          tile.layers.byteLength,
      },
      {
        budget: Math.floor(slots * 0.9) * TILE_BYTES,
        onLoad: (key, tile) => {
          slotOf.set(key, textures.put(tile));
          reached.highest = Math.max(reached.highest, tile.max);
          resident.changes++;
          const [minX, minZ, width] = tileSquare(key);
          if (pins.overlaps(minX, minZ, minX + width, minZ + width))
            resident.pinnedIn = true;
        },
        onEvict: key => {
          textures.release(slotOf.get(key) ?? -1);
          slotOf.delete(key);
          resident.changes++;
        },
      },
    );
    return { streamer, slotOf, reached, resident, split: new Set<number>() };
  }, [generate, sourceKey, textures, slots, pins]);
  useEffect(() => () => streaming.streamer.dispose(), [streaming]);

  // The relief's sampler: a new one whenever a pinned tile comes in, for what settled on
  // the ground to settle again. Its tiles are what is in, whatever the GPU holds.
  const [samplerVersion, setSamplerVersion] = useState(0);
  const sampler = useMemo(
    () =>
      createReliefSampler(
        (x, z) => {
          for (let depth = MAX_DEPTH; depth >= 0; depth--) {
            const key = tileKeyAt(depth, x, z);
            const tile = streaming.streamer.get(key);
            if (!tile) continue;
            const [minX, minZ, width] = tileSquare(key);
            return { tile, minX, minZ, width };
          }
          return undefined;
        },
        level,
        pins,
      ),
    // A new sampler is the signal to settle again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streaming, level, pins, samplerVersion],
  );
  const announceSampler = useRef(onSampler);
  useEffect(() => {
    announceSampler.current = onSampler;
  });
  const handsSampler = !!onSampler;
  useEffect(() => {
    if (handsSampler) announceSampler.current?.(sampler);
  }, [sampler, handsSampler]);
  useEffect(() => () => announceSampler.current?.(null), []);

  // The ground as drawn over each region asked for, handed out while asked for. Keyed by
  // the regions: a request written inline is a new object every render.
  const groundsKey = JSON.stringify(grounds?.map(g => g.bounds) ?? []);
  const requests = useRef(grounds);
  useEffect(() => {
    requests.current = grounds;
  });
  const handed = useMemo(
    () =>
      (JSON.parse(groundsKey) as SkyStageBounds[]).map(bounds => ({
        bounds,
        clip: new SkyReliefTileGround(textures, RELIEF_TILE_CELLS),
        // What it was indexed from last: the tiles drawn there, and those in.
        indexed: '',
      })),
    [groundsKey, textures],
  );
  useEffect(() => {
    handed.forEach(({ clip }, i) => requests.current?.[i]?.onGround(clip));
    return () => {
      handed.forEach(({ clip }, i) => {
        requests.current?.[i]?.onGround(null);
        clip.dispose();
      });
    };
  }, [handed]);
  useEffect(() => {
    for (const ground of handed) ground.indexed = '';
  }, [handed, streaming, level]);

  const stats = useRef(onStats);
  useEffect(() => {
    stats.current = onStats;
  });
  const frame = useRef(0);
  const view = useMemo(
    () => ({ frustum: new Frustum(), matrix: new Matrix4(), box: new Box3() }),
    [],
  );
  const tiles = geometry.getAttribute('reliefTile') as InstancedBufferAttribute;
  const skirts = geometry.getAttribute(
    'reliefTileSkirt',
  ) as InstancedBufferAttribute;

  useFrame(({ camera, size, viewport }) => {
    const { streamer, slotOf } = streaming;
    const { x, y, z } = camera.position;
    view.matrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    view.frustum.setFromProjectionMatrix(view.matrix);

    // The ground under the camera, from the finest tile in there, whether drawn or not:
    // the one under a camera looking level is out of view. The curve drops nothing there.
    let ground: number | null = null;
    for (let depth = MAX_DEPTH; depth >= 0 && ground === null; depth--) {
      const tile = streamer.get(tileKeyAt(depth, x, z));
      if (tile) ground = level + reliefTileHeightAt(tile, x, z);
    }
    if (cameraGround) cameraGround.current = ground;
    // Under it, the skirts are seen from below, where there are no cracks to close.
    material.uniforms.uReliefCameraUnder.value =
      ground !== null && y < ground ? 1 : 0;

    // No farther than can be seen: past the curved sea's horizon, the highest ground's own.
    let seen = reach;
    const curvature = sky.uniforms.uSkyCurvature.value as number;
    const flat = sky.uniforms.uSkyFlat.value as Vector4;
    const inner = flat.w - Math.hypot(x - flat.x, z - flat.z);
    if (sky.curvedHorizon) {
      const horizon =
        flat.w +
        Math.hypot(x - flat.x, z - flat.z) +
        Math.sqrt(2 * SKY_EARTH_RADIUS * Math.max(y - level, 0)) +
        Math.sqrt(
          2 * SKY_EARTH_RADIUS * Math.max(streaming.reached.highest, 0),
        );
      seen = Math.min(reach, horizon);
    }

    const info = (key: number) => {
      const tile = streamer.get(key);
      const slot = slotOf.get(key);
      if (!tile || slot === undefined || slot < 0) return undefined;
      return {
        error: tile.error,
        minY: level + tile.min,
        maxY: level + tile.max,
        leaf: tile.leaf,
      };
    };
    const inView = (
      minX: number,
      minZ: number,
      maxX: number,
      maxZ: number,
      minY: number,
      maxY: number,
    ) => {
      // Lowered by the most the Earth's curve drops any of it, and by a skirt.
      const far = Math.hypot(
        Math.max(Math.abs(minX - x), Math.abs(maxX - x)),
        Math.max(Math.abs(minZ - z), Math.abs(maxZ - z)),
      );
      const past = Math.max(far - inner, 0);
      const drop = 0.5 * curvature * past * past;
      view.box.min.set(minX, minY - drop - (maxX - minX) * 0.01, minZ);
      view.box.max.set(maxX, maxY, maxZ);
      return view.frustum.intersectsBox(view.box);
    };

    const selection = selectQuadtreeTiles({
      eye: [x, y, z],
      reach: seen,
      pixelsPerUnit: pixelsPerUnit(camera, size.height * viewport.dpr),
      pixelError,
      // Under the ground the tiles' tops face away: their shading is not seen.
      cellPixels:
        ground !== null && y < ground
          ? undefined
          : {
              cells: RELIEF_TILE_CELLS,
              pixels: cellPixels,
              minSlope: CELL_MIN_SLOPE,
            },
      maxDepth: MAX_DEPTH,
      info,
      inView,
      split: streaming.split,
      // Over the ground handed out, what ends at it never stands off it visibly.
      finer: handed.map(({ bounds }) => ({
        bounds,
        pixelError: GROUND_PIXEL_ERROR,
      })),
    });
    streaming.split = selection.split;
    // What is pinned is held in down to the finest, whatever the view.
    const pinned =
      pins.squares.length > 0
        ? selectPinnedTiles({
            squares: pins.squares,
            info: key => {
              const tile = streamer.get(key);
              return tile ? { leaf: tile.leaf } : undefined;
            },
            maxDepth: MAX_DEPTH,
          })
        : null;
    streamer.update(
      pinned
        ? [...selection.draw, ...selection.split, ...pinned.keep]
        : [...selection.draw, ...selection.split],
      pinned ? [...pinned.want, ...selection.want] : selection.want,
    );
    if (streaming.resident.pinnedIn) {
      streaming.resident.pinnedIn = false;
      setSamplerVersion(version => version + 1);
    }

    const array = tiles.array as Float32Array;
    const drops = skirts.array as Float32Array;
    let count = 0;
    let deepest = 0;
    for (const key of selection.draw) {
      if (count >= SKY_RELIEF_MAX_TILES) break;
      const tile = streamer.get(key);
      const slot = slotOf.get(key);
      if (!tile || slot === undefined || slot < 0) continue;
      const [minX, minZ, width] = tileSquare(key);
      const [depth] = tileAddress(key);
      deepest = Math.max(deepest, depth);
      array[4 * count] = minX;
      array[4 * count + 1] = minZ;
      array[4 * count + 2] = width;
      array[4 * count + 3] = slot;
      // Deep enough to close the crack to a neighbour a level coarser.
      const parent = depth > 0 ? streamer.get(tileParent(key)) : undefined;
      drops[count] =
        Math.max(tile.error, parent?.error ?? 0) +
        (width / RELIEF_TILE_CELLS) * 0.05;
      count++;
    }
    geometry.instanceCount = count;
    // ⚠️ An empty update range uploads the whole array's tail instead.
    if (count > 0) {
      tiles.clearUpdateRanges();
      tiles.addUpdateRange(0, 4 * count);
      tiles.needsUpdate = true;
      skirts.clearUpdateRanges();
      skirts.addUpdateRange(0, count);
      skirts.needsUpdate = true;
    }

    // The tiles that touch the stage's area, again, for the see-through draw.
    let inStage = 0;
    if (seeThroughMaterial) {
      const subsetTiles = subset.getAttribute(
        'reliefTile',
      ) as InstancedBufferAttribute;
      const subsetSkirts = subset.getAttribute(
        'reliefTileSkirt',
      ) as InstancedBufferAttribute;
      const into = subsetTiles.array as Float32Array;
      const intoSkirts = subsetSkirts.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const tx = array[4 * i];
        const tz = array[4 * i + 1];
        const width = array[4 * i + 2];
        if (
          tx >= stageMaxX ||
          tz >= stageMaxZ ||
          tx + width <= stageMinX ||
          tz + width <= stageMinZ
        )
          continue;
        into.set(array.subarray(4 * i, 4 * i + 4), 4 * inStage);
        intoSkirts[inStage] = drops[i];
        inStage++;
      }
      if (inStage > 0) {
        subsetTiles.clearUpdateRanges();
        subsetTiles.addUpdateRange(0, 4 * inStage);
        subsetTiles.needsUpdate = true;
        subsetSkirts.clearUpdateRanges();
        subsetSkirts.addUpdateRange(0, inStage);
        subsetSkirts.needsUpdate = true;
      }
    }
    subset.instanceCount = inStage;

    // Out of view, the finest tile in: a face in view may stand on ground that is not.
    const finestAt = (
      px: number,
      pz: number,
    ): SkyReliefTileGroundTile | undefined => {
      for (let depth = MAX_DEPTH; depth >= 0; depth--) {
        const key = tileKeyAt(depth, px, pz);
        const tile = streamer.get(key);
        const slot = slotOf.get(key);
        if (!tile || slot === undefined || slot < 0) continue;
        const [minX, minZ, width] = tileSquare(key);
        return { square: { minX, minZ, width, slot }, tile };
      }
      return undefined;
    };
    for (const handout of handed) {
      // Indexed again only when the tiles drawn there, or those in, change.
      const [rx0, rz0, rx1, rz1] = handout.bounds;
      const there: SkyReliefTileGroundTile[] = [];
      let indexed = `${streaming.resident.changes}`;
      for (const key of selection.draw) {
        const [minX, minZ, width] = tileSquare(key);
        if (
          minX >= rx1 ||
          minZ >= rz1 ||
          minX + width <= rx0 ||
          minZ + width <= rz0
        )
          continue;
        const tile = streamer.get(key);
        const slot = slotOf.get(key);
        if (!tile || slot === undefined || slot < 0) continue;
        there.push({ square: { minX, minZ, width, slot }, tile });
        indexed += `,${key}`;
      }
      if (indexed !== handout.indexed) {
        handout.indexed = indexed;
        handout.clip.set(there, handout.bounds, level, finestAt);
      }
      handout.clip.setLive(groundLive && visible);
    }

    if (stats.current && frame.current++ % STATS_EVERY === 0) {
      const held = streamer.stats;
      stats.current({
        drawn: count,
        triangles: count * TILE_TRIANGLES,
        depth: deepest,
        cell: TILE_ROOT_SIZE / 2 ** deepest / RELIEF_TILE_CELLS,
        resident: held.resident,
        loading: held.loading,
        queued: held.queued,
        bytes: held.bytes,
      });
    }
  });

  return (
    <>
      <mesh
        geometry={geometry}
        material={material}
        frustumCulled={false}
        visible={visible}
      />
      {seeThroughMaterial && (
        <mesh
          geometry={subset}
          material={seeThroughMaterial}
          frustumCulled={false}
          visible={visible}
        />
      )}
    </>
  );
};
