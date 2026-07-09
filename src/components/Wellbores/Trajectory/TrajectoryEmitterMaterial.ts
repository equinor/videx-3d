import type { BufferGeometry } from 'three';
import {
  Camera,
  Object3D,
  Scene,
  Uniform,
  Vector2,
  WebGLRenderer,
} from 'three';
import { CustomPickingMaterial } from '../../EventEmitter/picking-material';
import vertexShader from './shaders/emitter-vertex.glsl';

const _size = new Vector2();

/**
 * GPU-picking material for the unified {@link Trajectory}. It reconstructs the exact
 * same instanced tube + caps geometry as the visual material (radius uniform + the
 * screen-space `minPixelRadius` floor), so the pick silhouette matches what is drawn.
 *
 * Keep `radius`, `minPixelRadius` and `sizeMultiplier` in sync with the visual
 * material. `resolution` is managed automatically in {@link onBeforeRender}.
 */
export class TrajectoryEmitterMaterial extends CustomPickingMaterial {
  constructor() {
    super(vertexShader, {
      sizeMultiplier: new Uniform(1),
      radius: new Uniform(0),
      minPixelRadius: new Uniform(1),
      resolution: new Uniform(new Vector2(1, 1)),
    });
  }

  get sizeMultiplier() {
    return this.uniforms.sizeMultiplier.value;
  }

  set sizeMultiplier(v: number) {
    this.uniforms.sizeMultiplier.value = v;
  }

  get radius() {
    return this.uniforms.radius.value;
  }

  set radius(v: number) {
    this.uniforms.radius.value = v;
  }

  get minPixelRadius() {
    return this.uniforms.minPixelRadius.value;
  }

  set minPixelRadius(v: number) {
    this.uniforms.minPixelRadius.value = v;
  }

  onBeforeRender(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    geometry: BufferGeometry,
    object: Object3D,
  ): void {
    super.onBeforeRender(renderer, scene, camera, geometry, object);

    // Picking renders a tiny `setViewOffset` patch into a small render target, which
    // scales the projection by (fullSize / patchSize). Feeding the ACTUAL target size
    // to the floor cancels that scaling exactly, so `minPixelRadius` yields the same
    // world radius as on screen and thin far-field lines stay pickable. (Casings need
    // no such handling because they have no screen-space floor.)
    const target = renderer.getRenderTarget();
    if (target) {
      _size.set(target.width, target.height);
    } else {
      renderer.getDrawingBufferSize(_size);
    }

    const res = this.uniforms.resolution.value as Vector2;
    if (res.x !== _size.x || res.y !== _size.y) {
      res.copy(_size);
      this.uniformsNeedUpdate = true;
    }
  }
}
