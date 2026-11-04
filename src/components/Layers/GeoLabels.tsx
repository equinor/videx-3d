import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Vector3 } from 'three';
import {
  polygonLabelPlaces,
  polygonLabelPoint,
} from '../../sdk/geometries/polygon-label';
import { simplifyRing } from '../../sdk/geometries/polygon-outline';
import type {
  PlanarLineCoordinates,
  PlanarPointCoordinates,
  PlanarPolygonCoordinates,
} from '../../sdk/geometries/planar-geometry';
import type {
  GeoFeature,
  GeoJsonFeatureCollection,
} from '../../sdk/layers/geo-features';
import type { LayerVisibility } from '../../sdk/layers/layer-visibility';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import type { Globe } from '../../sdk/projection/globe';
import type { Vec2 } from '../../sdk/types/common';
import { LabelLayer } from '../Labels/LabelLayer';
import { labelReachEstimate } from '../Labels/label-geometry';
import { labelTextVariants, type LabelTextStyle } from '../Labels/label-text';
import {
  resolveLabelStyle,
  type Label,
  type LabelPlace,
  type LabelSizePreset,
  type LabelStyle,
} from '../Labels/types';
import { useSceneryOcean } from '../Scenery/scenery-context';
import { layerShownAt, useGeoFeatures, useLayerGlobe } from './layer-globe';
import { useReliefCeiling } from './relief-ceiling';

const DEG = Math.PI / 180;
const EARTH_RADIUS = 6371000;

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

/** The share of a polygon's room its label may fill, each way: so it keeps clear of its edge. */
export const GEO_LABEL_PADDING = 0.85;

// How much larger a polygon's label must be broken into more lines for `size` 'fit' to
// break it: text reads best in few lines.
const LINE_GAIN = 1.15;

// A place's room made this much larger: a label sized to just fit it fits, rounding aside.
const ROOM_SLACK = 1.001;

/** The largest a `GeoLabels` label sized in metres is drawn on screen, CSS pixels, by default. */
export const GEO_LABEL_MAX_PIXELS = 18;

// Milliseconds of polygon fitting a turn, between frames.
const FIT_BUDGET = 4;

/**
 * A place inside a polygon for its label (see {@link geoPolygonLabelPlaces}): its text
 * there, broken into lines; its middle, in longitude and latitude; the way it reads, in
 * radians from east toward north; its room, in metres along and across that way (padded,
 * {@link GEO_LABEL_PADDING}); and the largest its font may be to fit it, in metres.
 *
 * @group Layers
 */
export type GeoLabelPlace = {
  text: string;
  at: Vec2;
  angle: number;
  width: number;
  height: number;
  size: number;
};

/**
 * Where a polygon's label goes in each way `text` breaks into lines, up to `maxLines`
 * (`labelTextVariants`, measured in `style`'s font), fewest lines first: the largest
 * rectangle of that shape inside it (`polygonLabelPlaces`: reading level, or with `turn`
 * along a long polygon's main axis), worked out in metres about its middle on its rings
 * simplified to a fiftieth of their size. A way whose text can be no larger than in
 * fewer lines is left out: it would never be drawn. Empty for a polygon without area, or
 * a feature of another kind.
 *
 * @group Layers
 */
export function geoPolygonLabelPlaces(
  feature: GeoFeature<unknown>,
  text: string,
  style: LabelTextStyle,
  maxLines = 3,
  turn = true,
): GeoLabelPlace[] {
  const { geometry } = feature;
  if (geometry.type !== 'polygon2d') return [];
  const [lon0, lat0] = geometry.center;
  const k = Math.cos(lat0 * DEG);
  const toMetres = ([lon, lat]: Vec2): Vec2 => [
    (lon - lon0) * DEG * EARTH_RADIUS * k,
    (lat - lat0) * DEG * EARTH_RADIUS,
  ];
  const polygon = (geometry.coordinates as PlanarPolygonCoordinates).map(
    part => {
      const rings = part.map(ring => ring.map(toMetres));
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of rings[0] ?? []) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      const tolerance = Math.max(maxX - minX, maxY - minY) / 50;
      return tolerance > 0
        ? rings.map(ring => simplifyRing(ring, tolerance))
        : rings;
    },
  );
  const variants = labelTextVariants(text, style, maxLines);
  const rects = polygonLabelPlaces(
    polygon,
    variants.map(v => ({ width: v.inkWidth, height: v.inkHeight })),
    turn,
  );
  const places: GeoLabelPlace[] = [];
  rects.forEach((rect, i) => {
    if (!rect) return;
    const variant = variants[i];
    const width = rect.width * GEO_LABEL_PADDING;
    const height = rect.height * GEO_LABEL_PADDING;
    const size = Math.min(width / variant.inkWidth, height / variant.inkHeight);
    // No larger than in fewer lines: never drawn, as that one fits first.
    if (places.length && size <= places[places.length - 1].size) return;
    const [x, y] = rect.centre;
    places.push({
      text: variant.text,
      at: [
        lon0 + x / (DEG * EARTH_RADIUS * k),
        lat0 + y / (DEG * EARTH_RADIUS),
      ],
      angle: rect.angle,
      width,
      height,
      size,
    });
  });
  return places;
}

