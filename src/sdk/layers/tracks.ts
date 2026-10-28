import type { Vec2 } from '../types/common';

// ⚠️ Free of three.js.

const EARTH_RADIUS = 6371000;
const DEG = Math.PI / 180;

/**
 * Something that moves over the Earth, as a tracking feed reports it — AIS for a ship,
 * say: where it was at `time`, and its speed and course then.
 *
 * @group Layers
 */
export type Track = {
  id: string | number;
  /** WGS84 degrees */
  longitude: number;
  latitude: number;
  /** over the ground, metres per second. Default 0 */
  speed?: number;
  /** over the ground, degrees clockwise from true north. Default 0 */
  course?: number;
  /** when it was there, milliseconds since the epoch (`Date.now()`); omitted, now */
  time?: number;
};

/**
 * Where a track is `seconds` after its fix, held to its speed and course (dead
 * reckoning): along a rhumb line, which for the minutes between fixes is the course
 * steered. Longitude and latitude in degrees.
 *
 * @group Layers
 */
export function advanceTrack(
  track: Pick<Track, 'longitude' | 'latitude' | 'speed' | 'course'>,
  seconds: number,
  target = { longitude: 0, latitude: 0 },
) {
  const distance = (track.speed ?? 0) * seconds;
  const course = (track.course ?? 0) * DEG;
  const latitude =
    track.latitude + (distance * Math.cos(course)) / EARTH_RADIUS / DEG;
  const mid = ((track.latitude + latitude) / 2) * DEG;
  const longitude =
    track.longitude +
    (distance * Math.sin(course)) /
      (EARTH_RADIUS * Math.max(Math.cos(mid), 1e-6)) /
      DEG;
  target.longitude = longitude;
  target.latitude = latitude;
  return target;
}

/**
 * The heading in a scene of a course over the Earth (degrees clockwise from true north)
 * at `longitude`, `latitude`: radians about +Y, 0 along +X, as `Tanker`'s `heading` and
 * any three.js `rotation.y` take it. Found by carrying a short step along the course into
 * the scene with `toScene` (a `World`'s `geoFrameXZ`, say), so the map's convergence —
 * grid north is not true north away from the map's meridian — is taken into account.
 *
 * @group Layers
 */
export function courseToHeading(
  toScene: (longitude: number, latitude: number) => Vec2,
  longitude: number,
  latitude: number,
  course: number,
): number {
  const step = advanceTrack({ longitude, latitude, speed: 10, course }, 1);
  const [x0, z0] = toScene(longitude, latitude);
  const [x1, z1] = toScene(step.longitude, step.latitude);
  // rotation.y turns +X toward −Z.
  return Math.atan2(-(z1 - z0), x1 - x0);
}

/**
 * Knots to metres per second, as AIS reports speed.
 *
 * @group Layers
 */
export function knots(value: number): number {
  return (value * 1852) / 3600;
}
