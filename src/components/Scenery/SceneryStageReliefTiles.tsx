import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Frustum,
  InstancedBufferAttribute,
  Matrix4,
  Mesh,
  Texture,
  Vector3,
  Vector4,
} from 'three';
import { useGenerator } from '../../hooks/useGenerator';
import {
  geoReliefTileHeightAt,
  RELIEF_TILE_CELLS,
  ReliefLayersSource,
  ReliefTile,
} from '../../sdk/geometries/relief-tiles';
import type { HeightFieldTile } from '../../sdk/geometries/height-field-clip';
import type { HeightFieldClip } from '../../sdk/materials/height-field-clip';
import {
  type QuadtreeLayout,
  type QuadtreeSelection,
  selectPinnedTiles,
  selectQuadtreeTiles,
} from '../../sdk/tiles/quadtree';
import {
  GEO_TILE_ROOT_SPAN,
  geoTileKeyAt,
  geoTileRegion,
} from '../../sdk/tiles/geo-tile-keys';
import {
  geoAt,
  geoSquareOver,
  geoTileLayout,
  geoTileOffsets,
  geoTileSquare,
  geoTileWidth,
  GeoTileView,
} from '../../sdk/tiles/geo-tile-globe';
import { tileAddress, tileParent } from '../../sdk/tiles/tile-keys';
import { TileStreamer } from '../../sdk/tiles/tile-streamer';
import {
  tileOffsetIn,
  TileTransitions,
} from '../../sdk/tiles/tile-transitions';
import { pixelsPerUnit } from '../../sdk/utils/lod';
import { sceneryReliefTile, SceneryReliefTileResponse } from './scenery-defs';
import type { SceneryMaterial } from './scenery-material';
import type { SceneryReliefLoading } from './scenery-progress';
import type { SceneryReliefHub } from './scenery-relief-hub';
import { geoWarp } from './scenery-relief-geo';
import { SceneryReliefAtlas } from './scenery-relief-atlas';
import {
  createReliefSampler,
  ReliefPins,
  ReliefSampler,
} from './scenery-relief-sampler';
import {
  createSceneryReliefTileFromBelowMaterial,
  createSceneryReliefTileMaterial,
  createSceneryReliefTilePatch,
  createSceneryReliefTileSeeThroughMaterial,
  createSceneryReliefTileSubset,
  SKY_RELIEF_MAX_TILES,
  SKY_RELIEF_TILE_ATTRIBUTES,
  SceneryReliefTileDebug,
  SceneryReliefTileGround,
  SceneryReliefTileGroundTile,
  SceneryReliefTileOccupants,
  SceneryReliefTileTextures,
} from './scenery-relief-tiles';
import type { SceneryStageBounds } from './scenery-stage';
import {
  SceneryStageReliefOverview,
  type SceneryReliefOverviewState,
} from './SceneryStageReliefOverview';

