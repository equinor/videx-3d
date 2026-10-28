import type { Vec2, Vec3 } from '../types/common';

// ⚠️ Free of three.js, like the frames: this is plain 2D math.

/**
 * A top-down view of a flat scene on a rectangle of pixels, as a minimap draws it: the
 * scene X/Z under its middle, which way on the ground is up the screen, and its scale.
 *
 * @group Utils
 */
export type MapView = {
  /** scene X/Z at the middle of the view */
  center: Vec2;
  /** a unit vector on the ground (X/Z): the direction that points up the screen */
  up: Vec2;
  /** ground metres a pixel spans */
  metresPerPixel: number;
  /** the view's width and height in pixels */
  size: Vec2;
};

/** What the top of a map view points to: the north of the scene's map, or where the camera looks. */
export type MapOrientation = 'north-up' | 'heading-up';

/** Scene X east, Z south: north, the way up a north-up map, is -Z. */
export const MAP_NORTH: Vec2 = [0, -1];

/**
 * The way up the screen of a map view: north, or the camera's heading.
 *
 * @param orientation what points up
 * @param forward the camera's viewing direction
 * @param up the camera's own up, used where the camera looks (nearly) straight down or up
 *   and its heading is not the viewing direction's
 * @returns a unit vector on the ground (X/Z)
 *
 * @group Utils
 */
export function mapViewUp(
  orientation: MapOrientation,
  forward: Vec3,
  up: Vec3,
): Vec2 {
  if (orientation === 'north-up') return [MAP_NORTH[0], MAP_NORTH[1]];
  let x = forward[0];
  let z = forward[2];
  let length = Math.hypot(x, z);
  // Past ~70° of pitch the viewing direction says little: the camera's up leans the way the
  // screen's top points (and the other way looking up).
  if (length < 0.35) {
    const sign = forward[1] > 0 ? -1 : 1;
    x = up[0] * sign;
    z = up[2] * sign;
    length = Math.hypot(x, z);
  }
  if (length < 1e-9) return [MAP_NORTH[0], MAP_NORTH[1]];
  return [x / length, z / length];
}

/** Where scene X/Z `[x, z]` lands in pixels in `view`, `[column, row]` from its top left. */
export function mapViewToPixel(view: MapView, x: number, z: number): Vec2 {
  const dx = x - view.center[0];
  const dz = z - view.center[1];
  // right = (-upZ, upX): east when north is up.
  const right = -dx * view.up[1] + dz * view.up[0];
  const ahead = dx * view.up[0] + dz * view.up[1];
  return [
    view.size[0] / 2 + right / view.metresPerPixel,
    view.size[1] / 2 - ahead / view.metresPerPixel,
  ];
}

/** The scene X/Z at pixel `[column, row]` of `view`: the reverse of {@link mapViewToPixel}. */
export function mapViewFromPixel(
  view: MapView,
  column: number,
  row: number,
): Vec2 {
  const right = (column - view.size[0] / 2) * view.metresPerPixel;
  const ahead = (view.size[1] / 2 - row) * view.metresPerPixel;
  return [
    view.center[0] + right * -view.up[1] + ahead * view.up[0],
    view.center[1] + right * view.up[0] + ahead * view.up[1],
  ];
}

/**
 * Scene X/Z at the corners of a grid of `divisions` x `divisions` cells over `view`, row by
 * row from its top left: `(divisions + 1)²` points, for a mesh whose vertices carry the
 * longitude and latitude there (the map is a flat similarity of the scene, but the Earth is
 * not flat).
 */
export function mapViewGrid(view: MapView, divisions: number): Vec2[] {
  const points: Vec2[] = [];
  for (let j = 0; j <= divisions; j++) {
    for (let i = 0; i <= divisions; i++) {
      points.push(
        mapViewFromPixel(
          view,
          (i / divisions) * view.size[0],
          (j / divisions) * view.size[1],
        ),
      );
    }
  }
  return points;
}

/**
 * Ground metres a pixel spans when `extent` metres fill the shorter side of a view of
 * `size` pixels, so the same extent shows the same ground in a wide minimap and a tall one.
 */
export function mapViewMetresPerPixel(extent: number, size: Vec2): number {
  return extent / Math.max(Math.min(size[0], size[1]), 1);
}

/**
 * The extent an adaptive minimap shows from `altitude` metres over the sea: `factor` times
 * as many metres as it is high — so what lies under the camera, and as far out as it can
 * see it, fills the map — between the range's ends.
 *
 * @param altitude the camera's height over the sea; below 0 counts as 0
 * @param range the least and the most metres it shows
 * @param factor extent per metre of altitude
 *
 * @group Utils
 */
