import { useMemo } from 'react';
import type { Object3D, Vector3 } from 'three';
import { LAYERS } from '../../layers/layers';
import {
  geoFeaturesFromGeoJson,
  type GeoFeature,
  type GeoJsonFeatureCollection,
} from '../../sdk/layers/geo-features';
import {
  layerVisibilityAt,
  type LayerVisibility,
} from '../../sdk/layers/layer-visibility';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import { Globe } from '../../sdk/projection/globe';
import {
  useSceneryOcean,
  type SceneryOceanState,
} from '../Scenery/scenery-context';
import { sceneryLidOverCamera } from '../Scenery/scenery-model';
import { useWorld } from '../World/world-context';

/**
 * Where a geographic layer lies, for {@link layerShownAt}: on the ground (the relief a
 * `Scenery`'s stage draws), or at a height in metres over the sea.
 *
 * @group Layers
 */
export type LayerLies = 'ground' | number;

/**
 * How much of a geographic layer shows to a camera at `position` (0 to 1), the one test
 * every scene layer makes before it draws or does any work for the frame:
 *
 * - its band of camera heights over the sea (`layerVisibilityAt`);
 * - inside a `Scenery` with a sea, nothing while the camera is in the ground and the layer
 *   lies above it: the void's lid hides all above it (`sceneryLidOverCamera`), and where
 *   the lid leaves pixels to the background — toward the horizon, or to the void's walls —
 *   what is drawn above it would show through. On the ground (`lies` `'ground'`) is always
 *   above the lid; at a height, where that is the lid's height over the camera or more. A
 *   layer laid deeper than the ground, at a reservoir's depth say, is seen from the void.
 *
 * Zero means not drawn at all: a layer hides its mesh, and skips its frame's work.
 *
 * @group Layers
 */
export function layerShownAt(
  position: Vector3,
  globe: Globe,
  ocean: SceneryOceanState | null,
  visibility: LayerVisibility,
  lies: LayerLies,
): number {
  const altitude = globe.altitude(position);
  const shown = layerVisibilityAt(altitude, visibility);
  if (shown <= 0 || !ocean) return shown;
  const sky = ocean.material;
  const lid = sceneryLidOverCamera(sky.oceanLevel + altitude, sky);
  if (lid === null) return shown;
  return lies === 'ground' || sky.oceanLevel + lies >= lid ? 0 : shown;
}

/** The `renderOrder` of what is drawn over the sea without an `OITRenderPass`: after everything see-through. */
export const OVER_SEA_ORDER = 999;

/**
 * Draws a geographic layer's mesh over the sea while `over` — a layer revealed as a map
 * (`LayerReveal`): on `LAYERS.OVERLAY`, which an `OITRenderPass` draws after the
 * see-through layers, and at {@link OVER_SEA_ORDER} without one, after the sea's surface —
 * else at its own `renderOrder`. Its other layers are left as they are.
 *
 * @group Layers
 */
export function drawOverSea(
  object: Object3D,
  over: boolean,
  renderOrder: number,
) {
  if (over) object.layers.enable(LAYERS.OVERLAY);
  else object.layers.disable(LAYERS.OVERLAY);
  object.renderOrder = over ? OVER_SEA_ORDER : renderOrder;
}

/**
 * What a geographic layer is placed on: the globe — the enclosing `Scenery`'s, else the
 * enclosing `World`'s — and the sea's level; or, with neither, a globe of its own that does
 * not curve, laid on `frame` (default the `World`'s), its sea at Y 0. Null without any
 * frame: nothing tells where the scene lies on the Earth.
 *
 * @group Layers
 */
export function useLayerGlobe(frame?: GeoFrame): {
  globe: Globe;
  level: number;
} | null {
  const ocean = useSceneryOcean();
  const world = useWorld();
  const shared = ocean?.material.globe ?? world?.globe ?? null;
  const own = frame ?? world?.frame ?? null;
  const frameKey = own ? JSON.stringify(own) : '';
  const flat = useMemo(() => {
    if (shared || !frameKey) return null;
    const globe = new Globe();
    globe.enabled = false;
    globe.setFrame(JSON.parse(frameKey) as GeoFrame);
    return globe;
  }, [shared, frameKey]);
  return useMemo(() => {
    if (shared) return { globe: shared, level: ocean?.level ?? shared.level };
    if (flat) return { globe: flat, level: 0 };
    return null;
  }, [shared, flat, ocean?.level]);
}

/**
 * A layer's data as {@link GeoFeature}s: GeoJSON read once per collection, features as
 * they are.
 *
 * @group Layers
 */
export function useGeoFeatures<P>(
  data: GeoJsonFeatureCollection<P> | GeoFeature<P>[] | null | undefined,
): GeoFeature<P>[] {
  return useMemo(() => {
    if (!data) return [];
    return Array.isArray(data) ? data : geoFeaturesFromGeoJson(data);
  }, [data]);
}
