import { ComputedRelief, functionRelief, geoFrameAt } from '../../sdk';

/**
 * StageDebug's synthetic ground, served by the demo store as a relief layer: rolling
 * seabed and a channel around a sea 100 m deep, so the ground rises and dips through the
 * sea's seabed, and hills well above it, all below sea level. It covers the stage, made
 * for one of `STAGE_GROUND_BASE_HALF` (16 km across) and stretched with it, and is laid
 * out in the stage's own map (`geoFrameAt` about its place), so it is the scene's X/Z.
 */
export const STAGE_GROUND_PREFIX = 'synthetic:stage-ground:';

/** The half extent of the stage the ground is drawn for; it stretches with the stage. */
export const STAGE_GROUND_BASE_HALF = 8000;

// The sea's seabed it rolls about, and its hills: x, z, radius and peak, scene metres.
const BED = -100;
const HILLS: [number, number, number, number][] = [
  [1100, 700, 600, -20],
  [-1400, -500, 500, -30],
  [200, -1600, 450, -25],
  [2500, 900, 500, -35],
];
// Between its nodes, in metres.
const CELL = 50;

/** The ground's height at scene X/Z of the base stage, metres above the sea. */
export function stageGroundHeight(x: number, z: number) {
  let height =
    BED +
    35 * Math.sin(x / 700) * Math.cos(z / 900) +
    20 * Math.sin((x + 2 * z) / 1500);
  for (const [hx, hz, radius, peak] of HILLS) {
    const rise = Math.exp(-((x - hx) ** 2 + (z - hz) ** 2) / radius ** 2);
    height += (peak - height) * rise;
  }
  return height;
}

/** The id of the ground under a stage at a place, `width` x `length` km. */
export function stageGroundId(
  longitude: number,
  latitude: number,
  width: number,
  length: number,
) {
  return `${STAGE_GROUND_PREFIX}${longitude}:${latitude}:${width}:${length}`;
}

/** The ground an id names, or null for any other id. */
export function stageGroundRelief(id: unknown): ComputedRelief | null {
  if (typeof id !== 'string' || !id.startsWith(STAGE_GROUND_PREFIX))
    return null;
  const [longitude, latitude, width, length] = id
    .slice(STAGE_GROUND_PREFIX.length)
    .split(':')
    .map(Number);
  if (![longitude, latitude, width, length].every(Number.isFinite)) return null;
  const halfWidth = (width * 1000) / 2;
  const halfLength = (length * 1000) / 2;
  const sx = halfWidth / STAGE_GROUND_BASE_HALF;
  const sz = halfLength / STAGE_GROUND_BASE_HALF;
  return functionRelief(
    {
      id,
      name: `StageDebug ground, ${width} x ${length} km`,
      crs: geoFrameAt(longitude, latitude).projection,
      grid: {
        // Map Y runs north, scene Z south.
        origin: [-halfWidth, -halfLength],
        cell: [CELL, CELL],
        size: [
          Math.round((2 * halfWidth) / CELL) + 1,
          Math.round((2 * halfLength) / CELL) + 1,
        ],
      },
    },
    (x, y) => stageGroundHeight(x / sx, -y / sz),
  );
}
