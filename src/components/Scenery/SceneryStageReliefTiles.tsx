import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Frustum,
  InstancedBufferAttribute,
  Matrix4,
  Texture,
  Vector4,
} from 'three';
import { useGenerator } from '../../hooks/useGenerator';
import {
  geoReliefTileHeightAt,
  RELIEF_TILE_CELLS,
  ReliefLayersSource,
  ReliefTile,
} from '../../sdk/geometries/relief-tiles';
import type { HeightFieldClip } from '../../sdk/materials/height-field-clip';
import {
  QuadtreeLayout,
  selectPinnedTiles,
  selectQuadtreeTiles,
} from '../../sdk/tiles/quadtree';
import {
  GEO_TILE_ROOTS,
  geoTileKeyAt,
  geoTileRegion,
} from '../../sdk/tiles/geo-tile-keys';
import { tileAddress, tileParent } from '../../sdk/tiles/tile-keys';
import { TileStreamer } from '../../sdk/tiles/tile-streamer';
import { pixelsPerUnit } from '../../sdk/utils/lod';
import { sceneryReliefTile, SceneryReliefTileResponse } from './scenery-defs';
import type { SceneryMaterial } from './scenery-material';
import type { SceneryReliefLoading } from './scenery-progress';
import {
  geoAt,
  geoSquareOver,
  geoTileDistance,
  geoTileInView,
  geoTileOffsets,
  geoTileSquare,
  geoTileWidth,
  geoWarp,
} from './scenery-relief-geo';
import {
  createReliefSampler,
  ReliefPins,
  ReliefSampler,
} from './scenery-relief-sampler';
import {
  createSceneryReliefTileMaterial,
  createSceneryReliefTilePatch,
  createSceneryReliefTileSeeThroughMaterial,
  createSceneryReliefTileSubset,
  SKY_RELIEF_MAX_TILES,
  SceneryReliefTileDebug,
  SceneryReliefTileGround,
  SceneryReliefTileGroundTile,
  SceneryReliefTileOccupants,
  SceneryReliefTileTextures,
} from './scenery-relief-tiles';
import type { SceneryStageBounds } from './scenery-stage';

