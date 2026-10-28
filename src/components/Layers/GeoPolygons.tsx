import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  Color,
  ColorRepresentation,
  Frustum,
  InstancedBufferAttribute,
  Matrix4,
  Mesh,
  Vector2,
  Vector3,
} from 'three';
import { useGenerator } from '../../hooks/useGenerator';
import { createLayers, LAYERS } from '../../layers/layers';
import type {
  GeoFeature,
  GeoJsonFeatureCollection,
} from '../../sdk/layers/geo-features';
import {
  layerVisibilityAt,
  type LayerVisibility,
} from '../../sdk/layers/layer-visibility';
import {
  buildOverlayTile,
  OVERLAY_TILE_SIZE,
  type OverlayTile,
} from '../../sdk/layers/overlay-tiles';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import {
  geoTileLayout,
  geoTileOffsets,
  geoTileWidth,
  type GeoTileView,
} from '../../sdk/tiles/geo-tile-globe';
import { selectQuadtreeTiles } from '../../sdk/tiles/quadtree';
import { tileAddress } from '../../sdk/tiles/tile-keys';
import { TileStreamer } from '../../sdk/tiles/tile-streamer';
import {
  tileOffsetIn,
  TileTransitions,
} from '../../sdk/tiles/tile-transitions';
import { pixelsPerUnit } from '../../sdk/utils/lod';
import {
  createOverlayMaterial,
  createOverlayPatch,
  OVERLAY_MAX_TILES,
  OverlayFeatureIndex,
  OverlayStyles,
  OverlayTileBounds,
  OverlayTileTextures,
} from './geo-overlay';
import { overlayTile } from './layer-defs';
import { useGeoFeatures, useLayerGlobe } from './layer-globe';

/**
 * How a polygon is drawn by {@link GeoPolygons}.
 *
 * @group Layers
 */
export type GeoPolygonStyle = {
  /** Default '#ffb000' */
  fill?: ColorRepresentation;
  /** Default 0.35 */
  fillOpacity?: number;
  /** Default the fill's colour */
  stroke?: ColorRepresentation;
  /** Default 1 */
  strokeOpacity?: number;
};

/**
 * GeoPolygons props
 * @expand
 */
export type GeoPolygonsProps<P = Record<string, unknown>> = LayerVisibility & {
  /** the polygons, in longitude and latitude: GeoJSON, or features read from it (`geoFeaturesFromGeoJson`). Other kinds are left out */
  data: GeoJsonFeatureCollection<P> | GeoFeature<P>[] | null;
  /** one style for all, or one per feature. Keep a function stable (`useCallback`) */
  style?: GeoPolygonStyle | ((feature: GeoFeature<P>) => GeoPolygonStyle);
  /** metres over the sea's level, along up (negative below: a flat seabed's depth). Default 0, on the sea */
  height?: number;
  /** the outline's width in pixels, inside each polygon's edge. Default 1.5; at most about 4 */
  strokeWidth?: number;
  /** the whole layer's. Default 1 */
  opacity?: number;
  /** drawn this far toward the camera, in world units, so the surface it lies on does not cut through. Default 0.5 */
  lift?: number;
  /** and this much more per world unit from the camera. Default 0.001 */
  liftPerDistance?: number;
  /** split a tile while its texels span more than this many pixels. Lower is sharper and loads more; edges stay sharp either way. Default 2 */
  texelPixels?: number;
  /**
   * the coarsest a tile may be brought in to stand in while finer ones load, as its texels'
   * span in pixels: past it such tiles are not loaded at all — the layer goes straight to the
   * detail the view needs. What is drawn already stays drawn until its replacements are in,
   * however coarse it has become, so nothing goes missing while they load. A tile wholly
   * inside a polygon, with no edge on it, is drawn at any size. Default 4 x `texelPixels`
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
  /** the deepest geographic tile. Default 18 (texels of about a metre) */
  maxDepth?: number;
  /** where the scene lies on the Earth, without a `World` or `Scenery` to say */
  frame?: GeoFrame;
  /** the order among see-through objects drawn without an `OITRenderPass`. Default 999, before labels */
  renderOrder?: number;
};

const LAYERS_OVERLAY = createLayers(LAYERS.OVERLAY, LAYERS.NOT_EMITTER);
// The most overlay tiles in at once with something drawn on them: a layer of the tiles'
// texture each (66 x 66 x 4 bytes: 8.9 MB at the most). Empty tiles hold none.
const OVERLAY_MAX_SLOTS = 512;
const TILE_BYTES = (OVERLAY_TILE_SIZE + 2) ** 2 * 4;
// A tile blending from nothing: `overlayFrom` with no source's slot.
const NO_SOURCE = [0, 0, 1, -1];
const color = new Color();
const strokeColor = new Color();
const DEFAULT_STYLE: GeoPolygonStyle = {};

