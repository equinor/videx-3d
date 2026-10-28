import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import { Vector3 } from 'three';
import { polygonLabelPoint } from '../../sdk/geometries/polygon-label';
import type {
  PlanarLineCoordinates,
  PlanarPointCoordinates,
  PlanarPolygonCoordinates,
} from '../../sdk/geometries/planar-geometry';
import type {
  GeoFeature,
  GeoJsonFeatureCollection,
} from '../../sdk/layers/geo-features';
import {
  layerVisibilityAt,
  type LayerVisibility,
} from '../../sdk/layers/layer-visibility';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import type { Globe } from '../../sdk/projection/globe';
import type { Vec2 } from '../../sdk/types/common';
import { LabelLayer } from '../Labels/LabelLayer';
import type { Label, LabelStyle } from '../Labels/types';
import { useGeoFeatures, useLayerGlobe } from './layer-globe';

const DEG = Math.PI / 180;
const EARTH_RADIUS = 6371000;
// About how wide a character of a bold sans-serif font is, in ems.
const CHARACTER_WIDTH = 0.6;

/**
 * Where a feature's label goes, in longitude and latitude, and how much room it has there
 * (metres; Infinity for a point or a line): for a polygon the point inside it farthest
 * from its edge (`polygonLabelPoint`), for a line the middle point of its longest part,
 * for points the first. Null for a geometry with nothing to label.
 *
 * @group Layers
 */
export function geoFeatureLabelPoint(
  feature: GeoFeature<unknown>,
): { at: Vec2; room: number } | null {
  const { geometry } = feature;
  if (geometry.type === 'polygon2d') {
    // In metres about the feature's middle, where its shape is true to the ground.
    const [lon0, lat0] = geometry.center;
    const k = Math.cos(lat0 * DEG);
    const toMetres = ([lon, lat]: Vec2): Vec2 => [
      (lon - lon0) * DEG * EARTH_RADIUS * k,
      (lat - lat0) * DEG * EARTH_RADIUS,
    ];
    const polygon = (geometry.coordinates as PlanarPolygonCoordinates).map(
      part => part.map(ring => ring.map(toMetres)),
    );
    const found = polygonLabelPoint(polygon);
    if (!found) return null;
    const [x, y] = found.point;
    return {
      at: [
        lon0 + x / (DEG * EARTH_RADIUS * k),
        lat0 + y / (DEG * EARTH_RADIUS),
      ],
      room: found.distance,
    };
  }
  if (geometry.type === 'line2d') {
    const lines = geometry.coordinates as PlanarLineCoordinates;
    const longest = lines.reduce(
      (best, line) => (line.length > best.length ? line : best),
      lines[0] ?? [],
    );
    if (!longest.length) return null;
    return { at: longest[Math.floor(longest.length / 2)], room: Infinity };
  }
  const points = geometry.coordinates as PlanarPointCoordinates;
  return points.length ? { at: points[0], room: Infinity } : null;
}

/**
 * GeoLabels props
 * @expand
 */
export type GeoLabelsProps<P = Record<string, unknown>> = LayerVisibility &
  Partial<Omit<LabelStyle, 'size'>> & {
    /** the features, in longitude and latitude: GeoJSON, or features read from it */
    data: GeoJsonFeatureCollection<P> | GeoFeature<P>[] | null;
    /** each feature's text; null or empty for none. Keep it stable (`useCallback`) */
    text: (feature: GeoFeature<P>) => string | null | undefined;
    /**
     * the text's height in metres: a number for all, or `'fit'` (default) to fit each
     * polygon's label in the room it has there, between `minSize` and `maxSize`
     */
    size?: number | 'fit';
    /** with `size` `'fit'`, metres. Default 150 */
    minSize?: number;
    /** with `size` `'fit'`, metres; also a point's or a line's. Default 3000 */
    maxSize?: number;
    /** metres over the sea's level, as the layer it labels (`GeoPolygons`' `height`). Default 0 */
    height?: number;
    /** where the scene lies on the Earth, without a `World` or `Scenery` to say */
    frame?: GeoFrame;
  };

const here = new Vector3();
const east = new Vector3();
const up = new Vector3();

/**
 * Labels for geographic features — a polygon's name lying flat inside it, say — glued to
 * the world as `LabelLayer`'s are: painted where they lie, read from above, fading out as
 * they grow small on screen or turn edge-on. A polygon's goes where it has the most room
 * (`geoFeatureLabelPoint`), sized to fit it (`size` `'fit'`), on the globe where its latitude
 * and longitude lie, reading east; placed again when the globe is.
 *
 * For what moves, or wants its label to keep its size on screen, use an `Annotations` layer.
 * Labels are not kept apart: where polygons crowd, their labels may overlap; `minPixels`
 * (default 6) hides those too small to read.
 *
 * See `documents/layers.md`.
 *
 * @example
 * <GeoLabels data={discoveries} text={f => f.properties.name} maxHeight={150000} />
 *
 * @group Components
 */
export const GeoLabels = <P,>({
  data,
  text,
  size = 'fit',
  minSize = 150,
  maxSize = 3000,
  height = 0,
  frame,
  visible = true,
  minHeight,
  maxHeight,
  fade,
  ...style
}: GeoLabelsProps<P>) => {
  const placed = useLayerGlobe(frame);
  const globe = placed?.globe ?? null;
  const features = useGeoFeatures(data);

  // Where each goes, in longitude and latitude, and its size: by the features alone.
  const anchors = useMemo(() => {
    const found: { at: Vec2; text: string; size: number }[] = [];
    for (const feature of features) {
      const label = text(feature);
      if (!label) continue;
      const point = geoFeatureLabelPoint(feature);
      if (!point) continue;
      const fitted =
        size === 'fit'
          ? Math.min(
              Math.max(
                (2 * point.room) / (CHARACTER_WIDTH * label.length),
                minSize,
              ),
              maxSize,
            )
          : size;
      found.push({ at: point.at, text: label, size: fitted });
    }
    return found;
  }, [features, text, size, minSize, maxSize]);

  // Placed on the globe, again whenever the globe is (its location a new object).
  const [placedAt, setPlacedAt] = useState<{
    globe: Globe | null;
    location: unknown;
  }>({ globe: null, location: null });
  const labels = useMemo<Label[]>(() => {
    const on = placedAt.globe;
    if (!on || !on.frame) return [];
    return anchors.map(({ at: [lon, lat], text: label, size: s }) => {
      on.geodetic(lat, lon, height, here);
      on.upAt(here, up);
      on.geodetic(lat, lon + 1e-4, height, east)
        .sub(here)
        .normalize();
      return {
        text: label,
        position: here.toArray(),
        normal: up.toArray(),
        direction: east.toArray(),
        size: s,
      };
    });
  }, [anchors, placedAt, height]);

  const options = useRef<LayerVisibility>({});
  options.current = { visible, minHeight, maxHeight, fade };
  const [shown, setShown] = useState(false);
  useFrame(({ camera }) => {
    if (!globe) return;
    if (placedAt.globe !== globe || placedAt.location !== globe.location)
      setPlacedAt({ globe, location: globe.location });
    const on =
      layerVisibilityAt(globe.altitude(camera.position), options.current) > 0;
    if (on !== shown) setShown(on);
  });

  return <LabelLayer {...style} labels={labels} size={1} visible={shown} />;
};
