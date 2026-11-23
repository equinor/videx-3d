import {
  BufferGeometry,
  CubeTexture,
  Float32BufferAttribute,
  FloatType,
  Mesh,
  NearestFilter,
  NoBlending,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SphericalHarmonics3,
  Texture,
  Uniform,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { createClipSpaceCamera } from './depth-buffer';
import { readFloatTargetAsync } from './read-target-async';
import { renderAside } from './render-aside';

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

const projectorVertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// A texel a coefficient (x) and a cube face (y): the face's texels' light times the
// coefficient's basis along them, each weighed by the solid angle it spans (rgb), and those
// weights (a). Sampled by direction at each texel's centre, so exactly, whatever the face's
// layout. uSize a uniform: ANGLE unrolls a loop of constant count.
const projectorFragmentShader = /* glsl */ `
uniform samplerCube uCube;
uniform int uSize;

// Order-2 spherical harmonics' basis j along d, as three's SphericalHarmonics3.getBasisAt.
float shBasis(int j, vec3 d) {
  if(j == 0) return 0.282095;
  if(j == 1) return 0.488603 * d.y;
  if(j == 2) return 0.488603 * d.z;
  if(j == 3) return 0.488603 * d.x;
  if(j == 4) return 1.092548 * d.x * d.y;
  if(j == 5) return 1.092548 * d.y * d.z;
  if(j == 6) return 0.315392 * (3.0 * d.z * d.z - 1.0);
  if(j == 7) return 1.092548 * d.x * d.z;
  return 0.546274 * (d.x * d.x - d.y * d.y);
}

void main() {
  int j = int(gl_FragCoord.x);
  int face = int(gl_FragCoord.y);
  float texel = 2.0 / float(uSize);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for(int y = 0; y < uSize; y++) {
    float v = -1.0 + (float(y) + 0.5) * texel;
    for(int x = 0; x < uSize; x++) {
      float u = -1.0 + (float(x) + 0.5) * texel;
      vec3 c = face == 0 ? vec3(1.0, v, -u) : face == 1 ? vec3(-1.0, v, u) : face == 2 ? vec3(u, 1.0, -v) : face == 3 ? vec3(u, -1.0, v) : face == 4 ? vec3(u, v, 1.0) : vec3(-u, v, -1.0);
      float lengthSq = dot(c, c);
      float weight = 4.0 / (sqrt(lengthSq) * lengthSq);
      vec3 d = c * inversesqrt(lengthSq);
      sum += textureLod(uCube, d, 0.0).rgb * (weight * shBasis(j, d));
      total += weight;
    }
  }
  gl_FragColor = vec4(sum, total);
}
`;

/**
 * Projects a cube render target onto order-2 spherical harmonics on the GPU, as
 * {@link cubeFacesToSphericalHarmonics} does on the CPU, and reads back only the result: 9 × 6
 * floats (a coefficient a face) rather than the cube's every texel. Sampled by direction, so
 * in the world's frame as three's materials sample a cube target. The readback is
 * asynchronous (`readFloatTargetAsync`). A light probe of six 32² faces read back whole cost
 * 1.1 ms of GPU a bake, up to 3.7 (RTX A1000, 2026-11-18). Compile it ahead with
 * `renderer.compileAsync(projector.scene, projector.camera)`.
 *
 * @group SDK
 */
export class SphericalHarmonicsProjector {
  /** what it draws, for compiling ahead */
  readonly scene = new Scene();
  readonly camera = createClipSpaceCamera();
  private readonly target = new WebGLRenderTarget(9, 6, {
    type: FloatType,
    format: RGBAFormat,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
  private readonly material = new ShaderMaterial({
    name: 'spherical-harmonics-projector',
    vertexShader: projectorVertexShader,
    fragmentShader: projectorFragmentShader,
    uniforms: {
      uCube: new Uniform<Texture | null>(null),
      uSize: new Uniform(1),
    },
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  });
  private readonly mesh: Mesh;

  constructor() {
    // One triangle over the target.
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /**
   * The harmonics of `cube`, `size`² texels a face, into `target`; resolves once read back.
   * Rejects if the context is lost meanwhile. `renderer`'s target is left as it was.
   */
  project(
    renderer: WebGLRenderer,
    cube: CubeTexture | Texture,
    size: number,
    target = new SphericalHarmonics3(),
  ): Promise<SphericalHarmonics3> {
    const uniforms = this.material.uniforms;
    uniforms.uCube.value = cube;
    uniforms.uSize.value = size;
    renderAside(renderer, () => {
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, this.camera);
    });
    uniforms.uCube.value = null;
    return readFloatTargetAsync(renderer, this.target).then(pixels => {
      const sh = target.zero();
      let total = 0;
      for (let f = 0; f < 6; f++) total += pixels[f * 9 * 4 + 3];
      const norm = (4 * Math.PI) / total;
      sh.coefficients.forEach((c, j) => {
        for (let f = 0; f < 6; f++) {
          const at = (f * 9 + j) * 4;
          c.x += pixels[at];
          c.y += pixels[at + 1];
          c.z += pixels[at + 2];
        }
        c.multiplyScalar(norm);
      });
      return sh;
    });
  }

  /**
   * Dispose of what it holds; its material through `release` (default `dispose`), such as
   * `releaseMaterial`, so it does not go while its program still links.
   */
  dispose(release: (material: ShaderMaterial) => void = m => m.dispose()) {
    this.target.dispose();
    release(this.material);
    this.mesh.geometry.dispose();
  }
}
