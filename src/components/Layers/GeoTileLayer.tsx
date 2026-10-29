import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DataArrayTexture,
  Frustum,
  InstancedBufferAttribute,
  Matrix4,
  Mesh,
  Vector2,
  Vector3,
  type IUniform,
} from 'three';
import { createLayers, LAYERS } from '../../layers/layers';
import type { LayerVisibility } from '../../sdk/layers/layer-visibility';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import {
  geoTileLayout,
  geoTileOffsets,
  geoTileWidth,
  type GeoTileView,
} from '../../sdk/tiles/geo-tile-globe';
import { selectQuadtreeTiles } from '../../sdk/tiles/quadtree';
import {
  composeTileOffsets,
  tilesUnder,
  type TileCover,
} from '../../sdk/tiles/tile-cover';
import { tileAddress } from '../../sdk/tiles/tile-keys';
import { TileStreamer } from '../../sdk/tiles/tile-streamer';
import {
  tileOffsetIn,
  TileTransitions,
} from '../../sdk/tiles/tile-transitions';
import { pixelsPerUnit } from '../../sdk/utils/lod';
import { useSceneryOcean } from '../Scenery/scenery-context';
import {
  createGeoTileMaterial,
  createGeoTilePatch,
  GEO_TILE_ATTRIBUTES,
  GEO_TILE_FLAT_CELLS,
  GEO_TILE_IDENTITY,
  GEO_TILE_MAX_INSTANCES,
  GeoTileBounds,
  GeoTileTextures,
  type GeoTileContent,
  type GeoTileFormat,
} from './geo-tile-layer';
import { layerShownAt, useLayerGlobe } from './layer-globe';

export type { GeoTileContent, GeoTileFormat } from './geo-tile-layer';

/**
 * Where a {@link GeoTileLayer}'s tiles come from.
 *
 * @group Layers
 */
export type GeoTileLayerSource = {
  /** texels along a tile's side, its border aside */
  size: number;
  /** the texels' format. Default RGBA, 8 bits, filtered */
  format?: GeoTileFormat;
  /** whether anything lies over the geographic tile `key`: tiles with nothing are neither chosen, loaded nor drawn */
  covers: (key: number) => boolean;
  /** the tile `key` (see `geo-tile-keys`): on a worker (`useGenerator`), or here */
  load: (key: number) => Promise<GeoTileContent>;
};

/**
 * How a {@link GeoTileLayer} draws its tiles: GLSL defining
 * `vec4 geoTileSample(float slot, vec2 uv, float texelMetres)`, the premultiplied colour at
 * `uv` (0…1 east and south) across the tile in `slot`, whose texels are `texelMetres` wide
 * along a meridian. It may read the tiles through `geoTileRead(slot, uv)` (filtered),
 * `geoTileFetch(slot, uv)` (the texel under it) and `geoTileTexel(uv)` (where it lies in
 * them, the border counted), and its own `uniforms` (their objects kept: set their values).
 * A tile and the one it blends from are both sampled, so the colour must depend on nothing
 * but the arguments and the uniforms. ⚠️ Derivatives (`fwidth`) only before any branch
 * that is not the same over a tile.
 *
 * @group Layers
 */
export type GeoTileLayerShader = {
  sample: string;
  uniforms?: Record<string, IUniform>;
};

/**
 * What every geographic tile layer takes: where it lies, how it is seen, how its tiles are
 * chosen. See {@link GeoTileLayer}.
 *
 * @expand
 * @group Layers
 */
