import {
  Color,
  MeshBasicMaterialParameters,
  ShaderLib,
  ShaderMaterial,
  UniformsUtils,
} from 'three';
import { attachOitVariants } from '../../rendering/oit-material';
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
    attachOitVariants(this);
  }

  get color(): Color {
    return this.uniforms.diffuse.value;
  }

  set color(color: Color) {
    this.uniforms.diffuse.value.set(color);
  }
}