export function adaptiveMapExtent(
  altitude: number,
  range: readonly [number, number],
  factor: number,
): number {
  return Math.min(
    Math.max(Math.max(altitude, 0) * factor, range[0]),
    Math.max(range[0], range[1]),
  );
}

/**
 * The level of `extents` (ascending metres) one step in or out from `extent`, which need
 * not be one of them (an adaptive map's is not): the next smaller, `direction` `1` (zoom in),
 * or the next larger, `-1` (zoom out), staying at the end of the list.
 *
 * @returns the level's index in `extents`
 *
 * @group Utils
 */
export function stepMapZoom(
  extents: readonly number[],
  extent: number,
  direction: 1 | -1,
): number {
  const last = extents.length - 1;
  // A level within a hair of the extent is the extent: the step goes past it.
  const epsilon = extent * 1e-3;
  if (direction > 0) {
    for (let i = last; i >= 0; i--) if (extents[i] < extent - epsilon) return i;
    return 0;
  }
  for (let i = 0; i <= last; i++) if (extents[i] > extent + epsilon) return i;
  return last;
}

/**
 * Ease `current` toward `target` over `seconds` of frames of `dt` seconds, frame-rate
 * independently, in logarithmic space: a zoom is a ratio, so it glides as much per second
 * zooming out as in. Snaps once within a thousandth.
 *
 * @param seconds the time to close all but 1/e of the gap; 0 or less jumps
 *
 * @group Utils
 */
export function easeMapExtent(
  current: number,
  target: number,
  dt: number,
  seconds: number,
): number {
  if (seconds <= 0 || current <= 0 || target <= 0) return target;
  const next = Math.exp(
    Math.log(current) +
      (Math.log(target) - Math.log(current)) * (1 - Math.exp(-dt / seconds)),
  );
  return Math.abs(next / target - 1) < 1e-3 ? target : next;
}

/**
 * A round length for a scale bar: 1, 2 or 5 times a power of ten metres, the longest that
 * fits `targetPixels` (or the shortest, where none does) at `metresPerPixel`.
 *
 * @returns its length in metres, and in pixels at that scale
 *
 * @group Utils
 */
export function niceScaleLength(
  metresPerPixel: number,
  targetPixels: number,
): { metres: number; pixels: number } {
  const raw = Math.max(metresPerPixel * targetPixels, 1e-9);
  const power = 10 ** Math.floor(Math.log10(raw));
  const lead = raw / power;
  const metres = (lead >= 5 ? 5 : lead >= 2 ? 2 : 1) * power;
  return { metres, pixels: metres / metresPerPixel };
}

/**
 * How a map reads heights and places points over the sea: flat (`flatMapSurface`), or on a
 * `Scenery`'s globe (`globeMapSurface`), where far from the field scene Y is not height and
 * a point's scene X/Z is not quite the map's point under it.
 *
 * @group Utils
 */
export type MapSurface = {
  /** the height of `point` over the sea, metres */
  altitude(point: Vec3): number;
  /** the map's point (scene X/Z) under `point` */
  foot(point: Vec3): Vec2;
  /** the point `height` metres over the sea at map X/Z */
  place(x: number, z: number, height: number): Vec3;
};

/**
 * The flat {@link MapSurface}: the sea is the plane Y = `level`, heights are Y over it.
 *
 * @group Utils
 */
export function flatMapSurface(level = 0): MapSurface {
  return {
    altitude: point => point[1] - level,
    foot: point => [point[0], point[2]],
    place: (x, z, height) => [x, level + height, z],
  };
}

/**
 * The camera's and its target's positions after the user drops one of their markers at `at`
 * (map X/Z) on a minimap, on `surface`: the heights over the sea stay what they are, for both.
 * - `'target'`: the camera stays and looks at the new point.
 * - `'camera'`: the camera is moved there and takes its target along, so the view is the
 *   same from the new place.
 *
 * @group Utils
 */
export function dropMarkerOn(
  surface: MapSurface,
  kind: 'camera' | 'target',
  camera: Vec3,
  target: Vec3,
  at: Vec2,
): { camera: Vec3; target: Vec3 } {
  const targetHeight = surface.altitude(target);
  if (kind === 'target')
    return {
      camera: [...camera],
      target: surface.place(at[0], at[1], targetHeight),
    };
  const from = surface.foot(camera);
  const under = surface.foot(target);
  return {
    camera: surface.place(at[0], at[1], surface.altitude(camera)),
    target: surface.place(
      under[0] + at[0] - from[0],
      under[1] + at[1] - from[1],
      targetHeight,
    ),
  };
}

/**
 * {@link dropMarkerOn} a flat sea: only X/Z change, the heights stay.
 *
 * @group Utils
 */
export function dropMarker(
  kind: 'camera' | 'target',
  camera: Vec3,
  target: Vec3,
  at: Vec2,
): { camera: Vec3; target: Vec3 } {
  return dropMarkerOn(flatMapSurface(), kind, camera, target, at);
}