export type GeoTileLayerOptions = LayerVisibility & {
  /** metres over the sea's level, along up (negative below: a flat seabed's depth); draped, where no relief is drawn. Default 0, on the sea */
  height?: number;
  /**
   * lie on the relief a `SceneryStage` draws — its seabed and its land — exactly as drawn,
   * through its swaps between levels of detail too. Needs the layer inside the `Scenery`;
   * where no relief tile is drawn, flat at `height`. Default false
   */
  drape?: boolean;
  /**
   * inside a `Scenery` with a sea: `'fog'` is seen through the water as the seabed is,
   * dimmed with the depth and the water in front, and drawn under the sea's surface;
   * `'clear'` is drawn over everything see-through, as a map is. Outside a `Scenery`,
   * always `'clear'`. Default 'fog'
   */
  water?: 'fog' | 'clear';
  /** the whole layer's. Default 1 */
  opacity?: number;
  /** drawn this far toward the camera, in world units, so the surface it lies on does not cut through. Default 0.5 */
  lift?: number;
  /** and this much more per world unit from the camera. Default 0.001 */
  liftPerDistance?: number;
  /** split a tile while its texels span more than this many pixels. Lower is sharper and loads more. Default 2 */
  texelPixels?: number;
  /**
   * the coarsest a tile may be brought in to stand in while finer ones load, as its texels'
   * span in pixels: past it such tiles are not loaded at all — the layer goes straight to the
   * detail the view needs. What is drawn already stays drawn until its replacements are in,
   * however coarse it has become, so nothing goes missing while they load. A leaf tile (see
   * `GeoTileContent.leaf`) is drawn at any size. Default 4 x `texelPixels`
   */
  fallbackPixels?: number;
  /**
   * the shallowest geographic tile ever loaded or drawn: a floor on the detail, whatever
   * the view (a depth-`d` tile spans `180 / 2^d` degrees). Default 0
   */
  minDepth?: number;
  /**
   * ms a swap between levels of detail takes: a tile blends from the look of the one it
   * replaces (`TileTransitions`), and the layer fades in where nothing was drawn. 0 swaps at
   * once. Default 300
   */
  transition?: number;
  /** the deepest geographic tile. Default 18 (texels of about a metre, at 64 a side) */
  maxDepth?: number;
  /** where the scene lies on the Earth, without a `World` or `Scenery` to say */
  frame?: GeoFrame;
  /** the order among see-through objects drawn without an `OITRenderPass`. Default 0.5 with `water` 'fog' (after the relief, before the sea's surface), else 999 */
  renderOrder?: number;
};

/**
 * GeoTileLayer props
 * @expand
 */
export type GeoTileLayerProps = GeoTileLayerOptions & {
  /** the tiles: a new one loads them all again. Null draws nothing */
  source: GeoTileLayerSource | null;
  /** how they are drawn: a new one makes a new material. Keep it stable (`useMemo`) */
  shader: GeoTileLayerShader;
};

const LAYERS_OVERLAY = createLayers(LAYERS.OVERLAY, LAYERS.NOT_EMITTER);
const LAYERS_FOG = createLayers(LAYERS.NOT_EMITTER);
// The most tiles in at once with something drawn on them: a layer of the tiles' texture
// each. Empty tiles hold none.
const MAX_SLOTS = 512;
// A tile blending from nothing; a square flat, over no relief.
const NO_SOURCE = [0, 0, 1, -1];
// Cells along a draped patch: the relief's own, so its nodes include the relief's.
const DRAPED_CELLS = 32;

/**
 * Anything drawn on the Earth from geographic tiles of its own: a quadtree in longitude and
 * latitude (`geo-tile-keys`), each tile's texels made by `source` — on a worker or here —
 * and coloured per pixel by `shader`. `GeoPolygons` is this layer with its own tiles and
 * sampling; it takes any other area data: a raster, a heat map. ⚠️ Not for lines or points:
 * a tile's texels are squeezed one way at a grazing angle, so anything thinner than a few
 * of them breaks up there (draw lines as `GeoTubes`, points as `GeoSymbols`).
 *
 * Tiles are chosen only where `source.covers` says there is something, and split until a
 * texel spans no more than `texelPixels` pixels; loaded as wanted, nearest first, and kept
 * in while there is room; swapped softly between levels of detail. A view held still costs
 * nothing; nothing is drawn or loaded while the layer is out of its heights (`minHeight`,
 * `maxHeight`).
 *
 * Placed on the globe by latitude and longitude: inside a `Scenery`, on its globe; inside a
 * `World` alone, flat on its frame; outside both, on `frame`. Flat at `height` over the
 * sea, or, with `drape` inside a `Scenery`, on the relief its stage draws. With `water`
 * 'fog' inside a `Scenery` it is seen through the sea as the seabed is. Not picked.
 *
 * See `documents/layers.md`.
 *
 * @group Components
 */
