import { Color, type ColorRepresentation } from 'three';
import {
  GRATICULE_MIN_SPACING,
  type GraticuleKind,
  type GraticuleStyle,
} from '../../sdk/materials/graticule';
import type { LabelStyle } from '../Labels/types';

/** How one kind of a {@link GeoGraticuleOptions}' lines is drawn. */
export type GraticuleLines = {
  /** Default `#ffffff` */
  color?: ColorRepresentation;
  /** width in screen pixels, at any distance. Default 1.5 */
  thickness?: number;
  /** from 0 (none) to 1. Default 0.8 */
  opacity?: number;
};

/** The lines of latitude and longitude of a {@link GeoGraticuleOptions}. */
export type GraticuleLatLon = GraticuleLines & {
  /**
   * degrees between lines, along both; left out, it follows how far the view is zoomed: the
   * finest of 30°, 10°, 5°, 1°, 30′, 10′, 5′ and 1′ whose lines lie `minSpacing` pixels
   * apart on the ground the view is centred on, the same for meridians and parallels
   * everywhere on screen
   */
  interval?: number;
  /**
   * following the zoom, how far apart its lines are at the least where the view is
   * centred, in pixels: the next finer step fades in over the halving before. Default 120
   */
  minSpacing?: number;
};

/**
 * Latitude and longitude's labels: their names, `60°30′N`, `2°E`, painted flat on the sea's
 * level along the lines, around where the view is centred (a `LabelLayer`): every line
 * named, each name once every few cells along its line (`density`), staggered so a
 * parallel's name never meets a meridian's, and the meridians' thinned toward the poles,
 * where they close in. They follow the lines' step: as large as a fraction of a cell's
 * narrower side (east–west, shrinking with the latitude), so they keep their size on screen
 * as the step does and fit between each other; they come and go with the lines but never
 * slide. Never faded for being seen at a slant, only when too small on screen
 * (`minPixels`); always centred on their places. Over the highest ground of the relief
 * under them, or the sea's level, lifted over the waves. Their look as a label layer's (`LabelStyle`): its defaults, a thin crisp
 * halo, turned to read left to right (`GRATICULE_LABEL_STYLE`), in the lines' colour.
 */
export type GraticuleLabels = Partial<
  Pick<
    LabelStyle,
    | 'color'
    | 'haloColor'
    | 'haloWidth'
    | 'fontFamily'
    | 'fontWeight'
    | 'fontStyle'
    | 'letterSpacing'
    | 'opacity'
    | 'minPixels'
    | 'fadePixels'
    | 'maxPixels'
    | 'flip'
    | 'minFacing'
    | 'fadeFacing'
    | 'depthTest'
    | 'lift'
  >
> & {
  /** the font's size, as a fraction of a cell's narrower side on the ground. Default 0.18 */
  size?: number;
  /**
   * how much they are wanted where labels meet on screen (`LabelLayer`'s `priority`): below
   * data labels', above the zones'. Default -1
   */
  priority?: number;
  /** how many lines either way from where the view is centred are looked at, at least (a period of the names, at least). Default 10 */
  reach?: number;
  /**
   * how densely the lines are named, 0.1 to 1: at 1 a line's name comes every 4 cells along
   * it, at 0.5 every 8, at 0.1 every 40 (`graticuleLabelPeriod`). Default 0.5
   */
  density?: number;
  /**
   * how their size follows the zoom: `'stepped'`, by the step the lines are seen at, fixed
   * between changes of step, so they stay glued; `'smooth'`, by the lines' spacing as the
   * finer step fades in, so they scale with the cells as the view moves and never jump
   * (up to `GRATICULE_LABEL_SMOOTH_MAX` times the stepped size). Both are placed by the
   * step the lines are seen at. Default 'stepped'
   */
  sizing?: 'stepped' | 'smooth';
};

/**
 * The UTM zones' or the nautical time zones' names: one in the middle of each cell, painted
 * flat on the sea's level reading east — UTM zones as their projections are named, `32N`,
 * `23S`, the time zones by their offset, `UTC+1`, `UTC−3`, `UTC±0` — repeated in each
 * latitude band (every 8° from 80°S, the last 12° to 84°N), so a zone is named wherever
 * along it the view is. Each as large as a fraction of its cell's narrower side, so it fits
 * at any latitude, capped on screen as latitude and longitude's are (`maxPixels`). Their
 * look as those's (`GRATICULE_LABEL_STYLE`), in their lines' colour.
 */
export type GraticuleZoneLabels = Partial<
  Pick<
    LabelStyle,
    | 'color'
    | 'haloColor'
    | 'haloWidth'
    | 'fontFamily'
    | 'fontWeight'
    | 'fontStyle'
    | 'letterSpacing'
    | 'opacity'
    | 'minPixels'
    | 'fadePixels'
    | 'maxPixels'
    | 'flip'
    | 'minFacing'
    | 'fadeFacing'
    | 'depthTest'
    | 'lift'
    | 'liftPerDistance'
  >
