import {
  Color,
  MeshLambertMaterialParameters,
  ShaderLib,
  ShaderMaterial,
  Texture,
  Uniform,
  UniformsUtils,
} from 'three'
import fragmentShader from './shaders/ribbon/fragment.glsl'
import vertexShader from './shaders/ribbon/vertex.glsl'

export type RibonMaterialParams = MeshLambertMaterialParameters & {
  angle?: number
  width?: number
  offset?: number
  ignoreLight?: boolean
}

export class RibbonMaterial extends ShaderMaterial {
  isRibbonMaterial = true
  constructor(parameters?: RibonMaterialParams) {
    super({
      vertexShader,
      fragmentShader,
      uniforms: UniformsUtils.merge([
        UniformsUtils.clone(ShaderLib['lambert'].uniforms),
        {
          angle: new Uniform(parameters?.angle || 0),
          width: new Uniform(parameters?.width || 1),
          offset: new Uniform(parameters?.offset || 0),
        },
      ]),
      defines: {
        USE_UV: true,
        NO_LIGHT: !!parameters?.ignoreLight,
      },
      clipping: true,
      fog: true,
      lights: true,
    })
    if (parameters) this.setValues(parameters)
  }

  get color(): Color {
    return this.uniforms.diffuse.value
  }

  set color(color: Color) {
    this.uniforms.diffuse.value.set(color)
  }

  get angle(): number {
    return this.uniforms.angle.value
  }

  set angle(a: number) {
    this.uniforms.angle.value = a
  }

  get offset(): number {
    return this.uniforms.offset.value
  }

  set offset(o: number) {
    this.uniforms.offset.value = o
  }

  get width(): number {
    return this.uniforms.width.value
  }

  set width(w: number) {
    this.uniforms.width.value = w
  }

  get map(): Texture | null {
    return this.uniforms.map.value
  }

  set map(m: Texture | null) {
    this.uniforms.map.value = m
  }

  get ignoreLight() {
    return this.defines.NO_LIGHT
  }

  set ignoreLight(f: boolean) {
    this.defines.NO_LIGHT = f;
    this.needsUpdate = true
  }

  // @ignore
  onBeforeCompile() {
    if (this.map) {
      if (this.map.matrixAutoUpdate === true) {
        this.map.updateMatrix()
      }
      this.uniforms.mapTransform.value.copy(this.map.matrix)
    }
  }
}