/**
 * Polygons in longitude and latitude — GeoJSON, say: licences, fields, discoveries,
 * safety zones — drawn flat over the Earth, at the sea's level or any height over it,
 * with fills and outlines of their own. Placed on the globe by their latitudes and
 * longitudes: inside a `Scenery`, on its globe; inside a `World` alone, flat on its
 * frame; outside both, on `frame`. No relief is needed.
 *
 * Drawn from geographic tiles of its own, each a distance field of the polygons over it,
 * chosen and loaded only where there are polygons, finer where they are near: edges stay
 * sharp at any zoom, outlines keep their width in pixels, and nothing is drawn or loaded
 * while the layer is out of its heights (`minHeight`, `maxHeight`). Tiles are built by the
 * `overlayTile` generator where one is registered (`generateOverlayTile`), else on the
 * main thread.
 *
 * Drawn on top of the see-through objects, after them (on `LAYERS.OVERLAY` with an
 * `OITRenderPass`), tested against what is opaque: what stands in front hides it. Not
 * picked. Where polygons overlap, the later one's fill is on top; every outline shows.
 *
 * See `documents/layers.md`.
 *
 * @example
 * <World frame={frame}>
 *   <GeoPolygons
 *     data={discoveries}
 *     style={f => ({ fill: f.properties.hcType === 'GAS' ? 'red' : 'green' })}
 *     maxHeight={400000}
 *   />
 * </World>
 *
 * @group Components
 */
