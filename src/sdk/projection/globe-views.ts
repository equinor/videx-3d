import { Plane, Ray, Sphere, Vector3 } from 'three';
import type { CameraView } from '../utils/camera';
import type { Globe } from './globe';

/**
 * Views over a {@link Globe}: the whole Earth, and a place on its ground, for a camera to go
 * to (`CameraNavigator`).
 *
 * @module
 */

/**
 * The ground's height over the sea, in metres, at a longitude and latitude (degrees); null
 * where it is not known. A relief's tiles answer it (the `World`'s, as drawn).
 *
 * @group Utils
 */
export type GroundHeightAt = (
  longitude: number,
  latitude: number,
) => number | null;

/** How high over the point under the camera {@link earthView} looks from, metres. */
export const EARTH_VIEW_HEIGHT = 4000000;

/** How far {@link overlookView} keeps the camera over the ground under it, metres. */
const CLEARANCE = 50;
/** How far below the sea {@link traceGlobeSurface} follows a view: over the disc, the sea's plane lies below the globe's sphere. */
const SEA_MARGIN = 2000;
const DEG = Math.PI / 180;

const geographic = { latitude: 0, longitude: 0 };
const probe = new Vector3();
const hit = new Vector3();
const sphere = new Sphere();
const plane = new Plane();

/**
 * The Earth's axis, south to north, in the scene: from the conformal sphere's latitude at the
 * disc's centre, along the up and true north there; the scene's up without a frame.
 *
 * @group Utils
 */
export function earthAxis(globe: Globe, out: Vector3): Vector3 {
  const conformal = globe.uniforms.uGlobeSphere.value;
  if (conformal.w > 0.5)
    out
      .copy(globe.up)
      .multiplyScalar(conformal.x)
      .addScaledVector(globe.north, conformal.y);
  else out.copy(globe.up);
  return out.normalize();
}

/**
 * North, level, at `point`: along the Earth's axis as it lies over the ground there, or the
 * globe's true north where the axis stands straight up.
 *
 * @group Utils
 */
export function northAt(globe: Globe, point: Vector3, out: Vector3): Vector3 {
  const up = globe.upAt(point, probe);
  earthAxis(globe, out);
  out.addScaledVector(up, -out.dot(up));
  if (out.lengthSq() < 1e-8)
    out.copy(globe.north).addScaledVector(up, -globe.north.dot(up));
  return out.normalize();
}

/**
 * The whole Earth: `height` over the point under `from`, looking at the Earth's centre, its up
 * along the Earth's axis, so orbiting turns the globe about its poles. Null while the globe is
 * flat (`enabled` off).
 *
 * @group Utils
 */
export function earthView(
  globe: Globe,
  from: Vector3,
  height = EARTH_VIEW_HEIGHT,
): CameraView | null {
  if (!globe.enabled) return null;
  const centre = globe.centre;
  const axis = earthAxis(globe, new Vector3());
  const out = from.clone().sub(centre);
  if (out.lengthSq() < 1) out.copy(globe.up);
  out.normalize();
  // Never straight down the axis, where the orbit has no bearing.
  if (Math.abs(out.dot(axis)) > 0.995)
    out
      .addScaledVector(
        new Vector3().crossVectors(axis, globe.north).normalize(),
        0.1,
      )
      .normalize();
  const position = centre.clone().addScaledVector(out, globe.radius + height);
  return {
    position: position.toArray(),
    target: centre.toArray(),
    up: axis.toArray(),
  };
}

/**
 * The ground's height over the sea under `point`, metres: `heightAt` there, never below the
 * sea; the sea's (0) without it, or without the globe's frame to read latitude and longitude by.
 *
 * @group Utils
 */
export function groundUnder(
  globe: Globe,
  heightAt: GroundHeightAt | null,
  point: Vector3,
): number {
  if (!heightAt || !globe.frame) return 0;
  globe.geographic(point, geographic);
  return Math.max(heightAt(geographic.longitude, geographic.latitude) ?? 0, 0);
}