/**
 * The camera's and its target's positions after the user sets the height of one of them,
 * `kind`, to `height` metres over the sea of `surface`:
 * - `'camera'`: the camera goes there, straight up or down where it is, and takes its target
 *   along by the same move, so it looks the same way, at the same angle, from the new height.
 * - `'target'`: only the target moves, so the camera stays and its view tilts.
 *
 * @group Utils
 */
export function setMarkerHeight(
  surface: MapSurface,
  kind: 'camera' | 'target',
  camera: Vec3,
  target: Vec3,
  height: number,
): { camera: Vec3; target: Vec3 } {
  if (kind === 'target') {
    const [x, z] = surface.foot(target);
    return { camera: [...camera], target: surface.place(x, z, height) };
  }
  const [x, z] = surface.foot(camera);
  const moved = surface.place(x, z, height);
  return {
    camera: moved,
    target: [
      target[0] + moved[0] - camera[0],
      target[1] + moved[1] - camera[1],
      target[2] + moved[2] - camera[2],
    ],
  };
}

/**
 * {@link setMarkerHeight} over a flat sea at Y = 0: `y` is scene Y.
 *
 * @group Utils
 */
export function setMarkerAltitude(
  kind: 'camera' | 'target',
  camera: Vec3,
  target: Vec3,
  y: number,
): { camera: Vec3; target: Vec3 } {
  return setMarkerHeight(flatMapSurface(), kind, camera, target, y);
}

/**
 * The scene X/Z at the middle of `view` after the pointer is dragged `dx`, `dy` pixels
 * (right and down) with the map under it: the map follows the pointer, so its centre
 * goes the other way.
 *
 * @group Utils
 */
export function mapViewPan(view: MapView, dx: number, dy: number): Vec2 {
  return mapViewFromPixel(view, view.size[0] / 2 - dx, view.size[1] / 2 - dy);
}

/**
 * How far an altitude control is pulled, `-1` to `1`: its knob `dragPixels` from the middle
 * (positive up): none within `deadZone` pixels, then growing with the square of how far it is
 * past it, so a small pull is a fine one, and full from `dragRange` pixels on.
 *
 * @group Utils
 */
export function altitudeRate(
  dragPixels: number,
  dragRange: number,
  deadZone = 4,
): number {
  const past = Math.abs(dragPixels) - deadZone;
  if (past <= 0 || dragRange <= deadZone) return 0;
  const push = Math.min(past / (dragRange - deadZone), 1);
  return Math.sign(dragPixels) * push * push;
}

/**
 * How many times faster than its top speed an altitude control goes after its knob has been
 * held at the end of its travel for `heldSeconds`: 1 until then, doubling every
 * `doublingSeconds`, up to `maxFactor`.
 *
 * @group Utils
 */
export function boostFactor(
  heldSeconds: number,
  doublingSeconds: number,
  maxFactor: number,
): number {
  if (!(heldSeconds > 0) || !(doublingSeconds > 0)) return 1;
  return Math.min(2 ** (heldSeconds / doublingSeconds), Math.max(maxFactor, 1));
}

/**
 * A height moved for `dt` seconds at `velocity` metres a second, in a straight line. It stays
 * in the range: a height already outside it can move back toward it, and no farther out.
 *
 * @group Utils
 */
export function moveAltitude(
  height: number,
  velocity: number,
  dt: number,
  range: readonly [number, number],
): number {
  return Math.min(
    Math.max(height + velocity * dt, Math.min(range[0], height)),
    Math.max(range[1], height),
  );
}

/**
 * Where the ray from `origin` along `direction` meets the sea's level, as scene X/Z: the
 * ground a camera looks at. A ray that does not go down to it gives `origin`'s own X/Z; one
 * that meets it farther than `maxDistance` metres off along the ground, the point
 * `maxDistance` along its heading.
 *
 * @param origin the camera's position
 * @param direction the way it looks (need not be a unit vector)
 * @param level the sea's height (Y)
 * @param maxDistance the farthest point it gives, metres from `origin` along the ground
 *
 * @group Utils
 */
export function rayAtSeaLevel(
  origin: Vec3,
  direction: Vec3,
  level: number,
  maxDistance = 1e6,
): Vec2 {
  const flat = Math.hypot(direction[0], direction[2]);
  if (flat < 1e-9 || origin[1] <= level || direction[1] >= -1e-9)
    return [origin[0], origin[2]];
  // Metres along the ground per metre of height lost.
  const reach = Math.min(
    ((origin[1] - level) * flat) / -direction[1],
    maxDistance,
  );
  const scale = reach / flat;
  return [origin[0] + direction[0] * scale, origin[2] + direction[2] * scale];
}
