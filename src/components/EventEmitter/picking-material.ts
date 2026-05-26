import {
  Camera,
  DoubleSide,
  NoBlending,
  Object3D,
  Scene,
  ShaderMaterial,
  Uniform,
  UniformsUtils,
  WebGLRenderer,
} from 'three';
import { BufferGeometry } from 'three/webgpu';
import { RenderableObject } from './EventEmitter';
import fragmentShader from './shaders/pick_frag.glsl';
import vertexShader from './shaders/pick_vertex.glsl';

export const pickingMaterialUniforms = {
  emitterId: new Uniform(0),
  side: new Uniform(2),
};

export class PickingMaterial extends ShaderMaterial {
  constructor() {
    super({
      vertexShader,
      fragmentShader,
      uniforms: { ...pickingMaterialUniforms },
      toneMapped: false,
      blending: NoBlending,
      side: DoubleSide,
      forceSinglePass: true,
    });
  }

  dispose(): void {
    super.dispose();
  }

  onBeforeRender(
    _renderer: WebGLRenderer,
    _scene: Scene,
    _camera: Camera,
    _geometry: BufferGeometry,
    object: Object3D,
  ): void {
    const renderableObject = object as RenderableObject;
    const emitterId = object.userData.__emitterID || 0;
    const needsUpdate =
      this.uniforms.emitterId.value !== emitterId ||
      this.uniforms.side.value !== renderableObject.material.side;

    if (needsUpdate) {
      this.uniforms.emitterId.value = emitterId;
      this.uniforms.side.value = renderableObject.material.side;
      this.uniformsNeedUpdate = true;
    }
  }
}

export class CustomPickingMaterial extends PickingMaterial {
  constructor(vertexShader?: string, uniforms?: Record<string, Uniform>) {
    super();
    if (vertexShader) this.vertexShader = vertexShader;
    if (uniforms) {
      this.uniforms = UniformsUtils.merge([this.uniforms, uniforms]);
    }
    this.allowOverride = false;
  }
}
