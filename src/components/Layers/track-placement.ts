import { Matrix4, Quaternion, Vector3 } from 'three';
import { advanceTrack } from '../../sdk/layers/tracks';
import type { Globe } from '../../sdk/projection/globe';
import { globeUprightMatrix } from '../../sdk/projection/place-frame';

const point = new Vector3();
const ahead = new Vector3();
const upThere = new Vector3();
const untilt = new Quaternion();
const step = { longitude: 0, latitude: 0 };

/** What a track's object is given: its X/Z and heading in the frame it is drawn in. */
export type TrackPlacement = { x: number; z: number; heading: number };

/**
 * A track at `longitude`, `latitude` (WGS84, degrees) steering `course` (degrees clockwise
 * from true north), on `globe`, which needs a frame: in `frame` the matrix its object is
 * drawn in (`globeUprightMatrix` at the point `Globe.geodetic` places on the sea's level),
 * and in `target` the object's own X/Z — the point's in the scene, where `useBuoyancy` and
 * the sea's contact foam take it to be — and heading in that frame (radians about +Y, 0
 * along +X), found by carrying a short step along the course onto the globe, so the map's
 * convergence and the Earth's tilt there are both taken into account.
 *
 * Over the globe's disc, and with the globe off, the frame is the identity and the object
 * is drawn flat as before; beyond it, it stands on the curved sea at any distance.
 */
export function placeTrackOnGlobe(
  globe: Globe,
  longitude: number,
  latitude: number,
  course: number,
  frame: Matrix4,
  target: TrackPlacement,
): TrackPlacement {
  globe.geodetic(latitude, longitude, 0, point);
  globeUprightMatrix(globe, point, frame);
  advanceTrack({ longitude, latitude, speed: 10, course }, 1, step);
  globe.geodetic(step.latitude, step.longitude, 0, ahead).sub(point);
  // Into the frame: turned back from the globe's up there to the scene's.
  untilt.setFromUnitVectors(globe.upAt(point, upThere), globe.up);
  ahead.applyQuaternion(untilt);
  target.x = point.x;
  target.z = point.z;
  // rotation.y turns +X toward −Z.
  target.heading = Math.atan2(-ahead.z, ahead.x);
  return target;
}
