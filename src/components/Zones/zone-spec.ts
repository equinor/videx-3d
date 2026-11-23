import {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  SurfaceMeta,
  Vec3,
} from '../../sdk';
import { ReliefSource } from '../../sdk/geometries/relief-tiles';
import { StackCarrier } from '../../sdk/geometries/surface-stack';
import {
  ZoneCarrier,
  ZoneLayer,
  zoneLayerFill,
  ZoneResolveOptions,
  DEFAULT_WATER_RESOLUTION,
  ZoneStackWater,
  StackWaterSpec,
  SurfaceZoneCut,
  SurfaceZoneLayerSpec,
  SurfaceZoneSpec,
  SurfaceZoneSpecLayer,
  SurfaceZoneStackSpec,
  WellboreOutlineSpec,
} from './zone-defs';
import type { WellboreCutoutOptions } from './cutout';
import { SeamDecision } from './seams';

/** UTM -> scene-frame mapping (matches `UtmArea`'s `utmToArea`). */
type UtmToArea = (easting: number, northing: number, altitude?: number) => Vec3;

/**
 * The relief a column's sea bed is built on (see `ZoneStackProps.relief`): the source,
 * and the id of the surface it stands in for.
 */
export type ColumnRelief = { source: ReliefSource; seabed: string };

/** Build parameters carried into a {@link SurfaceZoneSpec}. */
export type BuildSurfaceZoneSpecOptions = {
  rimSpacing?: number;
  maxError?: number;
  resolve?: ZoneResolveOptions;
  /**
   * The column this zone is cut from (see `ZoneStack.surfaces`) plus the
   * envelope footprint it is resolved over. Both are needed for the shared build.
   * With `relief`, the column's sea bed is built on it.
   */
  stack?: {
    surfaces: SurfaceMeta[];
    envelope: PlanarPolygonGeometry;
    relief?: ColumnRelief | null;
  };
  /**
   * The flat floor the column terminates against (see `ZoneStackProps.carrier`).
   * Without it, a fill on the zone's last layer has nothing to close it and is
   * ignored, exactly as it was before there was a carrier at all.
   */
  carrier?: ZoneCarrier;
  /** the column's sea, for the zone drawing its bed (see `SurfaceZoneSpec.sea`) */
  sea?: { bed: string; depth: number } | null;
  /**
   * Boundary of the zone drawn directly above this one (see
   * `SurfaceZoneSpec.coverAbove`).
   */
  coverAbove?: PlanarPolygonGeometry | null;
  /**
   * Per layer, what this zone draws of a horizon it shares with a neighbour (see
   * `resolveSeam`). Omit for a zone that shares nothing.
   */
  seams?: (SeamDecision | null)[];
  /**
   * The same, for the column's floor — separate because the carrier layer is
   * INFERRED here rather than declared, so it has no index in `seams`.
   */
  carrierSeam?: SeamDecision | null;
  /** ask the build for the section channels (see `SurfaceZoneSpec.section`) */
  section?: boolean;
  /** ask the build for the peel indices (see `SurfaceZoneSpec.peelable`) */
  peelable?: boolean;
  /** see `SurfaceZoneSpec.diagnostics` */
  diagnostics?: boolean;
  /** see `SurfaceZoneSpec.preview` */
  preview?: boolean;
};

/** Map one surface's meta into the serializable layer spec. */
function toLayerSpec(
  meta: SurfaceMeta,
  utmToArea: UtmToArea,
): SurfaceZoneLayerSpec {
  const p = utmToArea(meta.header.xori, meta.header.yori, 0);
  return {
    id: meta.id,
    header: {
      nx: meta.header.nx,
      ny: meta.header.ny,
      xinc: meta.header.xinc,
      yinc: meta.header.yinc,
      rot: meta.header.rot,
    },
    referenceDepth: meta.max,
    worldPosition: [p[0], p[2]],
  };
}

/**
 * One depth interval of a wellbore outline and the margin its trajectory is
 * buffered with. A `null` bound leaves that side unbounded (wellhead above, TD
 * below).
 */
export type WellboreOutlineInterval = {
  top: SurfaceMeta | null;
  base: SurfaceMeta | null;
  radius: number;
};

/**
 * The `wellboreOutline` generator's spec. `onMetrics` is left out — the caller
 * applies it to the metrics the generator returns.
 */
