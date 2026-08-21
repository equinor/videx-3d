import { Uniform } from 'three';
import { CustomPickingMaterial } from '../../EventEmitter/picking-material';
import vertexShader from './shaders/emitter-vertex.glsl';

export class CasingEmitterMaterial extends CustomPickingMaterial {
  constructor() {
    super(vertexShader, {
      sizeMultiplier: new Uniform(1),
      radius: new Uniform(0),
      innerRadius: new Uniform(0),
      sliceOffset: new Uniform(0),
      sliceAngle: new Uniform(0),
      autoSlicePosition: new Uniform(false),
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

  get innerRadius() {
    return this.uniforms.innerRadius.value;
  }

  set innerRadius(v: number) {
    this.uniforms.innerRadius.value = v;
  }

  get sliceOffset() {
    return this.uniforms.sliceOffset.value;
  }

  set sliceOffset(v: number) {
    this.uniforms.sliceOffset.value = v;
  }

  get sliceAngle() {
    return this.uniforms.sliceAngle.value;
  }

  set sliceAngle(v: number) {
    this.uniforms.sliceAngle.value = v;
  }

  get autoSlicePosition() {
    return this.uniforms.autoSlicePosition.value;
  }

  set autoSlicePosition(v: boolean) {
    this.uniforms.autoSlicePosition.value = !!v;
  }
}
