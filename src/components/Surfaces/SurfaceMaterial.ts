import {
  CanvasTexture,
  Color,
  LinearFilter,
  MeshLambertMaterialParameters,
  MultiplyOperation,
  NearestFilter,
  //NoColorSpace,
  RGBAFormat,
  ShaderLib,
  ShaderMaterial,
  ShaderMaterialParameters,
  SRGBColorSpace,
  TangentSpaceNormalMap,
  Texture,
  UniformsUtils,
  Vector2,
} from 'three'
import { colorRamps, createColorRamps } from './color-ramps'
import fragmentShader from './shaders/fragment.glsl'
import vertexShader from './shaders/vertex.glsl'

const canvas = createColorRamps(colorRamps, 512)
const colorRampTexture = new CanvasTexture(canvas)
colorRampTexture.magFilter = LinearFilter
colorRampTexture.minFilter = NearestFilter
colorRampTexture.flipY = false
colorRampTexture.generateMipmaps = false
//colorRampTexture.colorSpace = NoColorSpace
colorRampTexture.colorSpace = SRGBColorSpace
colorRampTexture.format = RGBAFormat
colorRampTexture.anisotropy = 4;

export enum ContourColorMode {
  darken = 0,
  lighten = 1,
  mixed = 2,
}

export type SurfaceMaterialParameters = ShaderMaterialParameters & MeshLambertMaterialParameters & {
  useColorRamp?: boolean
  saturation?: number
  brightness?: number
  colorRampIndex?: number
  colorRampReverse?: boolean
  colorRampMin?: number
  colorRampMax?: number
  referenceDepth?: number
  showContours?: boolean
  contoursInterval?: number
  contoursColorMode?: ContourColorMode
  contoursColorModeFactor?: number
  contoursColor?: string | number | Color
  depthTexture?: Texture
  normalTexture?: Texture
}

const shader = {
  name: 'MeshSurfaceShader',
  defines: {
    USE_COLOR_RAMP: false,
    USE_CONTOURS: false,
    USE_UV: true
  },
  uniforms: UniformsUtils.merge([
    UniformsUtils.clone(ShaderLib['lambert'].uniforms),
    {
      colorRampIndex: { value: 0 },
      colorRamps: { value: colorRamps.length },
      colorRampReverse: { value: true },
      colorRampMin: { value: 800 },
      colorRampMax: { value: 1000 },
      colorRampTexture: { value: null },
      referenceDepth: { value: 1000 },
      saturation: { value: 1 },
      brightness: { value: 0 },
      depthTexture: { value: null },
      normalTexture: { value: null },
      contoursInterval: { value: 100 },
      contoursColorMode: { value: 0 },
      contoursColorModeFactor: { value: 0.5 },
      contoursColor: { value: new Color('black') },
      contoursThickness: { value: 0.8 },
      size: { value: new Vector2() },
    },
  ]),
  vertexShader,
  fragmentShader,
}

/**
 * Shader material for `Surface` component.
 * 
 * @see {@link Surface}
 */
export class SurfaceMaterial extends ShaderMaterial {
  isMeshSurfaceShader = true
  normalScale: Vector2
  map?: Texture
  normalMap?: Texture
  wireframeLinecap: string
  wireframeLinejoin: string
  flatShading: boolean
  combine: number
  normalMapType: number

  constructor(parameters: SurfaceMaterialParameters) {

    super();

    this.defines = Object.assign( {}, shader.defines )
    this.uniforms = UniformsUtils.clone( shader.uniforms )
    this.vertexShader = shader.vertexShader
    this.fragmentShader = shader.fragmentShader
    this.combine = MultiplyOperation
    this.normalMapType = TangentSpaceNormalMap
    this.wireframe = false;
    this.wireframeLinewidth = 1
    this.wireframeLinecap = 'round'
    this.wireframeLinejoin = 'round'
    this.flatShading = false
    this.lights = true
    this.clipping = true
    this.fog = true    
    
    const exposePropertyNames = [
      'map', 'lightMap', 'lightMapIntensity', 'aoMap', 'aoMapIntensity',
      'emissive', 'emissiveIntensity', 'emissiveMap', 'specularMap', 'alphaMap',
      'envMap', 'reflectivity', 'refractionRatio', 'opacity', 'diffuse',
      'normalMap', 'normalScale', 'referenceDepth', 'colorRampIndex',
      'colorRampMin', 'colorRampMax', 'colorRampReverse', 'saturation', 'brightness',
      'contoursInterval', 'contoursColorMode', 'contoursColorModeFactor', 'contoursThickness',
      'normalTexture', 'depthTexture'
    ]

    for (const propertyName of exposePropertyNames) {
      Object.defineProperty(this, propertyName, {
        get: function () {
          return this.uniforms[propertyName].value
        },

        set: function (value) {
          this.uniforms[propertyName].value = value
        }
      })
    }

    this.normalScale = new Vector2(0.25, 0.25)
    this.color = 'white'
    this.setValues(parameters)
  }

  get color() {
    return '#' + this.uniforms.diffuse.value.getHexString()
  }

  set color(value) {
    this.uniforms.diffuse.value = new Color(value)
  }

  get contoursColor() {
    return '#' + this.uniforms.contoursColor.value.getHexString()
  }

  set contoursColor(value) {
    this.uniforms.contoursColor.value = new Color(value)
  }

  get useColorRamp() {
    return this.defines.USE_COLOR_RAMP || false
  }

  set useColorRamp(value) {
    this.defines.USE_COLOR_RAMP = !!value
    this.uniforms.colorRampTexture.value = this.defines.USE_COLOR_RAMP ? colorRampTexture : null
    this.needsUpdate = true
  }

  get showContours() {
    return this.defines.USE_CONTOURS || false
  }

  set showContours(value) {
    this.defines.USE_CONTOURS = !!value
    this.needsUpdate = true
  }
  
  // @ignore
  dispose(): void {
    super.dispose()
    this.uniforms.depthTexture.value?.dispose()
  }

  // @ignore
  onBeforeCompile() {
    if (this.map) {
      if (this.map.matrixAutoUpdate === true) {
        this.map.updateMatrix()
      }
      this.uniforms.mapTransform.value.copy(this.map.matrix)
    }
    if (this.normalMap) {
      if (this.normalMap.matrixAutoUpdate === true) {
        this.normalMap.updateMatrix()
      }
      this.uniforms.normalMapTransform.value.copy(this.normalMap.matrix)
    }
  }
}

