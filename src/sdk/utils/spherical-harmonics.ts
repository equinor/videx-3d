import { SphericalHarmonics3, Vector3 } from 'three';

const coord = new Vector3();
const direction = new Vector3();
const basis = new Array<number>(9).fill(0);

/**
 * Project a cube's six faces of linear RGBA floats (`size`² texels each, faces +X −X +Y −Y +Z −Z
 * one after another, rows from the bottom as `readPixels` reads them) onto order-2 spherical
 * harmonics, each texel weighed by the solid angle it spans: what three's
 * `LightProbeGenerator.fromCubeRenderTarget` works out from a cube target, for pixels read without
 * it (see `readFloatTargetAsync`). `flip` -1 for a WebGL renderer's cube (its coordinate system),
 * 1 for WebGPU's.
 *
 * @group SDK
 */
export function cubeFacesToSphericalHarmonics(
  pixels: Float32Array,
  size: number,
  flip = -1,
  target = new SphericalHarmonics3(),
): SphericalHarmonics3 {
  const sh = target.zero();
  const coefficients = sh.coefficients;
  const texel = 2 / size;
  const face = size * size * 4;
  let total = 0;
  for (let f = 0; f < 6; f++)
    for (let i = 0; i < face; i += 4) {
      const p = i / 4;
      const col = (1 - ((p % size) + 0.5) * texel) * flip;
      const row = 1 - (Math.floor(p / size) + 0.5) * texel;
      switch (f) {
        case 0:
          coord.set(-1 * flip, row, col * flip);
          break;
        case 1:
          coord.set(1 * flip, row, -col * flip);
          break;
        case 2:
          coord.set(col, 1, -row);
          break;
        case 3:
          coord.set(col, -1, row);
          break;
        case 4:
          coord.set(col, row, 1);
          break;
        default:
          coord.set(-col, row, -1);
      }
      const lengthSq = coord.lengthSq();
      const weight = 4 / (Math.sqrt(lengthSq) * lengthSq);
      total += weight;
      SphericalHarmonics3.getBasisAt(direction.copy(coord).normalize(), basis);
      const at = f * face + i;
      const r = pixels[at] * weight;
      const g = pixels[at + 1] * weight;
      const b = pixels[at + 2] * weight;
      for (let j = 0; j < 9; j++) {
        coefficients[j].x += basis[j] * r;
        coefficients[j].y += basis[j] * g;
        coefficients[j].z += basis[j] * b;
      }
    }
  const norm = (4 * Math.PI) / total;
  for (const c of coefficients) c.multiplyScalar(norm);
  return sh;
}