export function buildWellboreOutlineSpec(
  wellbores: string[],
  options: WellboreCutoutOptions | undefined,
  intervals: WellboreOutlineInterval[],
  utmToArea: UtmToArea,
): WellboreOutlineSpec {
  const surfaces: SurfaceZoneLayerSpec[] = [];
  const indexOf = new Map<string, number>();
  const at = (meta: SurfaceMeta | null) => {
    if (!meta) return null;
    let index = indexOf.get(meta.id);
    if (index === undefined) {
      index = surfaces.push(toLayerSpec(meta, utmToArea)) - 1;
      indexOf.set(meta.id, index);
    }
    return index;
  };
  const cutOptions = { ...options };
  delete cutOptions.onMetrics;
  return {
    wellbores,
    surfaces,
    intervals: intervals.map(({ top, base, radius }) => ({
      top: at(top),
      base: at(base),
      radius,
    })),
    utmToScene: utmAffine(utmToArea),
    options: cutOptions,
  };
}

// `UtmArea` maps by a translation and a flip, so four samples reproduce it exactly.
function utmAffine(utmToArea: UtmToArea): number[] {
  const o = utmToArea(0, 0, 0);
  const e = utmToArea(1, 0, 0);
  const n = utmToArea(0, 1, 0);
  const a = utmToArea(0, 0, 1);
  return [0, 1, 2].flatMap(k => [e[k] - o[k], n[k] - o[k], a[k] - o[k], o[k]]);
}

/**
 * The carrier as the WORKER sees it — where the plane is, and nothing else.
 *
 * ⚠️ The caller's `material` must not travel: a `Material` cannot be structured-
 * cloned across the worker boundary, and appearance in a build spec would make
 * recolouring rebuild the geometry.
 */
function carrierSpec(carrier?: ZoneCarrier): StackCarrier | undefined {
  return carrier ? { depth: carrier.depth, below: carrier.below } : undefined;
}

/**
 * The column, as the generator's shared-build spec.
 *
 * ⚠⚠ The `key` is the identity of the CACHED column, and the cache holds exactly
 * one. Everything built from the same column — every zone, and the sea — must
 * derive it HERE, or two of them ask for the same column under different names and
 * evict each other, paying for the fetch, the resample and the resolve twice.
 *
 * The ordered surface ids decide both the common grid and the resolve; the carrier
 * joins them because it terminates the column, and the relief because it is the
 * column's top.
 */
export function stackColumnSpec(
  surfaces: SurfaceMeta[],
  envelope: PlanarPolygonGeometry,
  utmToArea: UtmToArea,
  carrier?: ZoneCarrier,
  relief?: ColumnRelief | null,
): SurfaceZoneStackSpec {
  // The sea bed is built on the relief, when the column holds it.
  const onRelief =
    relief && surfaces.some(m => m.id === relief.seabed) ? relief : null;
  return {
    layers: surfaces.map(meta =>
      meta.id === onRelief?.seabed
        ? { ...toLayerSpec(meta, utmToArea), reliefSource: onRelief.source }
        : toLayerSpec(meta, utmToArea),
    ),
    polygon: {
      coordinates: envelope.coordinates as PlanarPolygonCoordinates,
      offset: envelope.offset,
    },
    carrier: carrierSpec(carrier),
    key: `${surfaces.map(m => m.id).join(',')}|${
      carrier ? `${carrier.depth ?? ''}/${carrier.below ?? ''}` : ''
    }${onRelief ? `|${onRelief.seabed}@${onRelief.source.key}` : ''}`,
  };
}

/**
 * Build the serializable {@link StackWaterSpec} for the `stackWater` generator.
 *
 * The sea is the COLUMN's, so it is built from the same column spec the zones
 * use: its bed is the column's declared sea bed, on the same channels.
 */
export function buildStackWaterSpec(
  water: ZoneStackWater,
  utmToArea: UtmToArea,
  boundaryPolygon: PlanarPolygonGeometry,
  options: {
    surfaces: SurfaceMeta[];
    /** the sea bed's surface id, one of `surfaces` */
    bed: string;
    envelope: PlanarPolygonGeometry;
    carrier?: ZoneCarrier;
    /** the relief the column's sea bed is built on (see `ColumnRelief`) */
    relief?: ColumnRelief | null;
    rimSpacing?: number;
    maxError?: number;
    resolve?: ZoneResolveOptions;
    /** the stack declares a cut, so the sea needs the channels to close it with */
    section?: boolean;
  },
): StackWaterSpec {
  return {
    polygon: {
      coordinates: boundaryPolygon.coordinates as PlanarPolygonCoordinates,
      offset: boundaryPolygon.offset,
    },
    depth: water.depth ?? 0,
    // A flat lid is shaded per pixel and needs nothing but the boundary; only
    // displaced vertices need something to displace.
    resolution:
      water.resolution ??
      (water.displacement ? DEFAULT_WATER_RESOLUTION : undefined),
    rimSpacing: options.rimSpacing,
    maxError: options.maxError,
    stack: stackColumnSpec(
      options.surfaces,
      options.envelope,
      utmToArea,
      options.carrier,
      options.relief,
    ),
    bed: options.bed,
    resolve: options.resolve,
    section: options.section,
  };
}

