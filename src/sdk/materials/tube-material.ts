import {
  Color,
  MeshBasicMaterialParameters,
  ShaderLib,
  ShaderMaterial,
  UniformsUtils,
} from 'three';
import fragmentShader from './shaders/trajectory/fragment.glsl';
import vertexShader from './shaders/trajectory/vertex.glsl';

export class TubeMaterial extends ShaderMaterial {
  isTubeMaterial = true;
  constructor(parameters?: MeshBasicMaterialParameters) {
    super({
      vertexShader,
      fragmentShader,
      uniforms: UniformsUtils.clone(ShaderLib['basic'].uniforms),
      defines: {
        DEPTH_SHADE: true,
      },
      clipping: true,
      fog: true,
    });
    if (parameters) this.setValues(parameters);
  }

  get color(): Color {
    return this.uniforms.diffuse.value;
  }

  set color(color: Color) {
    this.uniforms.diffuse.value.set(color);
  }
}
