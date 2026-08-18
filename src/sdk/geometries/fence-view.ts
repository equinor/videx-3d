import { Vec2, Vec3 } from '../types/common';
import {
  leftNormal2D,
  polylineBounds2D,
  principalDirection2D,
} from '../utils/polyline-2d';
import { fenceSideAt } from './fence-segments';
import { WellboreFence } from './wellbore-fence';

/**
 * Where to stand to read a fence.
 *
 * ⭐ A fence's cut face is only visible from the half that was removed — from the
 * other one the block itself is in the way. So the viewing side is not a
 * preference: it follows from which half the fence takes away, and the two have to
 * be decided together. That is why this returns the `side` as well as the pose.
 *
 * @module
 */

/** A camera pose that frames a fence, in the terms `CameraManager` takes. */
export type FenceViewPose = {
  /** what must be visible: the cut's plan extent through the block's depth range */
  box: { min: Vec3; max: Vec3 };
  /** centre of `box` */
  target: Vec3;
  /** degrees from +X toward +Z, of the offset from target to camera */
  azimuth: number;
  /** degrees from straight down */
  polar: number;
  /** the half the fence must remove for this pose to see the cut face */
  side: 1 | -1;
  /**
   * Whether the camera ends up in the half that was removed.
   *
   * ⚠️ False means no heading within a quarter turn of square-on could see the cut
   * — a well that wraps round on itself in plan. The pose is still the best
   * available, but the block will be partly in the way.
   */
  open: boolean;
};

/** {@link fenceViewPose} options. */
export type FenceViewOptions = {
  /** top of the block, scene Y */
  top: number;
  /** bottom of the block, scene Y */
  bottom: number;
  /**
   * Prefer whichever side is closer to this horizontal direction (camera minus
   * target). Ignored when `side` is given.
   *
   * ⭐ Both sides are equally readable, so the tie is broken on TRAVEL: taking the
   * nearer one turns a fly-to into a short swing instead of a trip round the back.
   */
  from?: Vec2;
  /** force the half to remove, instead of choosing one */
  side?: 1 | -1;
  /** degrees from straight down. Default 78 — a little above the horizon. */
  polar?: number;
  /**
   * Metres of the cut to take in beyond the well's own trace, at each end.
   * Default 0.
   *
   * ⚠️ Not the whole cut. The run-outs carry the fence clear of the footprint at
   * both ends, so framing all of it means framing the field and losing the well.
   */
  reach?: number;
  /**
   * Degrees of heading to keep between the camera and the nearest heading the cut
   * closes at. Default 25.
   *
   * ⚠️ Those headings are where `fenceAutoSide` flips, so a camera parked on one
   * swaps the half that was removed as soon as it orbits a little.
   */
  guard?: number;
};

/** Default {@link FenceViewOptions.polar}, in degrees. */
const DEFAULT_POLAR = 78;

/** Default {@link FenceViewOptions.guard}, in degrees. */
const DEFAULT_GUARD = 25;

/** Heading step the search tries either side of square-on, in degrees. */
const SCAN_STEP = 10;

/**
 * How far off square-on the search will go, in degrees.
 *
 * ⚠️ Past 90 the camera is looking ALONG the cut rather than at it, which shows
 * nothing whether or not the block is in the way.
 */
const SCAN_LIMIT = 90;

const DEG = Math.PI / 180;

/** Signed distance to the cut at a heading, negative where the block is gone. */
function probe(
  fence: WellboreFence,
  side: 1 | -1,
  centre: Vec2,
  radius: number,
  azimuth: number,
): number {
  const at = side > 0 ? fence.plus : fence.minus;
  const a = azimuth * DEG;
  return fenceSideAt(
    at.index,
    at.field,
    centre[0] + radius * Math.cos(a),
    centre[1] + radius * Math.sin(a),
  );
}

/**
 * The heading nearest square-on that looks INTO the cut, with room around it.
 *
 * ⭐⭐ Asked of the fence rather than derived. Square to the section is where a
 * camera wants to be, but a well that bends enough puts the point square-on to its
 * own AVERAGE back inside the block — measured 300 m inside on one of the demo
 * wells, which is a cut face with rock in front of it. The exact side lookup is
 * right there, so the heading is searched with it rather than assumed.
 *
 * ⭐⭐ It takes the middle of the open WINDOW, not the first heading that opens.
 * The window's ends are where the camera crosses the cut — over a run-out, for a
 * well angled across the field — and those are exactly the headings `fenceAutoSide`
 * flips at. Stopping at the first opening parks the camera on one, so the fly-to
 * lands a nudge away from swapping the half it just removed.
 */