export const GeoPolygons = <P,>({
  data,
  style = DEFAULT_STYLE,
  height = 0,
  strokeWidth = 1.5,
  opacity = 1,
  lift = 0.5,
  liftPerDistance = 0.001,
  texelPixels = 2,
  fallbackPixels,
  minDepth = 0,
  transition = 300,
  maxDepth = 18,
  frame,
  renderOrder = 999,
  visible = true,
  minHeight,
  maxHeight,
  fade,
}: GeoPolygonsProps<P>) => {
  const gl = useThree(state => state.gl);
  const placed = useLayerGlobe(frame);
  const globe = placed?.globe ?? null;
  const features = useGeoFeatures(data);

  const slots = useMemo(() => {
    const context = gl.getContext() as WebGL2RenderingContext;
    return Math.min(
      OVERLAY_MAX_SLOTS,
      context.getParameter(context.MAX_ARRAY_TEXTURE_LAYERS) as number,
    );
  }, [gl]);
  const textures = useMemo(() => new OverlayTileTextures(slots), [slots]);
  useEffect(() => () => textures.dispose(), [textures]);
  const geometry = useMemo(() => createOverlayPatch(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Each feature's id is its place among the features: its styles are found by it.
  const index = useMemo(
    () =>
      new OverlayFeatureIndex(
        features,
        features.map((_, k) => k),
      ),
    [features],
  );
  const styles = useMemo(() => new OverlayStyles(), []);
  useEffect(() => () => styles.dispose(), [styles]);
  const styleKey = typeof style === 'function' ? style : JSON.stringify(style);
  const styleTexture = useMemo(
    () =>
      styles.set(features.length, id => {
        const given = typeof style === 'function' ? style(features[id]) : style;
        color.set(given.fill ?? '#ffb000');
        strokeColor.set(given.stroke ?? given.fill ?? '#ffb000');
        return {
          fill: color.clone(),
          fillOpacity: given.fillOpacity ?? 0.35,
          stroke: strokeColor.clone(),
          strokeOpacity: given.strokeOpacity ?? 1,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by the style's content
    [styles, features, styleKey],
  );

  const material = useMemo(
    () => (globe ? createOverlayMaterial(globe, textures, styleTexture) : null),
    // The style's texture is set below; a new one does not need a new material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [globe, textures],
  );
  useEffect(() => () => material?.dispose(), [material]);
  useEffect(() => {
    if (!material) return;
    const u = material.uniforms;
    u.uOverlayStyles.value = styleTexture;
    u.uOverlayHeight.value = height;
    (u.uOverlayLift.value as Vector2).set(lift, liftPerDistance);
    u.uOverlayStrokeWidth.value = strokeWidth;
  }, [material, styleTexture, height, lift, liftPerDistance, strokeWidth]);

  // Tiles from the generator where it is registered; on this thread if not.
  const generate = useGenerator<OverlayTile>(overlayTile);
  const streaming = useMemo(() => {
    const slotOf = new Map<number, number>();
    // Tiles come in or go: what was chosen last is stale.
    const resident = { changes: 0 };
    let worker = true;
    const streamer = new TileStreamer<OverlayTile>(
      {
        load: async key => {
          const shapes = index.shapes(key);
          if (worker) {
            try {
              const tile = await generate(shapes, key, OVERLAY_TILE_SIZE);
              if (tile) return tile;
            } catch {
              // Not registered: build them here from now on.
            }
            worker = false;
          }
          return buildOverlayTile(shapes, key, OVERLAY_TILE_SIZE);
        },
        bytes: tile => Math.max(tile.data.byteLength, 64),
      },
      {
        budget: Math.floor(slots * 0.9) * TILE_BYTES,
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
  }, [generate, index, textures, slots]);
  useEffect(() => () => streaming.streamer.dispose(), [streaming]);

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
    const bounds = new OverlayTileBounds();
    return {
      frustum,
      matrix: new Matrix4(),
      layout,
      bounds,
      // Only where there are polygons; by the tiles' own bounds, kept between frames.
      tiles: {
        ...tiles,
        distance: (key: number) => bounds.distance(key, layout.eye),
        shows: (key: number) =>
          index.over(key).length > 0 &&
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
    };
  }, [globe, index]);
  const visibility = useRef<LayerVisibility>({});
  visibility.current = { visible, minHeight, maxHeight, fade };
  const tiles = geometry.getAttribute(
    'overlayTile',
  ) as InstancedBufferAttribute;
  const chis = geometry.getAttribute(
    'overlayTileChi',
  ) as InstancedBufferAttribute;
  const froms = geometry.getAttribute(
    'overlayFrom',
  ) as InstancedBufferAttribute;

  useFrame(({ camera, size, viewport }) => {
    if (!mesh.current || !material) return;
    const transitions = view.transitions;
    const hide = () => {
      geometry.instanceCount = 0;
      mesh.current!.visible = false;
      view.chosen.key = '';
      // Shown again, it fades in again.
      transitions.clear();
    };
    // Placed by latitude and longitude: nothing without the map the scene is in.
    if (!globe || !globe.frame || index.count === 0) return hide();
    const altitude = globe.altitude(camera.position);
    const shown = layerVisibilityAt(altitude, visibility.current) * opacity;
    if (shown <= 0) return hide();
    material.uniforms.uOverlayOpacity.value = shown;
    transitions.duration = transition;

    const level = placed!.level;
    const y = level + height;
    view.matrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    // Nothing moved, nothing came in or went: the tiles chosen last time stand. A view held
    // still costs nothing, once the swaps' blends are done.
    const { streamer, slotOf, resident } = streaming;
    const e = view.matrix.elements;
    const chosenKey = `${e.join(',')}|${size.width}x${size.height}x${viewport.dpr}|${resident.changes}|${y}|${texelPixels}|${fallbackPixels}|${minDepth}|${maxDepth}|${globe.discCentre.x},${globe.discCentre.z},${globe.radius},${globe.enabled}`;
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
              Math.sqrt(2 * globe.radius * Math.max(height, 0)),
          )
        : far;

      view.bounds.prepare(globe, height);
      const perUnit = pixelsPerUnit(camera, size.height * viewport.dpr);
      const coarsest = fallbackPixels ?? 4 * texelPixels;
      // Too coarse to draw: shallower than `minDepth`, or its texels wider on screen than
      // `fallbackPixels`. Such a tile is never waited for: it is passed through as if in,
      // so the choice goes straight to the detail the view needs.
      const tooCoarse = (key: number) =>
        tileAddress(key)[0] < minDepth ||
        (geoTileWidth(globe, key) / OVERLAY_TILE_SIZE) *
          perUnit(view.bounds.distance(key, camera.position)) >
          coarsest;
      const selection = selectQuadtreeTiles({
        eye: [0, y, 0],
        reach: layout.seen,
        pixelsPerUnit: perUnit,
        pixelError: 1,
        cellPixels: { cells: OVERLAY_TILE_SIZE, pixels: texelPixels },
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
      // when it would only blur them; a tile with no edge on it (wholly inside a polygon) is
      // the same at any detail. What is drawn already stays until replaced (TileTransitions).
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
    const drawn = transitions.update(view.chosen.targets, performance.now(), {
      isIn,
      drawable: key => isIn(key) && view.chosen.drawable.has(key),
      isBlank: key => {
        if (index.over(key).length === 0) return true;
        return !!streamer.get(key)?.empty;
      },
    });
    streamer.update(
      transitions.keep.length
        ? [...view.chosen.used, ...transitions.keep]
        : view.chosen.used,
      view.chosen.want,
    );

    const array = tiles.array as Float32Array;
    const chiArray = chis.array as Float32Array;
    const fromArray = froms.array as Float32Array;
    let count = 0;
    for (const { key, from, blend } of drawn) {
      if (count >= OVERLAY_MAX_TILES) break;
      const slot = slotOf.get(key);
      if (slot === undefined || slot < 0) continue;
      geoTileOffsets(globe, key, array, 4 * count, chiArray, 3 * count);
      array[4 * count + 2] = blend;
      array[4 * count + 3] = slot;
      const fromSlot = from === null ? -1 : (slotOf.get(from) ?? -1);
      if (fromSlot >= 0) {
        fromArray.set(tileOffsetIn(key, from!), 4 * count);
        fromArray[4 * count + 3] = fromSlot;
      } else {
        fromArray.set(NO_SOURCE, 4 * count);
      }
      count++;
    }
    geometry.instanceCount = count;
    mesh.current.visible = count > 0;
    if (count === 0) return;
    for (const [attribute, itemSize] of [
      [tiles, 4],
      [chis, 3],
      [froms, 4],
    ] as const) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, itemSize * count);
      attribute.needsUpdate = true;
    }
  });

  if (!material) return null;
  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={renderOrder}
      layers={LAYERS_OVERLAY}
      visible={false}
    />
  );
};