/**
 * Build the serializable {@link SurfaceZoneSpec} for the `surfaceZone` generator
 * from the main-thread inputs: the ordered `layers` (each a surface plus whether
 * the interval below it is filled), the UTM->scene mapping (for each surface's
 * world placement), the resolved boundary polygon, and the build options.
 *
 * Materials are NOT part of the spec — they are appearance, and including them
 * would make recolouring rebuild the geometry.
 */
export function buildSurfaceZoneSpec(
  layers: ZoneLayer[],
  utmToArea: UtmToArea,
  boundaryPolygon: PlanarPolygonGeometry,
  options: BuildSurfaceZoneSpecOptions = {},
): SurfaceZoneSpec {
  // A zone that partly overlaps several neighbours references each of their
  // footprints once, by index.
  const cuts: SurfaceZoneCut[] = [];
  const cutIndex = new Map<PlanarPolygonGeometry, number>();
  const indexOfCut = (polygon: PlanarPolygonGeometry, rimSpacing?: number) => {
    const seen = cutIndex.get(polygon);
    if (seen !== undefined) return seen;
    const at = cuts.length;
    cuts.push({
      coordinates: polygon.coordinates as PlanarPolygonCoordinates,
      offset: polygon.offset,
      rimSpacing,
    });
    cutIndex.set(polygon, at);
    return at;
  };

  const specLayers: SurfaceZoneSpecLayer[] = layers.map((layer, i) => {
    const seam = options.seams?.[i] ?? null;
    const shared = {
      fill: zoneLayerFill(layer),
      cap: seam ? seam.draw : true,
      capCuts: seam?.cuts.length
        ? seam.cuts.map(cut => indexOfCut(cut.polygon, cut.rimSpacing))
        : undefined,
    };
    return layer.surface
      ? { ...toLayerSpec(layer.surface, utmToArea), ...shared }
      : {
          depth: layer.depth,
          offset: layer.offset,
          relief: layer.relief,
          ...shared,
        };
  });

  // ⭐ A fill on the LAST layer says the block is open at the bottom, and the only
  // thing that can close it is the column's floor — so the carrier is INFERRED
  // here rather than declared as a layer. Nothing else could mean anything: there
  // is no next horizon in this zone for that volume to end on.
  const last = layers[layers.length - 1];
  if (options.carrier && last && zoneLayerFill(last)) {
    const seam = options.carrierSeam ?? null;
    specLayers.push({
      carrier: true,
      fill: false,
      cap: seam ? seam.draw : true,
      capCuts: seam?.cuts.length
        ? seam.cuts.map(cut => indexOfCut(cut.polygon, cut.rimSpacing))
        : undefined,
    });
  }

  const stack = options.stack
    ? stackColumnSpec(
        options.stack.surfaces,
        options.stack.envelope,
        utmToArea,
        options.carrier,
        options.stack.relief,
      )
    : undefined;

  return {
    layers: specLayers,
    polygon: {
      coordinates: boundaryPolygon.coordinates as PlanarPolygonCoordinates,
      offset: boundaryPolygon.offset,
    },
    stack,
    sea: stack && options.sea ? options.sea : undefined,
    carrier: carrierSpec(options.carrier),
    cuts: cuts.length > 0 ? cuts : undefined,
    coverAbove: options.coverAbove
      ? {
          coordinates: options.coverAbove
            .coordinates as PlanarPolygonCoordinates,
          offset: options.coverAbove.offset,
        }
      : undefined,
    rimSpacing: options.rimSpacing,
    maxError: options.maxError,
    resolve: options.resolve,
    section: options.section,
    peelable: options.peelable,
    diagnostics: options.diagnostics,
    preview: options.preview,
  };
}