/** The most tiles in at once: a layer of each tile texture per tile. */
const MAX_SLOTS = 1024;
// What one tile holds: heights, normals and layer ids per node.
const TILE_BYTES = (RELIEF_TILE_CELLS + 3) ** 2 * (4 + 4 + 1);
// Triangles a tile draws: its grid, and its skirts.
const TILE_TRIANGLES = 2 * RELIEF_TILE_CELLS ** 2 + 8 * RELIEF_TILE_CELLS;
// The deepest tile: about 1 m cells north–south (geographic tiles, 180° / 2^19 / 32).
const MAX_DEPTH = 19;
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
export type SceneryReliefTileStats = {
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

type SceneryStageReliefTilesProps = {
  /** its globe needs a frame (`Globe.setFrame`): the tiles are placed by latitude and longitude */
  sky: SceneryMaterial;
  source: ReliefLayersSource;
  /** its looks (`SceneryReliefLooks.texture`): the relief's own and its layers' */
  looks: Texture;
  /** how far from the camera to draw it */
  reach: number;
  /** the sea's level, which heights are measured from */
  level: number;
  /** the most a tile's error may show on screen, in pixels */
  pixelError: number;
  /** the most a tile's cell may span on screen, in pixels, where finer data lies under it */
  cellPixels: number;
  /** what it compiles with from the sky, as a key (`SceneryOceanState.definesKey`): a new one needs a new material */
  definesKey?: string;
  visible: boolean;
  onStats?: (stats: SceneryReliefTileStats) => void;
  /** told of the tiles as they load (see `SceneryReliefLoading`) whenever that changes, and null once gone */
  onLoading?: (loading: SceneryReliefLoading | null) => void;
  /**
   * Written each frame: the relief's height under the camera (world Y, on the finest tile
   * in there), or null where no tile is in.
   */
  cameraGround?: { current: number | null };
  /** the stage's own area (`bounds`), drawn see-through with `seeThrough` */
  stage: SceneryStageBounds;
  /** the sea's seabed is see-through (`seabedOpacity` below 1): so is the relief over `stage` */
  seeThrough: boolean;
  /** a debug view of the tiles */
  debug?: SceneryReliefTileDebug;
  /**
   * Hand out the ground as drawn over each of these regions (min X, min Z, max X, max Z),
   * as a `HeightFieldClip`, and null once gone. Over a region a tile's error then shows
   * no more than half a pixel, so what ends at it — a column built on the relief — never
   * stands off it visibly.
   */
  grounds?: SceneryReliefTileGroundRequest[];
  /** the ground is drawn: the clips are live only while it is */
  groundLive?: boolean;
  /** the stage's occupants' outlines, and the cut of one of them (see `SceneryReliefTileOccupants`) */
  occupants?: SceneryReliefTileOccupants;
  /** told the relief's sampler (see `ReliefSampler`): a new one whenever pinned tiles come in, and null once gone */
  onSampler?: (sampler: ReliefSampler | null) => void;
};

/** A region a relief drawn from tiles hands out its ground over (see `grounds`). */
export type SceneryReliefTileGroundRequest = {
  bounds: SceneryStageBounds;
  onGround: (clip: HeightFieldClip | null) => void;
};

/**
 * A stage's relief drawn from geographic tiles (see documents/tiles.md and world.md, step
 * 6): each frame the tiles to draw are chosen by their error and their cells' size on
 * screen, those wanted are loaded from the `sceneryReliefTile` generator, and every tile drawn
 * is one instance of the same patch, its nodes placed by their latitude and longitude on
 * the sky's globe. With a see-through seabed the tiles over the stage's own area are drawn
 * again, see-through, and the opaque draw leaves that area to them.
 */
export const SceneryStageReliefTiles = ({
  sky,
  source,
  looks,
  reach,
  level,
  pixelError,
  cellPixels,
  definesKey,
  visible,
  onStats,
  onLoading,
  cameraGround,
  stage,
  seeThrough,
  debug,
  grounds,
  groundLive = false,
  occupants,
  onSampler,
}: SceneryStageReliefTilesProps) => {
  const gl = useThree(state => state.gl);
  const slots = useMemo(() => {
    const context = gl.getContext() as WebGL2RenderingContext;
    return Math.min(
      MAX_SLOTS,
      context.getParameter(context.MAX_ARRAY_TEXTURE_LAYERS) as number,
    );
  }, [gl]);
  const textures = useMemo(
    () => new SceneryReliefTileTextures(RELIEF_TILE_CELLS, slots),
    [slots],
  );
  useEffect(() => () => textures.dispose(), [textures]);
  const geometry = useMemo(
    () => createSceneryReliefTilePatch(RELIEF_TILE_CELLS),
    [],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      createSceneryReliefTileMaterial(
        sky,
        textures,
        looks,
        seeThrough ? 'around' : undefined,
        debug,
        occupants,
      ),
    // The sky's defines are compiled in (the seabed's detail, the graticule): new ones need a new material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sky, textures, looks, definesKey, seeThrough, debug, occupants],
  );
  useEffect(() => () => material.dispose(), [material]);
  const seeThroughMaterial = useMemo(
    () =>
      seeThrough ? createSceneryReliefTileSeeThroughMaterial(material) : null,
    [material, seeThrough],
  );
  useEffect(() => () => seeThroughMaterial?.dispose(), [seeThroughMaterial]);
  // The tiles over the stage's area, drawn again see-through.
  const subset = useMemo(
    () => createSceneryReliefTileSubset(geometry),
    [geometry],
  );
  // Its own tiles only: the vertices and triangles are the patch's.
  useEffect(
    () => () => {
      subset.deleteAttribute('reliefTile');
      subset.deleteAttribute('reliefTileChi');
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
    material.uniforms.uReliefReach.value = reach;
  }, [material, reach]);

  const generate = useGenerator<SceneryReliefTileResponse>(sceneryReliefTile);
  // What is placed on the relief pins the ground under it (see `ReliefSampler`).
  const pins = useMemo(() => new ReliefPins(), []);
  // The pins' squares in the tiles' coordinates (geoTileSquare's), kept with the squares
  // they were found from.
  const geoPins = useRef<{
    from: unknown;
    squares: [number, number, number, number][];
  }>({ from: null, squares: [] });
  const pinnedSquares = () => {
    const squares = pins.squares;
    if (geoPins.current.from !== squares) {
      geoPins.current = {
        from: squares,
        squares: sky.globe.frame
          ? squares.map(square => geoSquareOver(sky.globe, square))
          : [],
      };
    }
    return geoPins.current.squares;
  };
  // By its content: a source written inline is a new object every render.
  const sourceKey = JSON.stringify(source);
  const streaming = useMemo(() => {
    const plain = JSON.parse(sourceKey) as ReliefLayersSource;
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
          const [x0, z0, width] = geoTileSquare(key);
          for (const [a0, b0, a1, b1] of pinnedSquares()) {
            if (a0 <= x0 + width && b0 <= z0 + width && a1 >= x0 && b1 >= z0)
              resident.pinnedIn = true;
          }
        },
        onEvict: key => {
          textures.release(slotOf.get(key) ?? -1);
          slotOf.delete(key);
          resident.changes++;
        },
      },
    );
    return { streamer, slotOf, reached, resident, split: new Set<number>() };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinnedSquares reads refs
  }, [generate, sourceKey, textures, slots, pins]);
  useEffect(() => () => streaming.streamer.dispose(), [streaming]);

  // The relief's sampler: a new one whenever a pinned tile comes in, for what settled on
  // the ground to settle again. Its tiles are what is in, whatever the GPU holds.
  const [samplerVersion, setSamplerVersion] = useState(0);
  const sampler = useMemo(() => {
    const globe = sky.globe;
    const there = { latitude: 0, longitude: 0 };
    return createReliefSampler(
      (x, z) => {
        if (!globe.frame) return undefined;
        const { latitude, longitude } = geoAt(globe, x, z, there);
        for (let depth = MAX_DEPTH; depth >= 0; depth--) {
          const key = geoTileKeyAt(depth, longitude, latitude);
          const tile = streaming.streamer.get(key);
          if (!tile) continue;
          const [west, north, span] = geoTileRegion(key);
          const cells = tile.cells;
          const east = ((((longitude - west + 180) % 360) + 360) % 360) - 180;
          const cellV = ((span / cells) * Math.PI * globe.radius) / 180;
          const north2 = globe.north;
          return {
            tile,
            u: (east / span) * cells,
            v: ((north - latitude) / span) * cells,
            cellU: cellV * Math.cos((latitude * Math.PI) / 180),
            cellV,
            east: [-north2.z, north2.x],
          };
        }
        return undefined;
      },
      level,
      pins,
    );
    // A new sampler is the signal to settle again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, level, pins, samplerVersion, sky]);
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
      (JSON.parse(groundsKey) as SceneryStageBounds[]).map(bounds => ({
        bounds,
        clip: new SceneryReliefTileGround(textures, RELIEF_TILE_CELLS),
        // What it was indexed from last: the tiles drawn there, and those in.
        indexed: '',
        // The region in the tiles' coordinates, and its warp (see the frame loop), with
        // the globe they were found on.
        globeKey: '',
        square: [0, 0, 0, 0] as [number, number, number, number],
        origin: [0, 0] as [number, number],
        scale: 1,
        warp: new Matrix4(),
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
    for (const ground of handed) {
      ground.indexed = '';
      ground.globeKey = '';
    }
  }, [handed, streaming, level]);

  const stats = useRef(onStats);
  useEffect(() => {
    stats.current = onStats;
  });
  const loadingRef = useRef(onLoading);
  useEffect(() => {
    loadingRef.current = onLoading;
  });
  // What was last told of the tiles' loading; a new streamer starts over.
  const loadingTold = useRef('');
  useEffect(
    () => () => {
      loadingTold.current = '';
      loadingRef.current?.(null);
    },
    [streaming],
  );
  const frame = useRef(0);
  const view = useMemo(
    () => ({
      frustum: new Frustum(),
      matrix: new Matrix4(),
      eye: { latitude: 0, longitude: 0 },
      warp: new Matrix4(),
      stage: {
        key: '',
        square: [0, 0, 0, 0] as [number, number, number, number],
      },
    }),
    [],
  );
  const tiles = geometry.getAttribute('reliefTile') as InstancedBufferAttribute;
  const chis = geometry.getAttribute(
    'reliefTileChi',
  ) as InstancedBufferAttribute;
  const skirts = geometry.getAttribute(
    'reliefTileSkirt',
  ) as InstancedBufferAttribute;

  useFrame(({ camera, size, viewport }) => {
    const { streamer, slotOf } = streaming;
    const globe = sky.globe;
    // Placed by latitude and longitude: nothing without the map the scene is in.
    if (!globe.frame) {
      geometry.instanceCount = 0;
      subset.instanceCount = 0;
      return;
    }
    // The camera: where it is over the Earth, and its altitude over the globe.
    const eye = globe.geographic(camera.position, view.eye);
    const altitude = globe.altitude(camera.position);
    const y = level + altitude;
    view.matrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    view.frustum.setFromProjectionMatrix(view.matrix);

    // The ground under the camera, from the finest tile in there, whether drawn or not:
    // the one under a camera looking level is out of view. On its triangles, so a camera
    // just over the ground drawn is never taken to be in it.
    let ground: number | null = null;
    for (let depth = MAX_DEPTH; depth >= 0 && ground === null; depth--) {
      const tile = streamer.get(
        geoTileKeyAt(depth, eye.longitude, eye.latitude),
      );
      if (tile)
        ground =
          level +
          geoReliefTileHeightAt(tile, eye.longitude, eye.latitude, true);
    }
    if (cameraGround) cameraGround.current = ground;
    // Under it, nothing of the relief higher than the camera is seen (reliefTileHiddenFromBelow).
    const under = ground !== null && y < ground;
    material.uniforms.uReliefCameraUnder.value = under ? 1 : 0;
    // In it, above the sea's own seabed, the camera is in rock: the sky draws the void
    // (SceneryMaterial.oceanBuried), and none of the relief is drawn. Chosen and streamed still.
    const buried = ground !== null && y <= ground && y > level - sky.oceanDepth;

    // No farther than can be seen: past the globe's horizon, the highest ground's own, and
    // the disc's flat sea, over which a view runs on level.
    let seen = reach;
    if (sky.globeEnabled) {
      const R = globe.radius;
      const horizon =
        globe.discRadius +
        Math.sqrt(2 * R * Math.max(altitude, 0) + altitude * altitude) +
        Math.sqrt(2 * R * Math.max(streaming.reached.highest, 0));
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
        // Across the coast, land and sea are shaded apart however flat the tile; and across
        // where a finer layer ends, or over one between its nodes.
        rough: tile.edge || (tile.min < 0 && tile.max > 0),
      };
    };
    // Where the tiles lie: on the globe by their latitudes and longitudes. Their lowest
    // reaches a skirt lower.
    const layout: QuadtreeLayout = {
      roots: GEO_TILE_ROOTS,
      square: geoTileSquare,
      distance: (key, minY, maxY) =>
        geoTileDistance(
          globe,
          key,
          camera.position,
          eye,
          altitude,
          minY - level,
          maxY - level,
        ),
      shows: (key, minY, maxY) =>
        geoTileDistance(
          globe,
          key,
          camera.position,
          eye,
          altitude,
          minY - level,
          maxY - level,
        ) <= seen &&
        geoTileInView(
          globe,
          key,
          view.frustum,
          camera.position,
          eye,
          minY - level - geoTileWidth(globe, key) * 0.01,
          maxY - level,
        ),
      width: key => geoTileWidth(globe, key),
    };

    const selection = selectQuadtreeTiles({
      eye: [0, y, 0],
      reach: seen,
      pixelsPerUnit: pixelsPerUnit(camera, size.height * viewport.dpr),
      pixelError,
      // Under the ground the tiles' tops face away: their shading is not seen.
      cellPixels: under
        ? undefined
        : {
            cells: RELIEF_TILE_CELLS,
            pixels: cellPixels,
            minSlope: CELL_MIN_SLOPE,
          },
      maxDepth: MAX_DEPTH,
      info,
      split: streaming.split,
      // Over the ground handed out, what ends at it never stands off it visibly.
      finer: handed.map(({ square }) => ({
        bounds: square,
        pixelError: GROUND_PIXEL_ERROR,
      })),
      layout,
    });
    streaming.split = selection.split;
    // What is pinned is held in down to the finest, whatever the view.
    const pinned = pinnedSquares();
    const pinning =
      pinned.length > 0
        ? selectPinnedTiles({
            squares: pinned,
            info: key => {
              const tile = streamer.get(key);
              return tile ? { leaf: tile.leaf } : undefined;
            },
            maxDepth: MAX_DEPTH,
            layout,
          })
        : null;
    streamer.update(
      pinning
        ? [...selection.draw, ...selection.split, ...pinning.keep]
        : [...selection.draw, ...selection.split],
      pinning ? [...pinning.want, ...selection.want] : selection.want,
    );
    if (streaming.resident.pinnedIn) {
      streaming.resident.pinnedIn = false;
      setSamplerVersion(version => version + 1);
    }
    if (loadingRef.current) {
      const { settled, loading, queued } = streamer.stats;
      const told = `${settled}|${loading}|${queued}`;
      if (told !== loadingTold.current) {
        loadingTold.current = told;
        loadingRef.current({ settled, loading, queued });
      }
    }

    const array = tiles.array as Float32Array;
    const chiArray = chis.array as Float32Array;
    const drops = skirts.array as Float32Array;
    let count = 0;
    let deepest = 0;
    let lowest = Infinity;
    for (const key of selection.draw) {
      if (count >= SKY_RELIEF_MAX_TILES) break;
      const tile = streamer.get(key);
      const slot = slotOf.get(key);
      if (!tile || slot === undefined || slot < 0) continue;
      const [depth] = tileAddress(key);
      deepest = Math.max(deepest, depth);
      lowest = Math.min(lowest, level + tile.min);
      geoTileOffsets(globe, key, array, 4 * count, chiArray, 3 * count);
      array[4 * count + 2] = depth;
      array[4 * count + 3] = slot;
      // Deep enough to close the crack to a neighbour a level coarser.
      const parent = depth > 0 ? streamer.get(tileParent(key)) : undefined;
      drops[count] =
        Math.max(tile.error, parent?.error ?? 0) +
        (geoTileWidth(globe, key) / RELIEF_TILE_CELLS) * 0.05;
      count++;
    }
    geometry.instanceCount = count;
    // ⚠️ An empty update range uploads the whole array's tail instead.
    if (count > 0) {
      for (const [attribute, size] of [
        [tiles, 4],
        [chis, 3],
        [skirts, 1],
      ] as const) {
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, size * count);
        attribute.needsUpdate = true;
      }
    }

    // The tiles that touch the stage's area, again, for the see-through draw.
    let inStage = 0;
    if (seeThroughMaterial) {
      const stageKey = `${stageMinX},${stageMinZ},${stageMaxX},${stageMaxZ},${globe.discCentre.x},${globe.radius}`;
      if (view.stage.key !== stageKey) {
        view.stage.key = stageKey;
        view.stage.square = geoSquareOver(globe, [
          stageMinX,
          stageMinZ,
          stageMaxX,
          stageMaxZ,
        ]);
      }
      const [s0, t0, s1, t1] = view.stage.square;
      const subsetTiles = subset.getAttribute(
        'reliefTile',
      ) as InstancedBufferAttribute;
      const subsetChis = subset.getAttribute(
        'reliefTileChi',
      ) as InstancedBufferAttribute;
      const subsetSkirts = subset.getAttribute(
        'reliefTileSkirt',
      ) as InstancedBufferAttribute;
      const into = subsetTiles.array as Float32Array;
      const intoChis = subsetChis.array as Float32Array;
      const intoSkirts = subsetSkirts.array as Float32Array;
      let drawn = 0;
      for (const key of selection.draw) {
        const slot = slotOf.get(key);
        if (!streamer.get(key) || slot === undefined || slot < 0) continue;
        const i = drawn++;
        if (i >= count) break;
        const [a, b, width] = geoTileSquare(key);
        if (a >= s1 || b >= t1 || a + width <= s0 || b + width <= t0) continue;
        into.set(array.subarray(4 * i, 4 * i + 4), 4 * inStage);
        intoChis.set(chiArray.subarray(3 * i, 3 * i + 3), 3 * inStage);
        intoSkirts[inStage] = drops[i];
        inStage++;
      }
      if (inStage > 0) {
        for (const [attribute, size] of [
          [subsetTiles, 4],
          [subsetChis, 3],
          [subsetSkirts, 1],
        ] as const) {
          attribute.clearUpdateRanges();
          attribute.addUpdateRange(0, size * inStage);
          attribute.needsUpdate = true;
        }
      }
    }
    subset.instanceCount = inStage;
    // Under the ground and below all of it drawn, every pixel would be dropped
    // (reliefTileHiddenFromBelow): the void's, deep under the field, costs nothing.
    if (buried || (under && y < lowest)) {
      geometry.instanceCount = 0;
      subset.instanceCount = 0;
    }

    // The ground handed out over each region: the tiles there, in their squares scaled to
    // metres about the region's middle (the warp's coordinates), the warp from the world's
    // X/Z fitted when the region or the globe changes.
    for (const handout of handed) {
      const globeKey = `${globe.discCentre.x},${globe.discCentre.z},${globe.radius},${globe.enabled}`;
      if (handout.globeKey !== globeKey) {
        handout.globeKey = globeKey;
        handout.square = geoSquareOver(globe, handout.bounds);
        const [a0, b0, a1, b1] = handout.square;
        handout.origin = [(a0 + a1) / 2, (b0 + b1) / 2];
        handout.scale = (Math.PI / 180) * globe.radius;
        geoWarp(
          globe,
          handout.bounds,
          handout.origin[0],
          -handout.origin[1],
          handout.scale,
          handout.warp,
        );
        handout.indexed = '';
      }
      const [a0, b0, a1, b1] = handout.square;
      const [oa, ob] = handout.origin;
      const k = handout.scale;
      const scaled = (key: number): [number, number, number] => {
        const [a, b, width] = geoTileSquare(key);
        return [(a - oa) * k, (b - ob) * k, width * k];
      };
      // Out of view, the finest tile in: a face in view may stand on ground that is not.
      const finestAt = (
        qa: number,
        qb: number,
      ): SceneryReliefTileGroundTile | undefined => {
        const longitude = oa + qa / k;
        const latitude = -(ob + qb / k);
        for (let depth = MAX_DEPTH; depth >= 0; depth--) {
          const key = geoTileKeyAt(depth, longitude, latitude);
          const tile = streamer.get(key);
          const slot = slotOf.get(key);
          if (!tile || slot === undefined || slot < 0) continue;
          const [minX, minZ, width] = scaled(key);
          return { square: { minX, minZ, width, slot }, tile };
        }
        return undefined;
      };
      // Indexed again only when the tiles drawn there, or those in, change.
      const there: SceneryReliefTileGroundTile[] = [];
      let indexed = `${streaming.resident.changes}`;
      for (const key of selection.draw) {
        const [a, b, width] = geoTileSquare(key);
        if (a >= a1 || b >= b1 || a + width <= a0 || b + width <= b0) continue;
        const tile = streamer.get(key);
        const slot = slotOf.get(key);
        if (!tile || slot === undefined || slot < 0) continue;
        const [minX, minZ, w] = scaled(key);
        there.push({ square: { minX, minZ, width: w, slot }, tile });
        indexed += `,${key}`;
      }
      if (indexed !== handout.indexed) {
        handout.indexed = indexed;
        handout.clip.set(
          there,
          [(a0 - oa) * k, (b0 - ob) * k, (a1 - oa) * k, (b1 - ob) * k],
          level,
          handout.warp,
          finestAt,
        );
      }
      handout.clip.setLive(groundLive && visible);
    }

    if (stats.current && frame.current++ % STATS_EVERY === 0) {
      const held = streamer.stats;
      stats.current({
        drawn: count,
        triangles: count * TILE_TRIANGLES,
        depth: deepest,
        cell:
          ((180 / 2 ** deepest / RELIEF_TILE_CELLS) * Math.PI * globe.radius) /
          180,
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
        onBeforeRender={sky.onBeforeDraw}
      />
      {seeThroughMaterial && (
        <mesh
          geometry={subset}
          material={seeThroughMaterial}
          frustumCulled={false}
          visible={visible}
          onBeforeRender={sky.onBeforeDraw}
        />
      )}
    </>
  );
};