// How far along `ray` it comes down to `height` over the sea: on the globe's sphere (beyond the
// disc; over it the sea's plane lies lower, which the margins take in), or its plane while the
// globe is flat. 0 from below it; where the ray never comes down to it, where it comes closest
// (on the globe) or null.
function reachAlong(globe: Globe, ray: Ray, height: number): number | null {
  if (globe.enabled) {
    const radius = globe.radius + height;
    if (ray.origin.distanceTo(globe.centre) <= radius) return 0;
    if (ray.intersectSphere(sphere.set(globe.centre, radius), hit))
      return ray.origin.distanceTo(hit);
    return Math.max(
      probe.subVectors(globe.centre, ray.origin).dot(ray.direction),
      0,
    );
  }
  if (globe.altitude(ray.origin) <= height) return 0;
  if (
    ray.intersectPlane(
      plane.setFromNormalAndCoplanarPoint(
        globe.up,
        probe.copy(globe.discCentre).addScaledVector(globe.up, height),
      ),
      hit,
    )
  )
    return ray.origin.distanceTo(hit);
  return null;
}

/**
 * Where a view along `ray` first meets the ground or the sea over the globe: stepped from
 * where it comes down to the highest ground (`highest`, metres over the sea) to just past the
 * sea, then halved. The ground is `heightAt` (a relief's), the sea where it has none. Null
 * where the view meets neither (into the sky).
 *
 * @group Utils
 */
export function traceGlobeSurface(
  globe: Globe,
  ray: Ray,
  heightAt: GroundHeightAt | null,
  highest = 0,
): Vector3 | null {
  const at = new Vector3();
  const below = (t: number) => {
    ray.at(t, at);
    return globe.altitude(at) <= groundUnder(globe, heightAt, at);
  };
  const start = reachAlong(globe, ray, Math.max(highest, 0) + SEA_MARGIN);
  const end = reachAlong(globe, ray, -SEA_MARGIN);
  if (start === null || end === null || end <= start) return null;
  const steps = heightAt ? 384 : 1;
  let previous = start;
  for (let i = 0; i <= steps; i++) {
    const t = start + ((end - start) * i) / steps;
    if (below(t)) {
      if (i === 0) return ray.at(t, new Vector3());
      let a = previous;
      let b = t;
      for (let k = 0; k < 32; k++) {
        const m = 0.5 * (a + b);
        if (below(m)) b = m;
        else a = m;
      }
      return ray.at(b, new Vector3());
    }
    previous = t;
  }
  return null;
}

/**
 * A view of `point` from `distance` away along `heading` (level there), `pitch` degrees down,
 * steeper where the ground in between would hide it or the camera would stand in it: the
 * camera kept over the ground under it. Its up is the globe's for a view from there
 * (`lookUp`).
 *
 * @group Utils
 */
export function overlookView(
  globe: Globe,
  heightAt: GroundHeightAt | null,
  point: Vector3,
  heading: Vector3,
  distance: number,
  pitch = 30,
): CameraView {
  const up = globe.upAt(point, new Vector3());
  const bearing = heading.clone().addScaledVector(up, -heading.dot(up));
  if (bearing.lengthSq() < 1e-8)
    bearing.copy(globe.north).addScaledVector(up, -globe.north.dot(up));
  bearing.normalize();
  const position = new Vector3();
  const between = new Vector3();
  for (let degrees = pitch; degrees <= 85; degrees += 5) {
    const angle = degrees * DEG;
    position
      .copy(point)
      .addScaledVector(bearing, -Math.cos(angle) * distance)
      .addScaledVector(up, Math.sin(angle) * distance);
    between.lerpVectors(point, position, 0.5);
    if (
      globe.altitude(position) >=
        groundUnder(globe, heightAt, position) + CLEARANCE &&
      globe.altitude(between) >= groundUnder(globe, heightAt, between)
    )
      break;
  }
  return {
    position: position.toArray(),
    target: point.toArray(),
    up: globe.lookUp(position, new Vector3()).toArray(),
  };
}
