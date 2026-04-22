import {
  MeshStandardMaterial,
  MeshStandardMaterialParameters,
  Uniform,
  WebGLProgramParametersWithUniforms,
} from 'three';

import vertexShader from './shaders/vertex.glsl';

export class CasingMaterial extends MeshStandardMaterial {
  uniforms = {
    sizeMultiplier: new Uniform(1),
    radius: new Uniform(0),
    innerRadius: new Uniform(0),
    sliceOffset: new Uniform(0),
    sliceAngle: new Uniform(0),
    autoSlicePosition: new Uniform(false),
  };
  constructor(params: MeshStandardMaterialParameters = {}) {
    super(params);
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

  onBeforeCompile(parameters: WebGLProgramParametersWithUniforms): void {
    parameters.uniforms.sizeMultiplier = this.uniforms.sizeMultiplier;
    parameters.uniforms.radius = this.uniforms.radius;
    parameters.uniforms.innerRadius = this.uniforms.innerRadius;
    parameters.uniforms.sliceOffset = this.uniforms.sliceOffset;
    parameters.uniforms.sliceAngle = this.uniforms.sliceAngle;
    parameters.uniforms.autoSlicePosition = this.uniforms.autoSlicePosition;

    parameters.vertexShader = vertexShader;

    //console.log(parameters.vertexShader);
  }
}
