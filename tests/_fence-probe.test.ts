/* oxlint-disable vitest/expect-expect -- a measurement probe, not a test: it
   REPORTS numbers for a human to read. Assertions would encode the very
   assumptions the next session is meant to re-verify. */
/**
 * TEMPORARY fence measurement harness — delete once the fence work lands.
 *
 * ⚠️⚠️ Deliberately assertion-free and deliberately small. An earlier version of
 * this file accumulated a dozen tests, each encoding a hypothesis that turned out
 * to be wrong; keeping them would hand the next session the same false framing.
 * What survives here is only the SCAFFOLDING (loading real data into the same
 * frame the app uses) plus a per-stage dump.
 *
 * Run with:
 *   npx vitest run tests/_fence-probe.test.ts --disable-console-intercept
 * (Vitest 4 hides console output from PASSING tests without that flag.)
 */
import { readFileSync } from 'fs';
import { describe, it } from 'vitest';
import {
  createFenceField,
  createFencePolyline,
  createWellboreOutline,
  fenceContour,
  fenceCurves,
  getSplineCurve,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  Vec2,
  Vec3,
} from '../src/sdk';
import { CRS, getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import storyArgs from '../src/storybook/story-args.json';

type Header = { id: string; name: string; easting: number; northing: number };

const headers: Record<string, Header> = JSON.parse(
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

// FieldColumn story defaults — keep in sync, or this measures a different fence
// from the one on screen.
const CELL_SIZE = 25;
const RESOLUTION = 10;
const STEP_SIZE = 20;
const MARGIN = 500;
const REVEAL = 0.5;

/** `useStackFence.smooth`, replicated. */
function smooth(points: Vec3[], spacing: number): Vec3[] {
  if (points.length < 3) return points;
  const curve = getSplineCurve(points);
  if (!curve) return points;
  const samples = Math.min(
    4000,
    Math.max(points.length, Math.ceil(curve.length / Math.max(spacing / 4, 1))),
  );
  return curve.getPoints(samples);
}

function trajectory(id: string): Vec3[] | null {
  const header = headers[id];
  const log = logs[id];
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

// ⚠️⚠️ The footprint MUST be built exactly as `useFieldOutline` does, and the
// bounding box MUST be appended as an extra ring, exactly as `useStackFence`
// does. Omitting the box makes the flood fill see one component and every share
// read as 0%/100% — a harness bug that has already cost one false alarm.
const RINGS = outlineRings(
  (() => {
    const paths: Vec2[][] = [];
    for (const id of Object.keys(headers)) {
      const t = trajectory(id);
      if (t) paths.push(t.map(p => [p[0], p[2]] as Vec2));
    }
    return createWellboreOutline(paths, {
      radius: 1500,
      feather: 1,
      smoothing: 2,
    });
  })(),
);

const BOUNDS = (() => {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const ring of RINGS)
    for (const p of ring) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1];
      if (p[1] > maxZ) maxZ = p[1];
    }
  return [minX, minZ, maxX, maxZ] as [number, number, number, number];
})();

const BOX: Vec2[] = [
  [BOUNDS[0], BOUNDS[1]],
  [BOUNDS[2], BOUNDS[1]],
  [BOUNDS[2], BOUNDS[3]],
  [BOUNDS[0], BOUNDS[3]],
];

const chainLength = (chain: Vec2[]) => {
  let total = 0;
  for (let i = 1; i < chain.length; i++)
    total += Math.hypot(
      chain[i][0] - chain[i - 1][0],
      chain[i][1] - chain[i - 1][1],
    );
  return total;
};

/** Every stage of the pipeline, for one wellbore at one setting. */
function probe(id: string, side: 1 | -1, width: number) {
  const scene = trajectory(id);
  if (!scene) return 'no trajectory';
  const projected = createFencePolyline(smooth(scene, STEP_SIZE), STEP_SIZE);
  if (!projected) return 'no plan curve';

  const options = {
    rings: [...RINGS, BOX],
    margin: Math.max(MARGIN, CELL_SIZE * 4),
    azimuth: 0,
    reveal: REVEAL,
  };
  const curves = fenceCurves(projected.positions, options);
  const curve = side > 0 ? curves.plus : curves.minus;

  const field = createFenceField(curve, {
    bounds: BOUNDS,
    cellSize: CELL_SIZE,
  });
  if (!field) return 'no field';

  const chains = fenceContour(field, { width, side, resolution: RESOLUTION });
  return [
    `plan ${String(projected.positions.length).padStart(4)} pts`,
    `curve ${String(curve.length).padStart(4)} pts`,
    `shared ${curves.shared ? 'y' : 'n'}`,
    `field ${field.nx}x${field.ny} min ${field.min.toFixed(0)} max ${field.max.toFixed(0)}`,
    `chains ${chains.length}`,
    `len [${chains.map(c => chainLength(c).toFixed(0)).join(', ')}]`,
  ].join('  ');
}

const TARGETS: [string, string][] = [
  ['NO 15/9-F-11', 'ad215042-f3be-2b7e-e053-c818a488c79a'],
  ['NO 15/9-F-11 A', 'ad215042-03e9-2b7e-e053-c818a488c79a'],
  ['NO 15/9-F-11 B', 'ad215042-03ea-2b7e-e053-c818a488c79a'],
  ['NO 15/9-F-11 T2', 'ad215042-03eb-2b7e-e053-c818a488c79a'],
  ['NO 15/9-F-12', 'ad215042-03ec-2b7e-e053-c818a488c79a'],
  ['NO 15/9-F-15 D', 'ad215042-03f2-2b7e-e053-c818a488c79a'],
  ['NO 15/9-19 S', 'ad215042-0219-2b7e-e053-c818a488c79a'],
];

describe('fence probe', () => {
  it('dumps every pipeline stage per wellbore and width', () => {
    // ⭐ START HERE: the user reports F-11 rendering NO fence at width 25 while
    // width 0 works. If that is visible in these numbers, the cause is at or
    // before `fenceContour`; if the numbers look healthy, it is downstream — in
    // `buildFenceRibbons`, `useChunkFenceFace`, or the shader discard.
    const rows: string[] = [];
    for (const [name, id] of TARGETS) {
      for (const side of [1, -1] as const) {
        for (const width of [0, 25, 200]) {
          rows.push(
            `${name.padEnd(16)} side ${side > 0 ? '+1' : '-1'}  w ${String(width).padStart(3)}  ${probe(id, side, width)}`,
          );
        }
      }
    }
    console.log('\n' + rows.join('\n') + '\n');
  }, 300000);
});