/**
 * GeoLabels props
 * @expand
 */
export type GeoLabelsProps<P = Record<string, unknown>> = LayerVisibility &
  Partial<
    Omit<LabelStyle, 'size' | 'maxDistance' | 'fadeDistance' | 'maxPixels'>
  > & {
    /** the features, in longitude and latitude: GeoJSON, or features read from it */
    data: GeoJsonFeatureCollection<P> | GeoFeature<P>[] | null;
    /** each feature's text; null or empty for none. Keep it stable (`useCallback`) */
    text: (feature: GeoFeature<P>) => string | null | undefined;
    /**
     * the text's size. Drawn `sizing` `'world'` (the default), in metres: a number for all,
     * or `'fit'` (default) to fit each polygon's in it once, as large as it fits between
     * `minSize` and `maxSize`, broken into lines where that makes it larger. On screen (a
     * preset, or `sizing` `'screen'` or `'auto'`), CSS pixels or a preset (`'fit'` is then
     * `'small'`). Except with `'fit'`, a polygon's label is broken into the fewest lines that
     * fit it at the size it is drawn, and shrunk where none do, again as the view zooms
     */
    size?: number | 'fit' | LabelSizePreset;
    /** with `size` `'fit'`, metres. Default 150 */
    minSize?: number;
    /** with `size` `'fit'`, metres; also a point's or a line's. Default 3000 */
    maxSize?: number;
    /**
     * metres over the sea's level, as the layer it labels (`GeoPolygons`' `height`): or over
     * the highest ground of the relief under a label, where that is higher. Default 0
     */
    height?: number;
    /**
     * farther from the camera than this, in metres, a label is not drawn; the layer is not
     * drawn at all once all of them are (or are too small to read, `minPixels`). Default
     * 150000
     */
    maxDistance?: number;
    /** over how far it fades out toward `maxDistance`. Default a tenth of it */
    fadeDistance?: number;
    /** where the scene lies on the Earth, without a `World` or `Scenery` to say */
    frame?: GeoFrame;
    /**
     * how much its labels are wanted where labels meet on screen (`LabelLayer`'s
     * `priority`): over the graticule's names (below 0) by default. Default 0
     */
    priority?: number;
    /**
     * a polygon's label turned along it where it is long and narrow and that gives its label
     * far more room (`polygonLabelPlaces`). Default true
     */
    turn?: boolean;
    /**
     * the largest a label is drawn on screen, its font's size face-on in CSS pixels: nearer,
     * it is held at this rather than growing, and broken into fewer lines where its polygon
     * then has room. Default 18 sized in metres ({@link GEO_LABEL_MAX_PIXELS}: no larger
     * than reads clearly), none sized on screen (its `size` is already)
     */
    maxPixels?: number;
  };

const here = new Vector3();
const east = new Vector3();
const north = new Vector3();
const up = new Vector3();

// Where a feature's label may go, in longitude and latitude, and its size: one place, or
// a polygon's places, each with its room in metres.
type GeoLabelAnchor = {
  id: string;
  size: number;
  places: {
    text: string;
    at: Vec2;
    angle: number;
    room?: [number, number];
    reach: number;
  }[];
};

const NO_PLACES: ReadonlyMap<object, GeoLabelPlace[]> = new Map();

