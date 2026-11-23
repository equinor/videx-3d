import { Camera, Frustum, Matrix4, WebGLCoordinateSystem } from 'three';

// The depth buffer on the CPU side: what code that culls, projects or reads depth itself
// must allow for, whether the buffer is linear, logarithmic or reversed (see
// documents/architecture.md, "Depth buffers"; the shaders' side is
// sdk/materials/shaderLib/depth.glsl).

/**
 * Whether `camera`'s projection is reversed (depth 1 at the near plane, 0 at the far one), as
 * three makes it for a renderer with a reversed depth buffer (`reversedDepthBuffer`), from
 * the camera's first render on.
 *
 * @group Utils
 */
export function isReversedDepth(camera: Camera): boolean {
  return camera.reversedDepth === true;
}

/**
 * `frustum` set from `matrix` — `camera`'s projection, or that times a view — as three culls
 * with it: a reversed projection's near and far planes are read from it otherwise, and
 * without saying so both come out wrong.
 *
 * @group Utils
 */
export function setFrustumFromMatrix(
  frustum: Frustum,
  matrix: Matrix4,
  camera: Camera,
): Frustum {
  return frustum.setFromProjectionMatrix(
    matrix,
    WebGLCoordinateSystem,
    isReversedDepth(camera),
  );
}

/**
 * The standard NDC z (-1 at the near plane, 1 at the far one) of `z`, a point's NDC z through
 * `camera` (`Vector3.project`): a reversed projection's runs from 1 at the near plane to 0 at
 * the far one. Behind the camera, past -1 or 1 either way, as the standard one.
 *
 * @group Utils
 */
export function standardNdcZ(z: number, camera: Camera): number {
  return isReversedDepth(camera) ? 1 - 2 * z : z;
}

/**
 * three's `logDepthBufFC` for a camera's `far` plane, which a logarithmic depth buffer is
 * written with: 2 / log2(far + 1).
 *
 * @group Utils
 */
export function logDepthFactor(far: number): number {
  return 2 / Math.log2(far + 1);
}

/**
 * A camera for drawing in clip space, its projection the identity, as an offscreen pass
 * drawing a fullscreen triangle uses. With a reversed depth buffer three turns every camera
 * it draws with to a reversed projection, by its `updateProjectionMatrix`, which a plain
 * `Camera` lacks: here it does nothing, the identity having no depth range to turn. ⚠️ What
 * it draws must lie at clip z 0 (inside both a standard and a reversed range).
 *
 * @group Utils
 */
export function createClipSpaceCamera(): Camera {
  const camera = new Camera() as Camera & { updateProjectionMatrix(): void };
  camera.updateProjectionMatrix = () => {};
  return camera;
}
