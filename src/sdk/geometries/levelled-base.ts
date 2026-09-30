import { BufferAttribute, BufferGeometry } from 'three';
import {
  Coordinates2D,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from './planar-geometry';
import { createPolygonCap } from './polygon-cap';
import { densifyPolygon } from './surface-chunk';
import { buildIntervalWalls } from './surface-walls';

/**
 * How the levelled top of a {@link createLevelledBase} is decided: an absolute
 * scene Y, or which of the terrain's own heights under the footprint to take.
 *
 * `'max'` is a pure FILL — the top clears the highest ground in the footprint, so
 * nothing has to be excavated and the base is a berm thickest on the low side.
 *
 * @group Geometries
 */
export type LevelledBaseLevel = number | 'max' | 'mean' | 'min';

/**
 * Options for {@link createLevelledBase}.
 *
 * @group Geometries
 */
export type LevelledBaseOptions = {
  /** see {@link LevelledBaseLevel}. Default `'max'`. */
  level?: LevelledBaseLevel;
  /**
   * Raise the DERIVED level by this much (m), e.g. to keep a structure clear of
   * the sea bed. Ignored when `level` is an absolute height, which is already the
   * answer. Default 0.
   */
  standoff?: number;
  /**
   * How far the skirt cuts below the terrain (m). It is what stops a hairline of
   * daylight showing between the base and the ground it stands on, since the two
   * are separate meshes agreeing only to within their own tessellations. Default 2.
   */
  embedment?: number;
  /**
   * Least the base stands proud of the ground (m), where the terrain would
   * otherwise reach its top. ⚠️ Without it a forced `level` below the ground
   * inverts the skirt — its bottom edge crossing over its top — which turns the
   * wall inside out rather than simply hiding it. Default 1.
   */
  minThickness?: number;
  /**
   * Rim densification spacing (m) — how finely the skirt's foot follows the
   * ground. Derived from the footprint when omitted.
   */
  spacing?: number;
  /**
   * Target interior edge length (m) of the underside, which is what makes it
   * DRAPE rather than span the footprint flat. Defaults to `spacing`.
   */
  resolution?: number;
  /**
   * Close the base underneath. Default true: with a positive `embedment` it is
   * buried and never seen, but it costs almost nothing at this scale and it means
   * the base is a solid rather than a shell — which matters the moment anything
   * sections it or looks up from below.
   */
  closed?: boolean;
};

/**
 * What the ground under a base turned out to be. Reported rather than assumed:
 * a site is chosen from a map, and how much of a berm it needs is the answer.
 *
 * @group Geometries
 */
export type LevelledBaseMetrics = {
  /** lowest / highest / mean terrain height sampled under the footprint */
  min: number;
  max: number;
  mean: number;
  /**
   * Share of the sampled points that hit the surface at all (0..1). Below 1 the
   * footprint runs off the edge of what is drawn, and the base is standing partly
   * on an assumption.
   */
  coverage: number;
  /** greatest height between the ground and the levelled top (m) */
  fill: number;
  /** greatest height the ground stands ABOVE that top (m) — 0 unless `level` was forced */
  cut: number;
  /** volume of material between the top and the underside (m³) */
  volume: number;
};

/**
 * A base built by {@link createLevelledBase}. Three meshes rather than one: they
 * carry different attributes (the skirt is built by the wall builder, with its own
 * normals and metric UVs), and merging them would cost more than drawing them.
 *
 * @group Geometries
 */
export type LevelledBase = {
  /** the flat, levelled top the structure sits on */
  top: BufferGeometry;
  /** the sides, from the top down into the ground */
  skirt: BufferGeometry | null;
  /** the draped underside, when `closed` */
  bottom: BufferGeometry | null;
  /** scene Y of the levelled top */
  level: number;
  metrics: LevelledBaseMetrics;
};

/** Flip a cap over: reverse the winding, then let the normals follow it. */
function faceDown(geometry: BufferGeometry) {
  const index = geometry.getIndex();
  if (index) {
    const array = index.array as unknown as number[];
    for (let i = 0; i < array.length; i += 3) {
      const swap = array[i + 1];
      array[i + 1] = array[i + 2];
      array[i + 2] = swap;
    }
    (index as BufferAttribute).needsUpdate = true;
  }
  geometry.computeVertexNormals();
}

/**
 * Build a levelled base for something that cannot sit on sloping ground — a
 * template, a manifold, any structure that needs a flat, known platform.
 *
 * The footprint is sampled against the terrain (typically a
 * {@link createTinSampler} over the drawn sea bed), a level is chosen from what
 * the ground actually does there, and the base is built as a solid between that
 * level and the ground: a flat top, a skirt cutting into the sea bed, and a draped
 * underside.
 *
 * ⭐ The sampling is what makes this a construction rather than a decoration —
 * `metrics` reports how much fill the site needs and whether the footprint even
 * lies fully on mapped ground, which is exactly the question asked when a site is
 * proposed.
 *
 * @param footprint the base's outline in scene XZ
 * @param heightAt terrain height at a world X/Z, `null` where there is none
 * @returns the base, or `null` when the footprint lies entirely off the surface
 *
 * @group Geometries
 */
export function createLevelledBase(
  footprint: PlanarPolygonGeometry,
  heightAt: (x: number, z: number) => number | null,
  options: LevelledBaseOptions = {},
): LevelledBase | null {
  const bounds = footprint.getBounds();
  const spacing =
    options.spacing ??
    Math.max(Math.min(bounds.size[0], bounds.size[1]) / 16, 0.5);
  const resolution = options.resolution ?? spacing;
  const embedment = options.embedment ?? 2;
  const minThickness = options.minThickness ?? 1;

  const densified = densifyPolygon(footprint, spacing);
  const shapes = densified.toShapes();
  const rings = (densified.coordinates as PlanarPolygonCoordinates).flat();

  // The underside doubles as the sampling grid: deriving the level from the rim
  // alone would miss a rise in the middle of the footprint, which is the one place
  // a structure would actually foul it.
  const cap = createPolygonCap(shapes, { resolution });
  const vertices = cap.getAttribute('position') as BufferAttribute;
  const count = vertices.count;
  const sampled = new Float64Array(count);
  const valid = new Uint8Array(count);

  let hits = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const height = heightAt(vertices.getX(i), vertices.getZ(i));
    if (height === null || !Number.isFinite(height)) continue;
    sampled[i] = height;
    valid[i] = 1;
    hits++;
    sum += height;
    if (height < min) min = height;
    if (height > max) max = height;
  }
  if (hits === 0) {
    cap.dispose();
    return null;
  }

  const mean = sum / hits;
  // Where the footprint runs off the drawn surface the ground is unknown, not
  // absent: the mean keeps the base a solid instead of tearing a hole in it.
  for (let i = 0; i < count; i++) {
    if (!valid[i]) sampled[i] = mean;
  }

  const standoff = options.standoff ?? 0;
  const level =
    typeof options.level === 'number'
      ? options.level
      : (options.level === 'min'
          ? min
          : options.level === 'mean'
            ? mean
            : max) + standoff;

  const underside = (height: number) =>
    Math.min(height - embedment, level - minThickness);

  for (let i = 0; i < count; i++) {
    vertices.setY(i, underside(sampled[i]));
  }
  vertices.needsUpdate = true;
  faceDown(cap);

  const ringHeights = rings.map(ring =>
    (ring as Coordinates2D).map(p => {
      const height = heightAt(p[0], p[1]);
      return underside(
        height === null || !Number.isFinite(height) ? mean : height,
      );
    }),
  );
  const skirt = buildIntervalWalls(
    rings,
    rings.map(ring => ring.map(() => level)),
    ringHeights,
  );

  // Material volume, from the underside's own triangles — the same mesh the
  // number describes, so it cannot drift from what is drawn.
  let volume = 0;
  const index = cap.getIndex();
  const triangles = index ? index.count / 3 : count / 3;
  for (let t = 0; t < triangles; t++) {
    const a = index ? index.getX(t * 3) : t * 3;
    const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const ax = vertices.getX(a);
    const az = vertices.getZ(a);
    const area =
      Math.abs(
        (vertices.getX(b) - ax) * (vertices.getZ(c) - az) -
          (vertices.getX(c) - ax) * (vertices.getZ(b) - az),
      ) / 2;
    const height =
      level - (vertices.getY(a) + vertices.getY(b) + vertices.getY(c)) / 3;
    volume += area * Math.max(height, 0);
  }

  if (options.closed === false) cap.dispose();

  return {
    top: createPolygonCap(shapes, { y: level }),
    skirt,
    bottom: options.closed === false ? null : cap,
    level,
    metrics: {
      min,
      max,
      mean,
      coverage: hits / count,
      fill: Math.max(level - min, 0),
      cut: Math.max(max - level, 0),
      volume,
    },
  };
}
