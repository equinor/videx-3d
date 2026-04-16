import {
  Camera,
  DoubleSide,
  NoBlending,
  Object3D,
  Scene,
  ShaderMaterial,
  Uniform,
  WebGLRenderer,
} from 'three';
import { BufferGeometry } from 'three/webgpu';
import { RenderableObject } from './EventEmitter';
import { Emitter, Listener } from './EventEmitterContext';
import fragmentShader from './shaders/pick_frag.glsl';
import vertexShader from './shaders/pick_vertex.glsl';

export class PickingMaterial extends ShaderMaterial {
  listeners = new Map<number, Listener>();
  emitters = new Map<number, Emitter>();
  currentObjectMap: Array<number> | null = null;

  constructor() {
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        emitterId: new Uniform(0),
        side: new Uniform(2),
      },
      toneMapped: false,
      blending: NoBlending,
      side: DoubleSide,
      forceSinglePass: true,
    });
  }

  dispose(): void {
    super.dispose();
    this.listeners.clear();
    this.emitters.clear();
  }

  onBeforeRender(
    _renderer: WebGLRenderer,
    _scene: Scene,
    _camera: Camera,
    _geometry: BufferGeometry,
    object: Object3D,
  ): void {
    const emitter = this.emitters.get(object.id);
    if (this.currentObjectMap && emitter) {
      const emitterInstanceId = this.currentObjectMap.length / 2;

      this.currentObjectMap.push(object.id, 0);
      for (let i = 1; i < emitter.instanceCount; i++) {
        this.currentObjectMap.push(object.id, i);
      }
      this.uniforms.emitterId.value = emitterInstanceId + 1;
    } else {
      this.uniforms.emitterId.value = 0;
    }
    const renderableObject = object as RenderableObject;
    this.uniforms.side.value = renderableObject.material.side;

    this.uniformsNeedUpdate = true;
  }
}
