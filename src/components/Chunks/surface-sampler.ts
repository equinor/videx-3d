import {
  createContext,
  RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { createTinSampler, TinSample, TinSampler, Vec2, Vec3 } from '../../sdk';

/**
 * One drawn surface a chunk offers for sampling.
 *
 * @group Contexts
 */
export type SurfaceSamplerEntry = {
  /** the surface's id, or `null` for a synthetic layer (a level, a floor) */
  id: string | null;
  /** the layer's index in the chunk that drew it */
  layer: number;
  /** the geometry as drawn */
  geometry: BufferGeometry;
};

/**
 * Read-only height queries against the surfaces a `ChunkStack` currently DRAWS.
 *
 * ⭐ It samples the triangles on screen, not the source grid: a grid sample and
 * the drawn mesh differ by up to the tessellation's `maxError`, which at field
 * scale is metres — enough for an object to visibly float above the sea bed it is
 * meant to be standing on.
 *
 * The counterpart to `OceanSampler`: that one is analytic because the sea is a
 * function of time, this one reads geometry because a horizon is a function of
 * data. Both return the caller's own scene frame, and both are `null` when there
 * is nothing to sample, so a consumer keeps its static pose rather than jumping to
 * the origin.
 *
 * @group Contexts
 */
export type SurfaceSampler = {
  /**
   * Height and surface normal at a world X/Z, or `null` where nothing is drawn —
   * outside the outline, in a hole, or where the unit has pinched out.
   *
   * @param surface a surface id to sample that horizon alone; omitted, the
   *   HIGHEST drawn surface answers, which is the ground as it is seen from above
   * @param out reused to avoid allocating on a per-pointer-move path
   */
  sampleAt(
    x: number,
    z: number,
    surface?: string,
    out?: TinSample,
  ): TinSample | null;
  /** Just the height, or `null` where nothing is drawn. */
  getHeightAt(x: number, z: number, surface?: string): number | null;
  /** Ids of the surfaces currently drawn, and so sampleable. */
  readonly surfaces: string[];
};

/**
 * Where chunks publish the surfaces they have drawn. Separate from
 * `ChunkStackContext` on purpose: that value is what every chunk's build spec is
 * derived from, and a sibling finishing its geometry must not disturb it.
 *
 * @group Contexts
 */
export type SurfaceSamplerRegistry = {
  register(key: string, entries: SurfaceSamplerEntry[]): () => void;
};

/** Built once per geometry, and dies with it. */
const samplers = new WeakMap<BufferGeometry, TinSampler>();

function samplerFor(geometry: BufferGeometry): TinSampler | null {
  const cached = samplers.get(geometry);
  if (cached) return cached;
  const position = geometry.getAttribute('position') as
    | BufferAttribute
    | undefined;
  if (!position) return null;
  const index = geometry.getIndex();
  const built = createTinSampler(
    position.array as ArrayLike<number>,
    index ? (index.array as ArrayLike<number>) : null,
  );
  samplers.set(geometry, built);
  return built;
}

/**
 * Build a {@link SurfaceSampler} over the surfaces the chunks have published.
 *
 * The per-geometry lookup structures are built on FIRST USE and cached against the
 * geometry, so a stack nobody samples pays nothing.
 *
 * @group Components
 */
export function createSurfaceSampler(
  entries: SurfaceSamplerEntry[],
): SurfaceSampler {
  // ⚠️ Two scratch objects, not one: `probe` receives each entry's answer and
  // `scratch` may BE the caller's `out`. Sharing them makes the comparison below
  // read the value it is about to overwrite, so the LAST hit wins instead of the
  // highest — which reads as the floor of the block rather than its surface.
  const probe: TinSample = { y: 0, normal: [0, 1, 0] };
  const scratch: TinSample = { y: 0, normal: [0, 1, 0] };

  const sampleAt = (
    x: number,
    z: number,
    surface?: string,
    out?: TinSample,
  ): TinSample | null => {
    const result = out ?? { y: 0, normal: [0, 1, 0] as Vec3 };
    let found = false;
    for (const entry of entries) {
      if (surface !== undefined && entry.id !== surface) continue;
      const sampler = samplerFor(entry.geometry);
      // A shared horizon is split across the chunks drawing it, so several
      // entries can carry the same id and only one covers a given point.
      const hit = sampler?.sampleAt(x, z, probe);
      if (!hit) continue;
      if (!found || hit.y > result.y) {
        result.y = hit.y;
        result.normal[0] = hit.normal[0];
        result.normal[1] = hit.normal[1];
        result.normal[2] = hit.normal[2];
        found = true;
      }
      // With a target named there is one right answer; without one, the highest
      // wins and every entry has to be asked.
      if (found && surface !== undefined) break;
    }
    return found ? result : null;
  };

  return {
    sampleAt,
    getHeightAt: (x, z, surface) => sampleAt(x, z, surface, scratch)?.y ?? null,
    get surfaces() {
      return entries
        .map(e => e.id)
        .filter((id): id is string => id !== null)
        .filter((id, i, all) => all.indexOf(id) === i);
    },
  };
}

/**
 * Context carrying the current {@link SurfaceSampler}. A `ChunkStack` provides it;
 * `null` outside one, or before its chunks have built.
 *
 * @group Contexts
 */
export const SurfaceSamplerContext = createContext<SurfaceSampler | null>(null);

/**
 * Context chunks publish their drawn surfaces to. Consumers want
 * {@link SurfaceSamplerContext}.
 *
 * @group Contexts
 */
export const SurfaceSamplerRegistryContext =
  createContext<SurfaceSamplerRegistry | null>(null);

/**
 * Access the {@link SurfaceSampler} provided by an enclosing `ChunkStack`, or
 * `null` when there is none (or its chunks have not built yet).
 *
 * ⚠️ The identity changes whenever a chunk's geometry does, which is the signal to
 * sample again — anything placed from it should list it as a dependency.
 *
 * @group Hooks
 */
export function useSurfaceSampler(): SurfaceSampler | null {
  return useContext(SurfaceSamplerContext);
}

/**
 * What to sample, and over how wide a footprint. See
 * {@link sampleSurfaceFootprint}.
 *
 * @group Components
 */
export type SurfaceFootprintOptions = {
  /** centre of the footprint, in scene XZ */
  x: number;
  z: number;
  /** sample this surface alone; omitted, the highest drawn one answers */
  surface?: string;
  /**
   * Radius of the sampled disc, in metres — the object's own size. 0 samples the
   * centre only, which gives a height but no orientation.
   */
  radius?: number;
  /** points around the ring. Default 8. */
  samples?: number;
  /**
   * Explicit sample points in the object's own frame, instead of a ring — the
   * true corners of a rectangular skid, say. Rotated by `heading`.
   */
  points?: Vec2[];
  /** heading about +Y (radians) applied to `points`. Default 0. */
  heading?: number;
};

/**
 * The surface under a footprint, as a plane.
 *
 * @group Components
 */
export type SurfaceFootprint = {
  /** height of the fitted plane at the footprint's CENTRE */
  y: number;
  /** unit normal of the fitted plane */
  normal: Vec3;
  /**
   * Share of the sample points that found a surface (0..1). ⭐ Below 1 the object
   * overhangs the edge of what is drawn — the honest signal that a site is not
   * usable, which a single centre sample cannot give.
   */
  coverage: number;
  /** lowest and highest sample, i.e. how uneven the ground under it is */
  min: number;
  max: number;
};

/** Reused across calls: this runs per pointer move (see `sampleSurfaceFootprint`). */
const offsetX: number[] = [];
const offsetZ: number[] = [];
const hitX: number[] = [];
const hitZ: number[] = [];
const hitY: number[] = [];

/**
 * Fit a plane to the surface under a footprint.
 *
 * ⭐ One point is not enough to put an object down. A single sample gives a height
 * and nothing else, so a wide object on sloping ground either floats at one corner
 * or digs in at another; and a triangle's own normal is the facet's, not the
 * ground's, so it jitters from triangle to triangle as the object moves. Fitting a
 * plane to several samples across the object's own extent answers both — the same
 * reasoning that makes a ship follow the swell rather than one wave.
 *
 * @returns the fitted plane, or `null` when no sample found a surface
 *
 * @group Components
 */
export function sampleSurfaceFootprint(
  sampler: SurfaceSampler,
  options: SurfaceFootprintOptions,
): SurfaceFootprint | null {
  const {
    x,
    z,
    surface,
    radius = 0,
    samples = 8,
    points,
    heading = 0,
  } = options;

  // Scratch, not fresh arrays: this runs per pointer move, and the only thing a
  // caller keeps is the result object.
  offsetX[0] = 0;
  offsetZ[0] = 0;
  let count = 1;
  if (points) {
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    for (const [px, pz] of points) {
      offsetX[count] = px * cos + pz * sin;
      offsetZ[count] = -px * sin + pz * cos;
      count++;
    }
  } else if (radius > 0 && samples > 0) {
    for (let i = 0; i < samples; i++) {
      const angle = (i / samples) * Math.PI * 2;
      offsetX[count] = Math.cos(angle) * radius;
      offsetZ[count] = Math.sin(angle) * radius;
      count++;
    }
  }

  let hits = 0;
  let sumX = 0;
  let sumZ = 0;
  let sumY = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < count; i++) {
    const dx = offsetX[i];
    const dz = offsetZ[i];
    const height = sampler.getHeightAt(x + dx, z + dz, surface);
    if (height === null) continue;
    hitX[hits] = dx;
    hitZ[hits] = dz;
    hitY[hits] = height;
    hits++;
    sumX += dx;
    sumZ += dz;
    sumY += height;
    if (height < min) min = height;
    if (height > max) max = height;
  }
  if (hits === 0) return null;

  const meanX = sumX / hits;
  const meanZ = sumZ / hits;
  const meanY = sumY / hits;

  // Least squares y = a·dx + b·dz + c about the centroid of the points that HIT,
  // so a footprint half off the surface still fits the half it has.
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  let sxy = 0;
  let szy = 0;
  for (let i = 0; i < hits; i++) {
    const dx = hitX[i] - meanX;
    const dz = hitZ[i] - meanZ;
    const dy = hitY[i] - meanY;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
    sxy += dx * dy;
    szy += dz * dy;
  }
  const det = sxx * szz - sxz * sxz;
  const a = det > 1e-9 ? (sxy * szz - szy * sxz) / det : 0;
  const b = det > 1e-9 ? (szy * sxx - sxy * sxz) / det : 0;

  const nx = -a;
  const nz = -b;
  const length = Math.hypot(nx, 1, nz);

  return {
    y: meanY + a * (0 - meanX) + b * (0 - meanZ),
    normal: [nx / length, 1 / length, nz / length],
    coverage: hits / count,
    min,
    max,
  };
}