/** The most tiles in at once: a layer of each tile texture per tile. */
const MAX_SLOTS = 1024;
// What one tile holds: heights, normals and layer ids per node.
const TILE_BYTES = (RELIEF_TILE_CELLS + 3) ** 2 * (4 + 4 + 1);
// Triangles a tile draws: its grid, and its skirts.
const TILE_TRIANGLES = 2 * RELIEF_TILE_CELLS ** 2 + 8 * RELIEF_TILE_CELLS;
// The deepest tile: about 1 m cells north–south (geographic tiles, 180° / 2^19 / 32).
const MAX_DEPTH = 19;
// A tile blending from nothing: `reliefTileFrom` with no source's slot.
const NO_SOURCE = [0, 0, 1, -1];
// The slope a tile's surface may stray from the ground's before its cells' size on screen
// splits it too: about 0.6°. Flat seabed is shaded alike at any depth.
const CELL_MIN_SLOPE = 0.01;
// Over the ground handed out (`onGround`), the most a tile's error may show on screen:
// a gap between a face and the ground is then never seen.
const GROUND_PIXEL_ERROR = 0.5;
// Frames between reports.
const STATS_EVERY = 15;
// The deepest tile the overview past the tiles' reach draws: 180° / 2^14 / 32, about 38 m
// cells north–south. A wide region is drawn coarser (see OVERVIEW_MAX_ENTRIES).
const OVERVIEW_MAX_DEPTH = 14;
// The most a cell of the overview's may span on screen, in pixels: it is coloured, lit and
// its coast drawn per pixel from the tiles' heights, so they must be about as fine as the
// pixels — the tiles', drawn as geometry and lit from filtered normals, need not be.
const OVERVIEW_CELL_PIXELS = 2;
// The share of the slots the overview's tiles may take: past it, its cells are chosen again
// larger on screen (by half, at most OVERVIEW_BUDGET_ATTEMPTS times) until they fit, so the
// tiles near the camera never go without.
const OVERVIEW_SLOT_SHARE = 0.5;
const OVERVIEW_BUDGET_ATTEMPTS = 3;
// The nearest the overview starts, as a share of the tiles' reach (relief-fragment.glsl's
// RELIEF_HANDOVER_MIN, the same): where the view meets the deepest ground past the reach, but
// not nearer. From low over deep water that point comes near the camera, and the overview
// chose every tile out to it at its own detail.
const OVERVIEW_HANDOVER_MIN = 0.8;
// The most entries along a side of the overview's index (`SceneryReliefAtlas`): tiles no
// narrower than an entry are drawn deeper than this allows over a wide region, so a region
// that would need more is drawn from coarser tiles. 512 x 512 entries are 4 MB.
const OVERVIEW_MAX_ENTRIES = 512;
// A frustum plane every point lies in front of: the overview's frustum has no far plane.
const NO_PLANE_NORMAL = new Vector3();