/**
 * Labels for geographic features — a polygon's name lying flat inside it, say — glued to
 * the world as `LabelLayer`'s are: painted where they lie, read from above, fading out as
 * they grow too small to read or turn edge-on, on the globe where their latitude and
 * longitude lie; placed again when the globe is.
 *
 * A polygon's name goes where it fits best: for each way of breaking it into lines (up to
 * `maxLines`), the largest rectangle of that shape inside the polygon, reading east or —
 * with `turn`, where the polygon is long and narrow — along it (`geoPolygonLabelPlaces`).
 * Sized `'fit'` (the default), each is as large as it fits, between `minSize` and
 * `maxSize`, but never larger on screen than reads clearly (`maxPixels`, 18): nearer, it is
 * held at that, in fewer lines where there is room. Sized on screen (a preset, or `sizing`
 * `'screen'` or `'auto'`) or in fixed
 * metres, it is broken into the fewest lines that fit the polygon at the size it is drawn,
 * and shrunk where none do — fading out once too small to read — again as the view zooms.
 * Polygons are fitted a few at a time between frames, so thousands cost no frame more than
 * a few milliseconds; their labels come in as they are.
 *
 * For what moves, use an `Annotations` layer. Where labels crowd, they are kept apart on
 * screen, with every label layer's in the scene (`priority`, over the graticule's names by
 * default); those too small to read fade out (`minPixels`).
 *
 * Each lies at `height`, or over the highest ground of the relief under it where that is
 * higher (`useReliefCeiling`: the relief would bury it), placed again as the relief's tiles
 * come in; depth tested, so ground between it and the camera hides it, and lifted 5 m, and
 * 1 m more each kilometre off, over the waves near the field and clear of the sea far off.
 * As a `LabelLayer`'s, they turn to read left to right whichever way the camera looks
 * (`flip`). Those past the globe's horizon face away, and are not drawn; so are those
 * farther than `maxDistance` (150 km), and the whole layer while the camera is in the ground
 * under them (`layerShownAt`).
 *
 * See `documents/layers.md`.
 *
 * @example
 * <GeoLabels data={discoveries} text={f => f.properties.name} maxHeight={150000} />
 *
 * @example
 * // 12 pixels on screen, each name broken into lines and shrunk to fit its polygon
 * <GeoLabels data={licences} text={f => f.properties.name} size="small" />
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
  maxDistance = 150000,
  fadeDistance,
  frame,
  visible = true,
  minHeight,
  maxHeight,
  fade,
  priority = 0,
  lift = 5,
  liftPerDistance = 1e-3,
  sizing = 'world',
  maxLines = 3,
  turn = true,
  maxPixels,
  ...style
}: GeoLabelsProps<P>) => {
  const placed = useLayerGlobe(frame);
  const globe = placed?.globe ?? null;
  const ocean = useSceneryOcean();
  const features = useGeoFeatures(data);
  const ceiling = useReliefCeiling();

  // Sized on screen: a preset, or sizing on screen; 'fit' is then the 'small' preset.
  const onScreen =
    sizing !== 'world' || (typeof size === 'string' && size !== 'fit');
  const layerSize: number | LabelSizePreset = onScreen
    ? size === 'fit'
      ? 'small'
      : size
    : 1;
  // The font its texts are measured in, as drawn: by value, so an inline style sets
  // nothing again.
  const drawn = resolveLabelStyle({ ...style, size: layerSize, sizing });
  const textStyleKey = JSON.stringify({
    fontFamily: drawn.fontFamily,
    fontWeight: drawn.fontWeight,
    fontStyle: drawn.fontStyle,
    letterSpacing: drawn.letterSpacing,
    haloWidth: drawn.haloWidth,
    align: drawn.align,
  });
  const textStyle = useMemo(
    () => JSON.parse(textStyleKey) as LabelTextStyle,
    [textStyleKey],
  );

  // The polygons' places, fitted a few at a time between frames (FIT_BUDGET), handed on
  // as they come in (at most every 100 ms, and once done).
  const fitting = useMemo(
    () => ({
      features: features.filter(f => f.geometry.type === 'polygon2d'),
      next: 0,
      places: new Map<object, GeoLabelPlace[]>(),
      text,
      textStyle,
      maxLines,
      turn,
    }),
    [features, text, textStyle, maxLines, turn],
  );
  const [fitted, setFitted] = useState(NO_PLACES);
  useEffect(() => {
    const job = fitting;
    if (job.next >= job.features.length) {
      setFitted(job.places);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let handed = performance.now();
    const step = () => {
      const until = performance.now() + FIT_BUDGET;
      while (job.next < job.features.length && performance.now() < until) {
        const feature = job.features[job.next++];
        const label = job.text(feature);
        job.places.set(
          feature,
          label
            ? geoPolygonLabelPlaces(
                feature,
                label,
                job.textStyle,
                job.maxLines,
                job.turn,
              )
            : [],
        );
      }
      const done = job.next >= job.features.length;
      if (done || performance.now() - handed > 100) {
        handed = performance.now();
        setFitted(new Map(job.places));
      }
      if (!done) timer = setTimeout(step, 0);
    };
    step();
    return () => clearTimeout(timer);
  }, [fitting]);

  // Where each goes, in longitude and latitude, and its size: by the features alone.
  const anchors = useMemo(() => {
    const found: GeoLabelAnchor[] = [];
    for (const feature of features) {
      const label = text(feature);
      if (!label) continue;
      const id = `${label}@${feature.id}`;
      if (feature.geometry.type === 'polygon2d') {
        const places = fitted.get(feature);
        if (!places?.length) continue;
        let s = onScreen ? 1 : (size as number);
        let stretch = ROOM_SLACK;
        if (size === 'fit' && !onScreen) {
          // As large as it fits, in the fewest lines that make it so.
          let best = places[0];
          let largest = Math.min(best.size, maxSize);
          for (const place of places) {
            const fits = Math.min(place.size, maxSize);
            if (fits > largest * LINE_GAIN) {
              best = place;
              largest = fits;
            }
          }
          s = Math.min(Math.max(best.size, minSize), maxSize);
          // Larger than its room where `minSize` makes it so: every place's room as much
          // larger, so it is never shrunk below it.
          stretch *= Math.max(1, s / best.size);
        }
        // Every way it breaks into lines, each with its room: drawn in the first that
        // fits at the size it is drawn — sized to fit, the one chosen above, or, once
        // `maxPixels` holds it smaller, one in fewer lines.
        found.push({
          id,
          size: s,
          places: places.map(place => ({
            text: place.text,
            at: place.at,
            angle: place.angle,
            room: [place.width * stretch, place.height * stretch],
            reach: (Math.hypot(place.width, place.height) / 2) * stretch,
          })),
        });
        continue;
      }
      const point = geoFeatureLabelPoint(feature);
      if (!point) continue;
      const s = onScreen ? 1 : size === 'fit' ? maxSize : size;
      found.push({
        id: `${label}@${point.at[1]},${point.at[0]}`,
        size: s,
        places: [
          {
            text: label,
            at: point.at,
            angle: 0,
            reach: labelReachEstimate(label, onScreen ? maxSize : s),
          },
        ],
      });
    }
    return found;
  }, [features, text, fitted, size, minSize, maxSize, onScreen]);

  // Placed on the globe, again whenever the globe is (its location a new object), each at
  // `height` or over the highest ground under it, again as the relief's tiles come in; kept
  // by its feature and name whatever its height (`id`).
  const [placedAt, setPlacedAt] = useState<{
    globe: Globe | null;
    location: unknown;
  }>({ globe: null, location: null });
  const labels = useMemo<Label[]>(() => {
    const on = placedAt.globe;
    if (!on || !on.frame) return [];
    // A place on the globe: its middle, up there, and the way it reads.
    const onGlobe = ([lon, lat]: Vec2, angle: number, reach: number) => {
      const ground = ceiling?.around(lon, lat, reach);
      const lies = ground != null ? Math.max(height, ground) : height;
      on.geodetic(lat, lon, lies, here);
      on.upAt(here, up);
      on.geodetic(lat, lon + 1e-4, lies, east)
        .sub(here)
        .normalize();
      on.geodetic(lat + 1e-4, lon, lies, north)
        .sub(here)
        .normalize();
      east
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(north, Math.sin(angle))
        .normalize();
      return {
        position: here.toArray(),
        normal: up.toArray(),
        direction: east.toArray(),
      };
    };
    return anchors.map(({ id, size: s, places }) => {
      const [first] = places;
      const label: Label = {
        text: first.text,
        ...onGlobe(first.at, first.angle, first.reach),
        size: s,
        id,
      };
      if (places.length > 1 || first.room)
        label.places = places.map<LabelPlace>(place => ({
          text: place.text,
          ...onGlobe(place.at, place.angle, place.reach),
          bounds: place.room,
        }));
      return label;
    });
  }, [anchors, placedAt, height, ceiling]);

  const options = useRef<LayerVisibility>({});
  options.current = { visible, minHeight, maxHeight, fade };
  const [shown, setShown] = useState(false);
  useFrame(({ camera }) => {
    if (!globe) return;
    if (placedAt.globe !== globe || placedAt.location !== globe.location)
      setPlacedAt({ globe, location: globe.location });
    const on =
      layerShownAt(camera.position, globe, ocean, options.current, height) > 0;
    if (on !== shown) setShown(on);
  });

  return (
    <LabelLayer
      {...style}
      priority={priority}
      lift={lift}
      liftPerDistance={liftPerDistance}
      maxDistance={maxDistance}
      fadeDistance={fadeDistance ?? 0.1 * maxDistance}
      sizing={sizing}
      maxLines={maxLines}
      maxPixels={maxPixels ?? (onScreen ? Infinity : GEO_LABEL_MAX_PIXELS)}
      labels={labels}
      size={layerSize}
      visible={shown}
    />
  );
};