/**
 * Options for {@link useSurfacePlacement}.
 *
 * @group Components
 */
export type SurfacePlacementOptions = Omit<
  SurfaceFootprintOptions,
  'points'
> & {
  /** lift the object this far above the surface (m). Default 0. */
  offset?: number;
  /**
   * Tilt the object onto the fitted plane: `false`/0 keeps it upright, `true`/1
   * lays it flat on the ground, in between leans it part of the way.
   * Default false.
   */
  align?: boolean | number;
  /** master switch; `false` leaves the object alone. Default true. */
  enabled?: boolean;
  /** called with the fit each time the object is placed (`null` when it missed) */
  onPlaced?: (placement: SurfaceFootprint | null) => void;
};

const UP = new Vector3(0, 1, 0);
const normal = new Vector3();
const tilt = new Quaternion();
const yaw = new Quaternion();
/**
 * Put an object down on a drawn surface: sample the ground under its footprint,
 * set its height, and optionally lay it on the local slope.
 *
 * The static counterpart of `useBuoyancy`. It settles ONCE per change rather than
 * running every frame, because a horizon only moves when its chunk is rebuilt —
 * and that gives the sampler a new identity, which is the trigger.
 *
 * No-op while there is no surface to stand on, so the object keeps whatever pose
 * it was given until the chunk has built.
 *
 * @group Hooks
 */