// The region the overview's tiles cover (min X, min Z, max X, max Z in `geoTileSquare`'s
// coordinates), and the deepest tile its index holds over it: no narrower than an entry of
// at most OVERVIEW_MAX_ENTRIES along a side.
function overviewRegion(draw: number[]) {
  let west = Infinity;
  let north = Infinity;
  let east = -Infinity;
  let south = -Infinity;
  for (const key of draw) {
    const [a, b, width] = geoTileSquare(key);
    west = Math.min(west, a);
    north = Math.min(north, b);
    east = Math.max(east, a + width);
    south = Math.max(south, b + width);
  }
  const extent = Math.max(east - west, south - north);
  const depth =
    extent > 0 && Number.isFinite(extent)
      ? Math.max(
          Math.min(
            OVERVIEW_MAX_DEPTH,
            Math.floor(
              Math.log2((OVERVIEW_MAX_ENTRIES * GEO_TILE_ROOT_SPAN) / extent),
            ),
          ),
          0,
        )
      : OVERVIEW_MAX_DEPTH;
  return {
    bounds: [west, north, east, south] as [number, number, number, number],
    depth,
  };
}

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
  /** ms a swap between levels of detail takes (see `SceneryStage`'s `relief.transition`); 0 at once */
  transition: number;
  /** what it compiles with from the sky, as a key (`SceneryOceanState.definesKey`): a new one needs a new material */
  definesKey?: string;
  /** the void has walls: from below, the relief is shaded as their lid (`SceneryOceanState.abyssWalls`) */
  abyssWalls?: boolean;
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
  /** the sky's sea surface layer's `renderOrder`: the overview past the tiles draws after it */
  skyOrder: number;
  /** told the tiles drawn, each time they are chosen, for what lies on them (`SceneryOceanState.reliefTiles`) */
  hub?: SceneryReliefHub;
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
  transition,
  definesKey,
  abyssWalls = false,
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
  skyOrder,
  hub,
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
  // The overview past the tiles' reach: tiles of the same streamer, coarser, chosen in the
  // frame loop and indexed over the globe for it to read per pixel.
  const overviewAtlas = useMemo(
    () => new SceneryReliefAtlas(textures),
    [textures],
  );
  useEffect(() => () => overviewAtlas.dispose(), [overviewAtlas]);
  const overviewState = useMemo<SceneryReliefOverviewState>(
    () => ({ beyond: false, lowest: 0 }),
    [],
  );
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
  // From under the ground, the void's lid: the same tiles' undersides, drawn instead (see
  // the frame loop). Compiled with the stage's, hidden or not.
  const belowMaterial = useMemo(
    () => createSceneryReliefTileFromBelowMaterial(material, abyssWalls),
    [material, abyssWalls],
  );
  useEffect(() => () => belowMaterial.dispose(), [belowMaterial]);
  const belowSeeThroughMaterial = useMemo(
    () =>
      seeThrough
        ? createSceneryReliefTileSeeThroughMaterial(belowMaterial)
        : null,
    [belowMaterial, seeThrough],
  );
  useEffect(
    () => () => belowSeeThroughMaterial?.dispose(),
    [belowSeeThroughMaterial],
  );
  const aboveMesh = useRef<Mesh>(null);
  const aboveSeeThroughMesh = useRef<Mesh>(null);
  const belowMesh = useRef<Mesh>(null);
  const belowSeeThroughMesh = useRef<Mesh>(null);
  // The tiles over the stage's area, drawn again see-through.
  const subset = useMemo(
    () => createSceneryReliefTileSubset(geometry),
    [geometry],
  );
  // Its own tiles only: the vertices and triangles are the patch's.
  useEffect(
    () => () => {
      for (const name of SKY_RELIEF_TILE_ATTRIBUTES)
        subset.deleteAttribute(name);
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
  // Where the tiles draw the seabed, it hides what lies below it by depth (skyOceanCover).
  useEffect(() => {
    sky.oceanReliefReach = visible ? reach : 0;
    return () => {
      sky.oceanReliefReach = 0;
    };
  }, [sky, reach, visible]);

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
    // The highest ground in so far, for the horizon; and the lowest, for what lies on it.
    const reached = { highest: 0, lowest: 0 };
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
          reached.lowest = Math.min(reached.lowest, tile.min);
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
    // The ground over a geographic tile: from the finest tile in over it, whose range holds it.
    const rangeAt = (key: number): [number, number] | null => {
      for (let at = key; ; at = tileParent(at)) {
        const tile = streamer.get(at);
        if (tile) return [tile.min, tile.max];
        if (tileAddress(at)[0] === 0) return null;
      }
    };
    // The ground at a point, from the finest tile in there, on its triangles.
    const heightAt = (longitude: number, latitude: number): number | null => {
      for (let depth = MAX_DEPTH; depth >= 0; depth--) {
        const tile = streamer.get(geoTileKeyAt(depth, longitude, latitude));
        if (tile) return geoReliefTileHeightAt(tile, longitude, latitude, true);
      }
      return null;
    };
    return {
      streamer,
      slotOf,
      reached,
      resident,
      rangeAt,
      heightAt,
      split: new Set<number>(),
      overviewSplit: new Set<number>(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinnedSquares reads refs
  }, [generate, sourceKey, textures, slots, pins]);
  useEffect(() => () => streaming.streamer.dispose(), [streaming]);
  // Who tells the hub: once gone, what lay on these tiles lies flat again.
  const hubOwner = useMemo(() => ({}), []);
  useEffect(() => () => hub?.publish(hubOwner, null), [hub, hubOwner]);

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
  const view = useMemo(() => {
    const frustum = new Frustum();
    const eye = { latitude: 0, longitude: 0 };
    const layout: GeoTileView = {
      globe: sky.globe,
      eye: new Vector3(),
      eyeAt: eye,
      altitude: 0,
      frustum,
      seen: 0,
      level: 0,
    };
    // The overview's: the same view without a far plane, out to the horizon, its tiles
    // left out where they lie wholly within the tiles' reach.
    const overviewFrustum = new Frustum();
    const overviewLayout: GeoTileView = {
      ...layout,
      frustum: overviewFrustum,
    };
    const overviewGeo = geoTileLayout(overviewLayout);
    const overview: {
      frustum: Frustum;
      layout: GeoTileView;
      /** where its tiles start: tiles wholly within it are the tiles'. Short of their reach by as much as the view meets the sea's level before the deepest ground (see relief-fragment.glsl's hand-over) */
      reach: number;
      /** the cells' most pixels it last chose by (OVERVIEW_CELL_PIXELS, coarser over its share): the tiles take it toward their reach */
      pixels: number;
      tiles: QuadtreeLayout;
      /** what its index was last built from */
      indexed: string;
    } = {
      frustum: overviewFrustum,
      layout: overviewLayout,
      reach: 0,
      pixels: OVERVIEW_CELL_PIXELS,
      tiles: {
        ...overviewGeo,
        // A tile's farthest point lies no farther than its nearest and twice its width.
        shows: (key, minY, maxY) =>
          overviewGeo.shows(key, minY, maxY) &&
          overviewGeo.distance(key, minY, maxY) + 2 * overviewGeo.width(key) >
            overview.reach,
      },
      indexed: '',
    };
    return {
      frustum,
      matrix: new Matrix4(),
      eye,
      warp: new Matrix4(),
      stage: {
        key: '',
        square: [0, 0, 0, 0] as [number, number, number, number],
      },
      layout,
      tiles: geoTileLayout(layout),
      overview,
      // Soft swaps between levels of detail; the relief appears at once where nothing was.
      transitions: new TileTransitions(transition, false),
      // The tiles drawn, in the order of their instances.
      drawnKeys: [] as number[],
      // The fills chosen this frame: each tile not in, and the ancestor it is drawn from.
      fillSource: new Map<number, number>(),
      // What the tiles were last chosen for (see the frame loop): nothing changed, nothing to do.
      chosen: {
        key: '',
        pins: null as readonly [number, number, number, number][] | null,
        streaming: null as unknown,
        handed: null as unknown,
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- its duration is set each frame
  }, [sky]);
  const tiles = geometry.getAttribute('reliefTile') as InstancedBufferAttribute;
  const chis = geometry.getAttribute(
    'reliefTileChi',
  ) as InstancedBufferAttribute;
  const skirts = geometry.getAttribute(
    'reliefTileSkirt',
  ) as InstancedBufferAttribute;
  const froms = geometry.getAttribute(
    'reliefTileFrom',
  ) as InstancedBufferAttribute;
  const blends = geometry.getAttribute(
    'reliefTileBlend',
  ) as InstancedBufferAttribute;

  useFrame(({ camera, size, viewport }) => {
    const { streamer, slotOf } = streaming;
    const globe = sky.globe;
    // Placed by latitude and longitude: nothing without the map the scene is in.
    if (!globe.frame) {
      geometry.instanceCount = 0;
      subset.instanceCount = 0;
      hub?.publish(hubOwner, null);
      return;
    }
    // The camera: where it is over the Earth, and its altitude over the globe.
    const eye = globe.geographic(camera.position, view.eye);
    const altitude = globe.altitude(camera.position);
    const y = level + altitude;
    // Controls move the camera before this runs but leave its matrices to the render: last
    // frame's frustum culls the tiles a quick turn or zoom-out brings in at the edges.
    camera.updateMatrixWorld();
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
    // Under it — in the void, or in rock above the sea's own seabed — the relief is the
    // void's lid: its undersides are drawn instead of its tops.
    const under = ground !== null && y < ground;
    for (const [mesh, shows] of [
      [aboveMesh, !under],
      [aboveSeeThroughMesh, !under],
      [belowMesh, under],
      [belowSeeThroughMesh, under],
    ] as const) {
      if (mesh.current) mesh.current.visible = visible && shows;
    }

    // No farther than can be seen: past the globe's horizon, the highest ground's own, and
    // the disc's flat sea, over which a view runs on level.
    let seen = reach;
    let horizon = Infinity;
    if (sky.globeEnabled) {
      const R = globe.radius;
      horizon =
        globe.discRadius +
        Math.sqrt(2 * R * Math.max(altitude, 0) + altitude * altitude) +
        Math.sqrt(2 * R * Math.max(streaming.reached.highest, 0));
      seen = Math.min(reach, horizon);
    }
    // The ground in view reaches past the tiles: the overview draws it.
    overviewState.beyond = horizon > reach;
    overviewState.lowest = streaming.reached.lowest;
    // Toward their reach, where the overview takes over, the tiles take its rules, eased in
    // from half the reach: cells as fine on screen as its (as it last chose them), and every
    // tile split by them where it colours by height — with the water off, or above the sea —
    // so the two meet at the same detail. Nearer, as before. Not if that would want more
    // than their share of the slots (below).
    const wet = sky.oceanWater;
    let easing = overviewState.beyond;
    const towardOverview = (distance: number) =>
      easing ? Math.min(Math.max((2 * distance) / reach - 1, 0), 1) : 0;
    const finest = Math.min(view.overview.pixels, cellPixels);
    const tileCellPixels = (distance: number) =>
      cellPixels * (finest / cellPixels) ** towardOverview(distance);

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
    // The tiles' own choice: rough as the overview's toward their reach (above).
    const tilesInfo = (key: number) => {
      const known = info(key);
      if (
        known &&
        !known.rough &&
        (!wet || known.maxY > level) &&
        towardOverview(view.tiles.distance(key, known.minY, known.maxY)) > 0
      )
        known.rough = true;
      return known;
    };
    // Where the tiles lie: on the globe by their latitudes and longitudes. Their lowest
    // reaches a skirt lower.
    view.layout.globe = globe;
    view.layout.eye = camera.position;
    view.layout.altitude = altitude;
    view.layout.seen = seen;
    view.layout.level = level;
    const layout = view.tiles;

    // Nothing moved, nothing came in or went, nothing asked for changed: the tiles chosen,
    // their instances and the grounds handed out stand. A view held still costs nothing
    // here once the swaps' blends are done (GeoPolygons does the same).
    const e = view.matrix.elements;
    const pinnedNow = pinnedSquares();
    const chosenKey = `${e.join(',')}|${size.width}x${size.height}x${viewport.dpr}|${streaming.resident.changes}|${y}|${seen}|${pixelError}|${cellPixels}|${transition}|${under}|${globe.version}|${groundsKey}|${groundLive}|${visible}|${!!seeThroughMaterial}|${stageMinX},${stageMinZ},${stageMaxX},${stageMaxZ}|${sky.oceanWater}`;
    if (
      chosenKey === view.chosen.key &&
      pinnedNow === view.chosen.pins &&
      streaming === view.chosen.streaming &&
      handed === view.chosen.handed &&
      !view.transitions.active
    )
      return;
    view.chosen.key = chosenKey;
    view.chosen.pins = pinnedNow;
    view.chosen.streaming = streaming;
    view.chosen.handed = handed;

    const perUnit = pixelsPerUnit(camera, size.height * viewport.dpr);
    const choose = () =>
      selectQuadtreeTiles({
        eye: [0, y, 0],
        reach: seen,
        pixelsPerUnit: perUnit,
        pixelError,
        // Under the ground the tiles' tops face away: their shading is not seen.
        cellPixels: under
          ? undefined
          : {
              cells: RELIEF_TILE_CELLS,
              pixels: easing ? tileCellPixels : cellPixels,
              minSlope: CELL_MIN_SLOPE,
            },
        maxDepth: MAX_DEPTH,
        info: tilesInfo,
        split: streaming.split,
        // Over the ground handed out, what ends at it never stands off it visibly.
        finer: handed.map(({ square }) => ({
          bounds: square,
          pixelError: GROUND_PIXEL_ERROR,
        })),
        layout,
        // After a zoom-out, finer tiles in stay drawn; the squares still loading are filled
        // from their parent. The level a further zoom-out needs is fetched ahead, last.
        fill: true,
        prefetch: true,
      });
    let selection = choose();
    // Taking the overview's detail, they may want no more than their share of the slots
    // (prefetches aside, at priority below 0): past it they are chosen again as before,
    // rather than load tiles and let them go in turn (2939 asked for, 2026-10-30).
    const wanted =
      selection.draw.length +
      selection.want.filter(({ priority }) => priority >= 0).length;
    if (easing && wanted > slots * (1 - OVERVIEW_SLOT_SHARE)) {
      easing = false;
      selection = choose();
    }
    streaming.split = selection.split;
    // Past the tiles' reach, while the ground in view lies farther: the overview's tiles,
    // by the same rules, out to the horizon and no deeper than its index allows.
    let overviewSelection: QuadtreeSelection | null = null;
    const overview = view.overview;
    if (overviewState.beyond && visible) {
      overview.frustum.copy(view.frustum);
      overview.frustum.planes[4].set(NO_PLANE_NORMAL, 1);
      overview.layout.globe = globe;
      overview.layout.eye = camera.position;
      overview.layout.altitude = altitude;
      overview.layout.seen = horizon;
      overview.layout.level = level;
      overview.reach =
        reach *
        Math.max(
          Math.max(altitude, 1) /
            (Math.max(altitude, 1) - Math.min(streaming.reached.lowest, 0)),
          OVERVIEW_HANDOVER_MIN,
        );
      // Land is coloured by its height per pixel, and with the water off so is the seabed:
      // their cells split by their size on screen however flat. Under the water only a
      // slope's shading would show — and the water hides it.
      const water = sky.oceanWater;
      const overviewInfo = (key: number) => {
        const known = info(key);
        if (!known) return undefined;
        known.rough ||= !water || known.maxY > level;
        return known;
      };
      // As fine as OVERVIEW_CELL_PIXELS and OVERVIEW_MAX_DEPTH, chosen again in the same
      // frame no deeper than its index allows over the region it covers, and coarser on
      // screen while it wants more than its share of the slots: from the finest each time,
      // so a pose has one choice whatever came before it.
      const share = slots * OVERVIEW_SLOT_SHARE;
      let pixels = OVERVIEW_CELL_PIXELS;
      let maxDepth = OVERVIEW_MAX_DEPTH;
      for (let attempt = 0; ; attempt++) {
        const chosen = selectQuadtreeTiles({
          eye: [0, y, 0],
          reach: horizon,
          pixelsPerUnit: perUnit,
          pixelError,
          cellPixels: under
            ? undefined
            : {
                cells: RELIEF_TILE_CELLS,
                pixels,
                minSlope: CELL_MIN_SLOPE,
              },
          maxDepth,
          info: overviewInfo,
          split: streaming.overviewSplit,
          layout: overview.tiles,
        });
        overviewSelection = chosen;
        if (attempt >= OVERVIEW_BUDGET_ATTEMPTS) break;
        const allowed = overviewRegion(chosen.draw).depth;
        const deepest = Math.max(
          0,
          ...chosen.draw.map(key => tileAddress(key)[0]),
          ...chosen.want.map(({ key }) => tileAddress(key)[0]),
        );
        if (deepest > allowed) maxDepth = allowed;
        else if (chosen.draw.length + chosen.want.length > share) pixels *= 1.5;
        else break;
      }
      streaming.overviewSplit = overviewSelection!.split;
      overview.pixels = pixels;
    }
    // The overview's index over the region its tiles cover, built again only when they
    // change; tiles deeper than the region allows (the last choice's, past its attempts)
    // stand in for by their ancestors, in as a tile is split only once in.
    const indexOverview = (draw: number[]) => {
      const { bounds, depth } = overviewRegion(draw);
      const keys = new Set<number>();
      for (let key of draw) {
        while (tileAddress(key)[0] > depth) key = tileParent(key);
        keys.add(key);
      }
      const squares: HeightFieldTile[] = [];
      let indexed = '';
      for (const key of keys) {
        const slot = slotOf.get(key) ?? -1;
        if (slot < 0) continue;
        const [minX, minZ, width] = geoTileSquare(key);
        squares.push({ minX, minZ, width, slot });
        indexed += `${key}:${slot},`;
      }
      if (indexed === overview.indexed) return;
      overview.indexed = indexed;
      // Two more for the region's ends, aligned to the entries.
      overviewAtlas.set(squares, bounds, OVERVIEW_MAX_ENTRIES + 2);
    };
    const fillSource = view.fillSource;
    fillSource.clear();
    for (const fill of selection.fills) fillSource.set(fill.key, fill.source);
    // Soft swaps (TileTransitions): each tile drawn blends from the tile it replaces. Not
    // over the ground handed out, which must meet what is drawn exactly.
    const transitions = view.transitions;
    transitions.duration = transition;
    const drawnTiles = transitions.update(
      [
        ...selection.draw.filter(key => (slotOf.get(key) ?? -1) >= 0),
        ...fillSource.keys(),
      ],
      performance.now(),
      {
        isIn: key => (slotOf.get(key) ?? -1) >= 0,
        proxy: key => fillSource.get(key) ?? null,
        fixed:
          handed.length > 0
            ? key => {
                const [a, b, width] = geoTileSquare(key);
                return handed.some(
                  ({ square: [a0, b0, a1, b1] }) =>
                    a < a1 && b < b1 && a + width > a0 && b + width > b0,
                );
              }
            : undefined,
      },
    );
    // What is pinned is held in down to the finest, whatever the view.
    const pinned = pinnedNow;
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
      [
        ...selection.draw,
        ...selection.split,
        ...selection.prefetched,
        ...(pinning ? pinning.keep : []),
        ...transitions.keep,
        ...(overviewSelection
          ? [...overviewSelection.draw, ...overviewSelection.split]
          : []),
      ],
      [
        ...(pinning ? pinning.want : []),
        ...selection.want,
        ...(overviewSelection ? overviewSelection.want : []),
      ],
    );
    if (overviewSelection) indexOverview(overviewSelection.draw);
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
    const fromArray = froms.array as Float32Array;
    const blendArray = blends.array as Float32Array;
    const drawnKeys = view.drawnKeys;
    drawnKeys.length = 0;
    let count = 0;
    let deepest = 0;
    for (const { key, from, blend, proxy } of drawnTiles) {
      if (count >= SKY_RELIEF_MAX_TILES) break;
      // A fill: its own square, all of it drawn from the ancestor in its place.
      const data = proxy ?? key;
      const tile = streamer.get(data);
      const slot = slotOf.get(data);
      if (!tile || slot === undefined || slot < 0) continue;
      const [depth] = tileAddress(key);
      deepest = Math.max(deepest, tileAddress(data)[0]);
      geoTileOffsets(globe, key, array, 4 * count, chiArray, 3 * count);
      array[4 * count + 2] = depth;
      array[4 * count + 3] = slot;
      // Deep enough to close the crack to a neighbour a level coarser.
      const parent =
        proxy === undefined && depth > 0
          ? streamer.get(tileParent(key))
          : undefined;
      drops[count] =
        Math.max(tile.error, parent?.error ?? 0) +
        (geoTileWidth(globe, key) / RELIEF_TILE_CELLS) * 0.05;
      const blendSource = proxy ?? from;
      const fromSlot =
        blendSource === null ? -1 : (slotOf.get(blendSource) ?? -1);
      if (fromSlot >= 0) {
        fromArray.set(tileOffsetIn(key, blendSource!), 4 * count);
        fromArray[4 * count + 3] = fromSlot;
        // Blending from a coarser tile, its skirt drops as deep as that tile's error.
        drops[count] = Math.max(
          drops[count],
          streamer.get(blendSource!)?.error ?? 0,
        );
      } else {
        fromArray.set(NO_SOURCE, 4 * count);
      }
      blendArray[count] = proxy !== undefined ? 0 : fromSlot >= 0 ? blend : 1;
      drawnKeys.push(key);
      count++;
    }
    geometry.instanceCount = count;
    // What lies on the relief (a draped GeoTileLayer) meets these tiles, as drawn now. With
    // none drawn — past the far plane — still told: the ground in (heightAt), the overview's
    // tiles too, is what lies on it there stands on.
    hub?.publish(
      hubOwner,
      visible
        ? {
            heights: textures.heights,
            cells: RELIEF_TILE_CELLS,
            keys: drawnKeys,
            tiles: array,
            froms: fromArray,
            blends: blendArray,
            lowest: streaming.reached.lowest,
            highest: streaming.reached.highest,
            rangeAt: streaming.rangeAt,
            heightAt: streaming.heightAt,
            resident: streaming.resident.changes,
          }
        : null,
    );
    // ⚠️ An empty update range uploads the whole array's tail instead.
    if (count > 0) {
      for (const [attribute, size] of [
        [tiles, 4],
        [chis, 3],
        [skirts, 1],
        [froms, 4],
        [blends, 1],
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
      const into = SKY_RELIEF_TILE_ATTRIBUTES.map(name => {
        const attribute = subset.getAttribute(name) as InstancedBufferAttribute;
        const from = geometry.getAttribute(name) as InstancedBufferAttribute;
        return {
          attribute,
          step: attribute.itemSize,
          to: attribute.array as Float32Array,
          from: from.array as Float32Array,
        };
      });
      for (let i = 0; i < count; i++) {
        const [a, b, width] = geoTileSquare(drawnKeys[i]);
        if (a >= s1 || b >= t1 || a + width <= s0 || b + width <= t0) continue;
        for (const { step, to, from } of into)
          to.set(from.subarray(step * i, step * (i + 1)), step * inStage);
        inStage++;
      }
      if (inStage > 0) {
        for (const { attribute, step } of into) {
          attribute.clearUpdateRanges();
          attribute.addUpdateRange(0, step * inStage);
          attribute.needsUpdate = true;
        }
      }
    }
    subset.instanceCount = inStage;

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
      // The tiles drawn first, then what the fills there are drawn from: the first indexed
      // over a square wins, so a fill's source answers only where no drawn tile does.
      const sources = [...new Set(fillSource.values())];
      for (const key of [...selection.draw, ...sources]) {
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

  // Shown each frame: the tops from above the ground, the undersides from under it; and
  // past the tiles' reach, the overview.
  return (
    <>
      <SceneryStageReliefOverview
        sky={sky}
        atlas={overviewAtlas}
        told={overviewState}
        base={source.base}
        looks={looks}
        reach={reach}
        definesKey={definesKey}
        skyOrder={skyOrder}
        visible={visible}
      />
      <mesh
        ref={aboveMesh}
        geometry={geometry}
        material={material}
        frustumCulled={false}
        visible={false}
        onBeforeRender={sky.onBeforeDraw}
      />
      <mesh
        ref={belowMesh}
        geometry={geometry}
        material={belowMaterial}
        frustumCulled={false}
        visible={false}
        onBeforeRender={sky.onBeforeDraw}
      />
      {seeThroughMaterial && (
        <mesh
          ref={aboveSeeThroughMesh}
          geometry={subset}
          material={seeThroughMaterial}
          frustumCulled={false}
          visible={false}
          onBeforeRender={sky.onBeforeDraw}
        />
      )}
      {belowSeeThroughMaterial && (
        <mesh
          ref={belowSeeThroughMesh}
          geometry={subset}
          material={belowSeeThroughMaterial}
          frustumCulled={false}
          visible={false}
          onBeforeRender={sky.onBeforeDraw}
        />
      )}
    </>
  );
};
