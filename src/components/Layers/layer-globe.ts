import { useMemo } from 'react';
import {
  geoFeaturesFromGeoJson,
  type GeoFeature,
  type GeoJsonFeatureCollection,
} from '../../sdk/layers/geo-features';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import { Globe } from '../../sdk/projection/globe';
import { useSceneryOcean } from '../Scenery/scenery-context';
import { useWorld } from '../World/world-context';

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