function bestAzimuth(
  fence: WellboreFence,
  side: 1 | -1,
  preferred: number,
  centre: Vec2,
  radius: number,
  guard: number,
): { azimuth: number; open: boolean } {
  const isOpen = (offset: number) =>
    probe(fence, side, centre, radius, preferred + offset) < 0;

  // The open headings, as contiguous runs of offset from square-on. More than one
  // is possible: a curve that wanders can leave the framing circle twice.
  const runs: [number, number][] = [];
  let from: number | null = null;
  for (let off = -SCAN_LIMIT; off <= SCAN_LIMIT; off += SCAN_STEP) {
    if (isOpen(off)) {
      if (from === null) from = off;
    } else if (from !== null) {
      runs.push([from, off - SCAN_STEP]);
      from = null;
    }
  }
  if (from !== null) runs.push([from, SCAN_LIMIT]);
  if (runs.length === 0) return { azimuth: preferred, open: false };

  const away = ([lo, hi]: [number, number]) => (lo > 0 ? lo : hi < 0 ? -hi : 0);
  let best = runs[0];
  for (const run of runs) if (away(run) < away(best)) best = run;

  // Bisect each end against its closed neighbour. A run reaching the scan limit
  // ends there instead: past it the camera looks along the cut, not at it.
  const edge = (inside: number, outside: number) => {
    for (let i = 0; i < 8; i++) {
      const mid = (inside + outside) * 0.5;
      if (isOpen(mid)) inside = mid;
      else outside = mid;
    }
    return inside;
  };
  const lo =
    best[0] <= -SCAN_LIMIT ? -SCAN_LIMIT : edge(best[0], best[0] - SCAN_STEP);
  const hi =
    best[1] >= SCAN_LIMIT ? SCAN_LIMIT : edge(best[1], best[1] + SCAN_STEP);

  // ⭐ Square-on while there is room for it, the middle of the window when there is
  // not — so a comfortably open fence is framed exactly as before and only a tight
  // one gives up being square.
  const margin = Math.min(guard, (hi - lo) * 0.5);
  const offset = Math.min(Math.max(0, lo + margin), hi - margin);
  return { azimuth: preferred + offset, open: true };
}

/**
 * A camera pose that looks square-on at a fence's cut face.
 *
 * ⭐⭐ Built from the TRACE, not from the finished side curve. The trace is the
 * well's own path; the side curves carry run-outs that leave the footprint, and
 * their spread is the field's rather than the well's — take their principal axis
 * and a short well in a wide field gets framed by its run-outs.
 *
 * ⭐ The heading starts at the trace's principal axis turned a quarter turn, so
 * the view is across the section rather than down it, and is then corrected
 * against the fence itself until it is one the cut can actually be seen from —
 * with `guard` degrees of clearance from where it stops being one.
 *
 * @param fence a finished fence, as `ChunkStackProps.onFence` reports it
 *
 * @group Geometries
 */
export function fenceViewPose(
  fence: WellboreFence,
  options: FenceViewOptions,
): FenceViewPose {
  const points = fence.base.points;
  const first = points[0];
  const last = points[points.length - 1];

  // The axis is unsigned; walking the well head→TD is what gives `side` a meaning,
  // so orient it that way before taking a normal.
  const axis = principalDirection2D(points);
  if (axis[0] * (last[0] - first[0]) + axis[1] * (last[1] - first[1]) < 0) {
    axis[0] = -axis[0];
    axis[1] = -axis[1];
  }
  // Side 1 removes the half the left normal points into, so that is where a camera
  // has to stand to see anything.
  const normal = leftNormal2D(axis[0], axis[1]);

  const [minX, minZ, maxX, maxZ] = polylineBounds2D(points);
  const reach = Math.max(options.reach ?? 0, 0);
  const top = Math.max(options.top, options.bottom);
  const bottom = Math.min(options.top, options.bottom);
  const box = {
    min: [minX - reach, bottom, minZ - reach] as Vec3,
    max: [maxX + reach, top, maxZ + reach] as Vec3,
  };
  const target: Vec3 = [
    (box.min[0] + box.max[0]) * 0.5,
    (box.min[1] + box.max[1]) * 0.5,
    (box.min[2] + box.max[2]) * 0.5,
  ];
  const polar = options.polar ?? DEFAULT_POLAR;

  // Roughly where the camera will end up in plan: a 60° fov frames a box from
  // about its own diagonal away, and only the horizontal part of that offsets it.
  const centre: Vec2 = [target[0], target[2]];
  const radius = Math.max(
    Math.hypot(
      box.max[0] - box.min[0],
      box.max[1] - box.min[1],
      box.max[2] - box.min[2],
    ) * Math.sin(polar * DEG),
    500,
  );

  const facing = (at: 1 | -1) =>
    (Math.atan2(normal[1] * at, normal[0] * at) * 180) / Math.PI;

  let side = options.side ?? 1;
  if (options.side === undefined && options.from) {
    const [fx, fz] = options.from;
    side = normal[0] * fx + normal[1] * fz >= 0 ? 1 : -1;
  }
  const guard = Math.max(options.guard ?? DEFAULT_GUARD, 0);
  let found = bestAzimuth(fence, side, facing(side), centre, radius, guard);
  // Free to choose, and this half cannot be seen into: the other one is a whole
  // second chance, and a longer trip round still beats a blocked view.
  if (!found.open && options.side === undefined) {
    const other = -side as 1 | -1;
    const alternative = bestAzimuth(
      fence,
      other,
      facing(other),
      centre,
      radius,
      guard,
    );
    if (alternative.open) {
      side = other;
      found = alternative;
    }
  }

  return { box, target, azimuth: found.azimuth, polar, side, open: found.open };
}