export function useSurfacePlacement(
  ref: RefObject<Object3D | null>,
  options: SurfacePlacementOptions,
): void {
  const sampler = useSurfaceSampler();
  const {
    x,
    z,
    surface,
    radius = 0,
    samples = 8,
    heading = 0,
    offset = 0,
    align = false,
    enabled = true,
  } = options;

  const onPlacedRef = useRef(options.onPlaced);
  useEffect(() => {
    onPlacedRef.current = options.onPlaced;
  }, [options.onPlaced]);

  const place = useMemo(() => {
    const lean = align === true ? 1 : align === false ? 0 : align;
    return (object: Object3D | null) => {
      if (!object || !sampler || !enabled) return;
      const fit = sampleSurfaceFootprint(sampler, {
        x,
        z,
        surface,
        radius,
        samples,
      });
      onPlacedRef.current?.(fit);
      if (!fit) return;

      object.position.set(x, fit.y + offset, z);
      yaw.setFromAxisAngle(UP, heading);
      if (lean > 0) {
        normal.set(fit.normal[0], fit.normal[1], fit.normal[2]);
        tilt.setFromUnitVectors(UP, normal);
        if (lean < 1) tilt.slerp(new Quaternion(), 1 - lean);
        object.quaternion.copy(tilt).multiply(yaw);
      } else {
        object.quaternion.copy(yaw);
      }
    };
  }, [
    sampler,
    x,
    z,
    surface,
    radius,
    samples,
    heading,
    offset,
    align,
    enabled,
  ]);

  useEffect(() => {
    place(ref.current);
  }, [place, ref]);
}
