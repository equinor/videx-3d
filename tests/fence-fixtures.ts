import { readFileSync } from 'fs';
import {
  buildWellboreFence,
  createWellboreOutline,
  getSplineCurve,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  Vec2,
  Vec3,
  WellboreFence,
} from '../src/sdk';
import { Curve3D } from '../src/sdk/geometries/curve/curve-3d';
import { CRS, getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import {
  EXTRA_WELLBORE_IDS,
  isExtraWellbore,
  withExtraWellbores,
} from '../src/storybook/data/extra-wellbores';
import storyArgs from '../src/storybook/story-args.json';

/**
 * Real Volve wells in the same frame the app puts them in.
 *
 * ⚠️⚠️ The footprint MUST be built exactly as `useFieldOutline` does. A fence is
 * judged by how it splits THIS polygon and how far its run-outs have to reach, so
 * a harness that invents its own footprint measures a different fence from the one
 * on screen.
 */

type Header = { id: string; name: string; easting: number; northing: number };

export const headers: Record<string, Header> = JSON.parse(
  readFileSync('public/data/wellbore-headers.json', 'utf-8'),
);

const logs: Record<string, number[]> = JSON.parse(
  readFileSync('public/data/position-logs.json', 'utf-8'),
);

const crs = new CRS(
  getProjectionDefFromUtmZone(storyArgs.utmZone),
  storyArgs.origin as Vec2,
  'utm',
);

export const wellboreIds = Object.keys(headers).filter(
  id => (logs[id]?.length ?? 0) >= 8,
);

export function wellboreName(id: string): string {
  return headers[id]?.name ?? id;
}

/** The field's records with the extra wellbores appended — see `withExtraWellbores`. */
const withExtras = withExtraWellbores(headers, logs);

/**
 * Extra wellbores placed in this field — empty unless the uncommitted
 * `private/extra-wellbores/*.json` exist. Never part of {@link wellboreIds}.
 */
export const extraWellboreIds = EXTRA_WELLBORE_IDS;

/** A wellbore's position log in scene coordinates. */
export function trajectory(id: string): Vec3[] | null {
  const header = withExtras.headers[id];
  const log = withExtras.logs[id];
  if (!header || !log || log.length < 8) return null;
  const out: Vec3[] = [];
  for (let j = 0; j + 3 < log.length; j += 4) {
    const p = crs.utmToWorld(
      header.easting + log[j],
      header.northing + log[j + 2],
      -log[j + 1],
    );
    out.push([p.x, p.y, p.z]);
  }
  return out;
}

/** The spline a fence is sampled off, as `useStackFence` builds it. */
export function trajectoryCurve(id: string): Curve3D | null {
  const points = trajectory(id);
  if (!points || points.length < 3) return null;
  return getSplineCurve(points);
}

function outlineRings(outline: PlanarPolygonGeometry | null): Vec2[][] {
  if (!outline) return [];
  const [ox, oz] = outline.offset;
  const rings: Vec2[][] = [];
  for (const polygon of outline.coordinates as PlanarPolygonCoordinates) {
    for (const ring of polygon) {
      rings.push(ring.map(p => [p[0] + ox, p[1] + oz] as Vec2));
    }
  }
  return rings;
}

const OUTLINE = { radius: 1500, feather: 1, smoothing: 2 };
const hostPlans: Vec2[][] = wellboreIds
  .map(id => trajectory(id))
  .filter((t): t is Vec3[] => !!t)
  .map(t => t.map(p => [p[0], p[2]] as Vec2));

/** The field footprint every well is cut out of. */
export const rings: Vec2[][] = outlineRings(
  createWellboreOutline(hostPlans, OUTLINE),
);

const extraRings = new Map<string, Vec2[][]>();

/** The footprint `id` is cut out of: the field's, grown by the well itself when it is an extra. */
export function ringsFor(id: string): Vec2[][] {
  if (!isExtraWellbore(id)) return rings;
  let r = extraRings.get(id);
  if (!r) {
    const plan = trajectory(id)!.map(p => [p[0], p[2]] as Vec2);
    r = outlineRings(createWellboreOutline([...hostPlans, plan], OUTLINE));
    extraRings.set(id, r);
  }
  return r;
}

export const bounds: [number, number, number, number] = (() => {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1];
      if (p[1] > maxZ) maxZ = p[1];
    }
  }
  return [minX, minZ, maxX, maxZ];
})();

const built = new Map<string, WellboreFence | null>();
const refused = new Map<string, Error>();

/**
 * A built fence, memoised.
 *
 * ⚠️⚠️ A build is ~250 ms and deterministic, and several tests each want the same
 * one for every wellbore. Rebuilding per assertion made this file take the best part
 * of a minute; sharing them makes it seconds. Keep the MARGINS a test sweeps small
 * and shared, or the cache never hits.
 *
 * ⚠️⚠️ FAILURES are memoised too. A build that cannot meet its invariants throws, and the
 * throwing path is the EXPENSIVE one — it exhausts the repair before giving up — so a
 * re-thrown cached error is what stops one bad well being rebuilt once per assertion.
 */
export function fenceFor(id: string, margin = 0.1): WellboreFence | null {
  const key = `${id}@${margin}`;
  const prior = refused.get(key);
  if (prior) throw prior;
  if (!built.has(key)) {
    const curve = trajectoryCurve(id);
    if (!curve) {
      built.set(key, null);
    } else {
      try {
        built.set(key, buildWellboreFence(curve, { rings: ringsFor(id), margin }));
      } catch (thrown) {
        const error =
          thrown instanceof Error ? thrown : new Error(String(thrown));
        refused.set(key, error);
        throw error;
      }
    }
  }
  return built.get(key) ?? null;
}
