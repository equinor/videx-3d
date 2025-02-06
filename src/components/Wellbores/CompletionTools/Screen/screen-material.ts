import { Color, ShaderLib, ShaderMaterial, Uniform, UniformsUtils } from 'three'
import vertexShader from './shaders/vertex.glsl'
import fragmentShader from './shaders/fragment.glsl'

export class ScreenMaterial extends ShaderMaterial {
  constructor(params:any = {}) {
    super({
      uniforms: UniformsUtils.merge([
        UniformsUtils.clone( ShaderLib['lambert'].uniforms),
        {
          uColor1: new Uniform(new Color(params.color || 'white')),
          uColor2: new Uniform(new Color(params.color || 'black')),
        },
      ]),
      vertexShader,
      fragmentShader,
    })

    this.setValues(params)

    this.lights = true
  } 

  get color1() {
    return this.uniforms.uColor1.value
  }

  set color1(value:any) {
    this.uniforms.uColor1.value.set(value)
  }

  get color2() {
    return this.uniforms.uColor2.value
  }

  set color2(value:any) {
    this.uniforms.uColor2.value.set(value)
  }
}