export const GeoTileLayer = ({
  source,
  shader,
  height = 0,
  drape = false,
  water = 'fog',
  opacity = 1,
  lift = 0.5,
  liftPerDistance = 0.001,
  texelPixels = 2,
  fallbackPixels,
  minDepth = 0,
  transition = 300,
  maxDepth = 18,
  frame,
  renderOrder,
  visible = true,
  minHeight,
  maxHeight,
  fade,
}: GeoTileLayerProps) => {
  const gl = useThree(state => state.gl);
  const placed = useLayerGlobe(frame);
  const globe = placed?.globe ?? null;
  const ocean = useSceneryOcean();
  const sky = water === 'fog' && ocean ? ocean.material : null;
  const hub = drape && ocean ? ocean.reliefTiles : null;
  const size = source?.size ?? 1;
  const formatKey = JSON.stringify(source?.format ?? {});

  const slots = useMemo(() => {
    const context = gl.getContext() as WebGL2RenderingContext;
    return Math.min(
      MAX_SLOTS,
      context.getParameter(context.MAX_ARRAY_TEXTURE_LAYERS) as number,
    );
  }, [gl]);
  const textures = useMemo(
    () =>
      new GeoTileTextures(slots, size, JSON.parse(formatKey) as GeoTileFormat),
    [slots, size, formatKey],
  );
  useEffect(() => () => textures.dispose(), [textures]);
  const cells = hub ? DRAPED_CELLS : GEO_TILE_FLAT_CELLS;
  const geometry = useMemo(() => createGeoTilePatch(cells), [cells]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // The relief's heights, once one is drawn: the material is made with them. Kept when the
  // relief goes, so it is not made again for nothing: flat squares never read them.
  const [reliefTextures, setReliefTextures] = useState<{
    heights: DataArrayTexture;
    cells: number;
  } | null>(null);
  useEffect(() => {
    if (!hub) return;
    const take = () => {
      const current = hub.current;
      if (!current) return;
      setReliefTextures(known =>
        known?.heights === current.heights && known.cells === current.cells
          ? known
          : { heights: current.heights, cells: current.cells },
      );
    };
    take();
    return hub.subscribe(take);
  }, [hub]);
  const definesKey = sky ? ocean?.definesKey : '';
  const material = useMemo(
    () =>
      globe
        ? createGeoTileMaterial({
            globe,
            textures,
            sample: shader.sample,
            uniforms: shader.uniforms,
            cells,
            relief: hub ? reliefTextures : null,
            sky,
          })
        : null,
    // The sky's defines are compiled in: new ones need a new material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [globe, textures, shader, cells, hub, reliefTextures, sky, definesKey],
  );
  useEffect(() => () => material?.dispose(), [material]);
  useEffect(() => {
    if (!material) return;
    const u = material.uniforms;
    u.uGeoTileHeight.value = height;
    (u.uGeoTileLift.value as Vector2).set(lift, liftPerDistance);
  }, [material, height, lift, liftPerDistance]);

  const streaming = useMemo(() => {
    if (!source) return null;
    const slotOf = new Map<number, number>();
    // Tiles come in or go: what was chosen last is stale.
    const resident = { changes: 0 };
    const streamer = new TileStreamer<GeoTileContent>(
      {
        load: key => source.load(key),
        bytes: tile => Math.max(tile.data.byteLength, 64),
      },
      {
        budget: Math.floor(slots * 0.9) * textures.tileBytes,
        onLoad: (key, tile) => {
          slotOf.set(key, tile.empty ? -1 : textures.put(tile));
          resident.changes++;
        },
        onEvict: key => {
          textures.release(slotOf.get(key) ?? -1);
          slotOf.delete(key);
          resident.changes++;
        },
      },
    );
    return { streamer, slotOf, resident, split: new Set<number>() };
  }, [source, textures, slots]);
  useEffect(() => () => streaming?.streamer.dispose(), [streaming]);

  const mesh = useRef<Mesh>(null);
  const view = useMemo(() => {
    const frustum = new Frustum();
    const layout: GeoTileView = {
      // Set each frame before it is read.
      globe: globe!,
      eye: new Vector3(),
      eyeAt: { latitude: 0, longitude: 0 },
      altitude: 0,
      frustum,
      seen: 0,
      level: 0,
    };
    const tiles = geoTileLayout(layout);
    const bounds = new GeoTileBounds();
    return {
      frustum,
      matrix: new Matrix4(),
      layout,
      bounds,
      // Only where there is something; by the tiles' own bounds, kept between frames.
      tiles: {
        ...tiles,
        distance: (key: number) => bounds.distance(key, layout.eye),
        shows: (key: number) =>
          !!source?.covers(key) &&
          bounds.distance(key, layout.eye) <= layout.seen &&
          bounds.shows(key, layout.eye, frustum),
      },
      // What the tiles were last chosen for: chosen again only when it changes. What was
      // chosen to draw, and what to keep in or load.
      chosen: {
        key: '',
        targets: [] as number[],
        drawable: new Set<number>(),
        used: [] as number[],
        want: [] as { key: number; priority: number }[],
      },
      transitions: new TileTransitions(),
      // What was drawn last, to lay on the relief again as it changes.
      drawn: [] as { key: number; from: number | null; blend: number }[],
    };
  }, [globe, source]);
  const visibility = useRef<LayerVisibility>({});
  visibility.current = { visible, minHeight, maxHeight, fade };

  // The squares drawn: each tile drawn, or, draped, its parts over the relief's tiles drawn
  // under it, each lying on its own. Again whenever either changes.
  const covers: TileCover[] = useMemo(() => [], []);
  const compose = () => {
    if (!mesh.current || !globe || !streaming) return;
    const { slotOf } = streaming;
    const relief = hub?.current ?? null;
    const attribute = (name: (typeof GEO_TILE_ATTRIBUTES)[number][0]) =>
      (geometry.getAttribute(name) as InstancedBufferAttribute)
        .array as Float32Array;
    const tiles = attribute('layerTile');
    const chis = attribute('layerTileChi');
    const uvs = attribute('layerTileUv');
    const froms = attribute('layerTileFrom');
    const reliefs = attribute('layerTileRelief');
    const reliefFroms = attribute('layerTileReliefFrom');
    const reliefBlends = attribute('layerTileReliefBlend');
    let count = 0;
    for (const { key, from, blend } of view.drawn) {
      const slot = slotOf.get(key);
      if (slot === undefined || slot < 0) continue;
      const fromSlot = from === null ? -1 : (slotOf.get(from) ?? -1);
      const fromOffset = fromSlot >= 0 ? tileOffsetIn(key, from!) : null;
      covers.length = 0;
      if (relief) tilesUnder(key, relief.index, relief.ancestors, covers);
      if (covers.length === 0) covers.push({ square: key, under: -1 });
      for (const { square, under } of covers) {
        if (count >= GEO_TILE_MAX_INSTANCES) break;
        const own =
          square === key ? GEO_TILE_IDENTITY : tileOffsetIn(square, key);
        geoTileOffsets(globe, square, tiles, 4 * count, chis, 3 * count);
        tiles[4 * count + 2] = blend;
        tiles[4 * count + 3] = slot;
        uvs.set(own, 3 * count);
        if (fromOffset) {
          froms.set(composeTileOffsets(own, fromOffset), 4 * count);
          froms[4 * count + 3] = fromSlot;
        } else {
          froms.set(NO_SOURCE, 4 * count);
        }
        const at = under >= 0 && relief ? relief.index.get(under) : undefined;
        if (relief && at !== undefined) {
          const onRelief =
            square === under ? GEO_TILE_IDENTITY : tileOffsetIn(square, under);
          reliefs.set(onRelief, 4 * count);
          reliefs[4 * count + 3] = relief.tiles[4 * at + 3];
          const sourceSlot = relief.froms[4 * at + 3];
          if (sourceSlot >= 0) {
            reliefFroms.set(
              composeTileOffsets(onRelief, [
                relief.froms[4 * at],
                relief.froms[4 * at + 1],
                relief.froms[4 * at + 2],
              ]),
              4 * count,
            );
            reliefFroms[4 * count + 3] = sourceSlot;
          } else {
            reliefFroms.set(NO_SOURCE, 4 * count);
          }
          reliefBlends[count] = relief.blends[at];
        } else {
          reliefs.set(NO_SOURCE, 4 * count);
          reliefFroms.set(NO_SOURCE, 4 * count);
          reliefBlends[count] = 1;
        }
        count++;
      }
    }
    geometry.instanceCount = count;
    mesh.current.visible = count > 0;
    if (count === 0) return;
    for (const [name, itemSize] of GEO_TILE_ATTRIBUTES) {
      const instanced = geometry.getAttribute(name) as InstancedBufferAttribute;
      instanced.clearUpdateRanges();
      instanced.addUpdateRange(0, itemSize * count);
      instanced.needsUpdate = true;
    }
  };
  const composeRef = useRef(compose);
  composeRef.current = compose;
  // The relief chose again (after this layer did, or before): lie on what it draws now.
  useEffect(() => hub?.subscribe(() => composeRef.current()), [hub]);

  useFrame(({ camera, size: canvas, viewport }) => {
    if (!mesh.current || !material) return;
    const transitions = view.transitions;
    const hide = () => {
      geometry.instanceCount = 0;
      mesh.current!.visible = false;
      view.chosen.key = '';
      view.drawn = [];
      // Shown again, it fades in again.
      transitions.clear();
    };
    // Placed by latitude and longitude: nothing without the map the scene is in.
    if (!globe || !globe.frame || !streaming || !source) return hide();
    const altitude = globe.altitude(camera.position);
    const shown =
      layerShownAt(
        camera.position,
        globe,
        ocean,
        visibility.current,
        hub ? 'ground' : height,
      ) * opacity;
    if (shown <= 0) return hide();
    material.uniforms.uGeoTileOpacity.value = shown;
    transitions.duration = transition;

    const level = placed!.level;
    const y = level + height;
    // Draped, each tile lies on the ground under it (GeoTileBounds, by the relief's range
    // there); the highest ground reaches farthest past the horizon.
    const relief = hub?.current ?? null;
    const high = relief ? Math.max(height, relief.highest) : height;
    // Controls move the camera before this runs but leave its matrices to the render: last
    // frame's frustum culls the tiles a quick turn brings in at the edges.
    camera.updateMatrixWorld();
    view.matrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    // Nothing moved, nothing came in or went: the tiles chosen last time stand. A view held
    // still costs nothing, once the swaps' blends are done.
    const { streamer, slotOf, resident } = streaming;
    const e = view.matrix.elements;
    const chosenKey = `${e.join(',')}|${canvas.width}x${canvas.height}x${viewport.dpr}|${resident.changes}|${height}|${relief ? relief.resident : '-'}|${texelPixels}|${fallbackPixels}|${minDepth}|${maxDepth}|${globe.discCentre.x},${globe.discCentre.z},${globe.radius},${globe.enabled}`;
    const choose = chosenKey !== view.chosen.key;
    if (!choose && !transitions.active) return;
    view.chosen.key = chosenKey;

    if (choose) {
      view.frustum.setFromProjectionMatrix(view.matrix);
      const layout = view.layout;
      layout.globe = globe;
      layout.eye = camera.position;
      layout.altitude = altitude;
      layout.level = level;
      // No farther than the camera sees, nor past the globe's horizon.
      const far = (camera as { far?: number }).far ?? Infinity;
      layout.seen = globe.enabled
        ? Math.min(
            far,
            globe.discRadius +
              Math.sqrt(
                2 * globe.radius * Math.max(altitude, 0) + altitude * altitude,
              ) +
              Math.sqrt(2 * globe.radius * Math.max(high, 0)),
          )
        : far;

      view.bounds.prepare(
        globe,
        height,
        height,
        relief?.rangeAt,
        relief?.resident,
      );
      const perUnit = pixelsPerUnit(camera, canvas.height * viewport.dpr);
      const coarsest = fallbackPixels ?? 4 * texelPixels;
      // Too coarse to draw: shallower than `minDepth`, or its texels wider on screen than
      // `fallbackPixels`. Such a tile is never waited for: it is passed through as if in,
      // so the choice goes straight to the detail the view needs.
      const tooCoarse = (key: number) =>
        tileAddress(key)[0] < minDepth ||
        (geoTileWidth(globe, key) / size) *
          perUnit(view.bounds.distance(key, camera.position)) >
          coarsest;
      const selection = selectQuadtreeTiles({
        eye: [0, y, 0],
        reach: layout.seen,
        pixelsPerUnit: perUnit,
        pixelError: 1,
        cellPixels: { cells: size, pixels: texelPixels },
        maxDepth,
        info: key => {
          const tile = streamer.get(key);
          const deepest = tileAddress(key)[0] >= maxDepth;
          if (!tile) {
            return tooCoarse(key)
              ? { error: 0, minY: y, maxY: y, leaf: deepest }
              : undefined;
          }
          return {
            error: 0,
            minY: y,
            maxY: y,
            leaf: tile.leaf || tile.empty || deepest,
          };
        },
        split: streaming.split,
        layout: view.tiles,
      });
      streaming.split = selection.split;
      // Chosen: every tile the view wants, in or not. Brought in to draw: what is in with
      // something on it, and fine enough — standing in for finer tiles still loading, not
      // when it would only blur them; a leaf is the same at any detail. What is drawn
      // already stays until replaced (TileTransitions).
      view.chosen.targets = selection.draw;
      view.chosen.drawable = new Set(
        selection.draw.filter(key => {
          if ((slotOf.get(key) ?? -1) < 0) return false;
          return streamer.get(key)!.leaf || !tooCoarse(key);
        }),
      );
      view.chosen.used = [...selection.draw, ...selection.split];
      view.chosen.want = selection.want;
    }

    // Each tile blends from what it replaces (TileTransitions): its source kept in while it
    // does, and what it replaces kept drawn until all of it is covered.
    const isIn = (key: number) => (slotOf.get(key) ?? -1) >= 0;
    view.drawn = transitions.update(view.chosen.targets, performance.now(), {
      isIn,
      drawable: key => isIn(key) && view.chosen.drawable.has(key),
      isBlank: key => !source.covers(key) || !!streamer.get(key)?.empty,
    });
    streamer.update(
      transitions.keep.length
        ? [...view.chosen.used, ...transitions.keep]
        : view.chosen.used,
      view.chosen.want,
    );
    compose();
  });

  if (!material) return null;
  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={renderOrder ?? (sky ? 0.5 : 999)}
      layers={sky ? LAYERS_FOG : LAYERS_OVERLAY}
      visible={false}
      onBeforeRender={sky ? sky.onBeforeDraw : undefined}
    />
  );
};
