import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  setFrustumFromMatrix,
  standardNdcZ,
} from '../src/sdk/utils/depth-buffer';

// A camera as three leaves it after its first render with a reversed depth buffer.
function reversedCamera() {
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
  (camera as unknown as { _reversedDepth: boolean })._reversedDepth = true;
  camera.updateProjectionMatrix();
  return camera;
}

describe('depth buffer helpers', () => {
  it('culls past the far plane of a reversed projection', () => {
    const camera = reversedCamera();
    camera.updateMatrixWorld();
    const matrix = new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    const frustum = setFrustumFromMatrix(new Frustum(), matrix, camera);
    expect(frustum.containsPoint(new Vector3(0, 0, -500))).toBe(true);
    expect(frustum.containsPoint(new Vector3(0, 0, -1500))).toBe(false);
    expect(frustum.containsPoint(new Vector3(0, 0, -0.05))).toBe(false);
  });

  it('turns a reversed NDC z into the standard one, behind the camera too', () => {
    const reversed = reversedCamera();
    const standard = new PerspectiveCamera(60, 1, 0.1, 1000);
    for (const z of [-0.1, -1, -50, -999, -1000, 5]) {
      const r = new Vector3(0, 0, z).project(reversed).z;
      const s = new Vector3(0, 0, z).project(standard).z;
      expect(standardNdcZ(r, reversed)).toBeCloseTo(s, 5);
      expect(standardNdcZ(s, standard)).toBe(s);
    }
  });
});