> & {
  /** the font's size, as a fraction of its cell's narrower side on the ground. Default 0.18 */
  size?: number;
  /**
   * how much they are wanted where labels meet on screen (`LabelLayer`'s `priority`): below
   * latitude and longitude's. Default -2
   */
  priority?: number;
};

/**
 * The names a `GeoGraticule` writes on the Earth, per kind of its lines: `true` for a kind's
 * defaults, its own look, or `false` or left out for none. Only a kind drawn is named.
 */
export type GeoGraticuleLabels = {
  /** each parallel's and meridian's name on the sea along it (see {@link GraticuleLabels}) */
  latLon?: boolean | GraticuleLabels;
  /** each UTM zone's name in its cells (see {@link GraticuleZoneLabels}) */
  utm?: boolean | GraticuleZoneLabels;
  /** each time zone's offset in its cells (see {@link GraticuleZoneLabels}) */
  timeZones?: boolean | GraticuleZoneLabels;
};

/**
 * Which lines a `GeoGraticule` draws, and which it names: each kind on with `true` (its
 * defaults) or its own look, off with `false` or left out.
 */
export type GeoGraticuleOptions = {
  /** latitude and longitude. Default true */
  latLon?: boolean | GraticuleLatLon;
  /**
   * the UTM zones: their meridians every 6° from 80°S to 84°N, Norway's (32V) and
   * Svalbard's (31X–37X) included, and their latitude bands' parallels. Default false
   */
  utm?: boolean | GraticuleLines;
  /** the nautical time zones: meridians 15° apart either side of Greenwich, and the date line at 180°. Default false */
  timeZones?: boolean | GraticuleLines;
  /**
   * their names: `true` names every kind drawn — latitude and longitude's lines, the UTM
   * zones and the time zones — or per kind (see {@link GeoGraticuleLabels}), each in its
   * lines' colour unless given its own. Default none
   */
  labels?: boolean | GeoGraticuleLabels;
};

/** A `GeoGraticule`'s look where its options leave it out. */
export const GRATICULE_DEFAULTS = {
  lines: { color: '#ffffff', thickness: 1.5, opacity: 0.8 },
  minSpacing: GRATICULE_MIN_SPACING,
  latLon: true,
  utm: false,
  timeZones: false,
} as const;

/** Each kind's style from `options`, its defaults filled in: null where it is off. */
export function graticuleStyles(
  options: GeoGraticuleOptions,
): Record<GraticuleKind, GraticuleStyle | null> {
  const { lines, minSpacing } = GRATICULE_DEFAULTS;
  const style = (kind: GraticuleKind): GraticuleStyle | null => {
    const value = options[kind] ?? GRATICULE_DEFAULTS[kind];
    if (!value) return null;
    const own: GraticuleLatLon = value === true ? {} : value;
    return {
      color: own.color ?? lines.color,
      thickness: own.thickness ?? lines.thickness,
      opacity: own.opacity ?? lines.opacity,
      interval: own.interval,
      minSpacing: own.minSpacing ?? minSpacing,
    };
  };
  return {
    latLon: style('latLon'),
    utm: style('utm'),
    timeZones: style('timeZones'),
  };
}

// A kind's names asked for in `options`, if the kind is drawn: in its lines' colour unless
// given their own; null for none.
function labelsOf<T extends { color?: LabelStyle['color'] }>(
  options: GeoGraticuleOptions,
  kind: GraticuleKind,
): T | null {
  const lines = options[kind] ?? GRATICULE_DEFAULTS[kind];
  const all = options.labels;
  const asked = typeof all === 'object' ? all[kind] : all;
  if (!lines || !asked) return null;
  const labels = (asked === true ? {} : asked) as T;
  const lineColor =
    (lines === true ? undefined : lines.color) ??
    GRATICULE_DEFAULTS.lines.color;
  return {
    ...labels,
    color: labels.color ?? `#${new Color(lineColor).getHexString()}`,
  };
}

/** Latitude and longitude's labels from `options`: off unless asked for, and drawn. */
export function graticuleLatLonLabels(
  options: GeoGraticuleOptions,
): GraticuleLabels | null {
  return labelsOf<GraticuleLabels>(options, 'latLon');
}

/** The UTM zones' or time zones' names from `options`: off unless asked for, and drawn. */
export function graticuleZoneLabelsOf(
  options: GeoGraticuleOptions,
  kind: 'utm' | 'timeZones',
): GraticuleZoneLabels | null {
  return labelsOf<GraticuleZoneLabels>(options, kind);
}
