import { Mesh, Object3D, Vector3 } from 'three';
import { CameraManager } from '../../sdk/managers/CameraManager';
import type { Globe } from '../../sdk/projection/globe';
import { Vec2, Vec3 } from '../../sdk/types/common';

/**
 * The sky's globe, from the scene: Storybook's helpers lie outside the `Sky`. Null without
 * one.
 */
export function findSceneGlobe(scene: Object3D): Globe | null {
  let globe: Globe | null = null;
  scene.traverse(object => {
    if (globe) return;
    const material = (object as Mesh).material as
      | { isSkyMaterial?: boolean; globe?: Globe }
      | undefined;
    if (material && !Array.isArray(material) && material.isSkyMaterial)
      globe = material.globe ?? null;
  });
  return globe;
}

/** `window.videx3d.globe`: the sky's globe in plain arrays, for poses far from the field. */
export type Videx3dGlobe = {
  /** the point `height` over the sea at map X/Z (`Globe.place`) */
  place: (x: number, z: number, height?: number) => Vec3 | null;
  /** the map point under `point`, at the sea's level (`Globe.foot`) */
  foot: (point: Vec3) => Vec3 | null;
  /** `point`'s height over the sea (`Globe.altitude`) */
  altitude: (point: Vec3) => number | null;
  /** up at `point` (`Globe.upAt`) */
  up: (point: Vec3) => Vec3 | null;
  /**
   * `camera.orbit` about the point `height` over the sea at map `at`, its angles about the
   * up there: `azimuth` from the map's +X toward +Z, `polar` from straight down (0) to
   * level (90). The controls keep the scene's up, so far off the view rolls a little.
   */
  orbit: (options: {
    at: Vec2;
    height?: number;
    azimuth: number;
    polar: number;
    distance: number;
    transition?: boolean;
  }) => Promise<void>;
};

const vec = (v: Vector3): Vec3 => [v.x, v.y, v.z];
const RAD = Math.PI / 180;

/**
 * The globe's slice of `window.videx3d`. Each call finds the globe again, so it follows the
 * story the frame shows; every answer is null without a `Sky`.
 */
export function videx3dGlobe(
  scene: Object3D,
  camera: CameraManager,
): Videx3dGlobe {
  const at = (point: Vec3) => new Vector3(...point);
  return {
    place: (x, z, height = 0) => {
      const globe = findSceneGlobe(scene);
      return globe ? vec(globe.place(x, z, height, new Vector3())) : null;
    },
    foot: point => {
      const globe = findSceneGlobe(scene);
      return globe ? vec(globe.foot(at(point), new Vector3())) : null;
    },
    altitude: point => findSceneGlobe(scene)?.altitude(at(point)) ?? null,
    up: point => {
      const globe = findSceneGlobe(scene);
      return globe ? vec(globe.upAt(at(point), new Vector3())) : null;
    },
    orbit: async ({
      at: [x, z],
      height = 0,
      azimuth,
      polar,
      distance,
      ...rest
    }) => {
      const globe = findSceneGlobe(scene);
      if (!globe) return;
      const target = globe.place(x, z, height, new Vector3());
      const up = globe.upAt(target, new Vector3());
      // The map's X and Z laid on the level there.
      const east = new Vector3(1, 0, 0).addScaledVector(up, -up.x).normalize();
      const south = new Vector3().crossVectors(east, up);
      const level = distance * Math.sin(polar * RAD);
      const position = target
        .clone()
        .addScaledVector(east, level * Math.cos(azimuth * RAD))
        .addScaledVector(south, level * Math.sin(azimuth * RAD))
        .addScaledVector(up, distance * Math.cos(polar * RAD));
      return camera.lookAt({
        position: vec(position),
        target: vec(target),
        transition: rest.transition,
      });
    },
  };
}
