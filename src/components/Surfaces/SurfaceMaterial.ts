import {
  abs,
  bitangentView,
  cross,
  Discard,
  float,
  Fn,
  fract,
  frontFacing,
  fwidth,
  If,
  mat3,
  materialColor,
  max,
  mix,
  negate,
  oneMinus,
  reciprocal,
  saturate,
  select,
  smoothstep,
  tangentView,
  texture,
  transformNormalToView,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  vertexStage,
} from 'three/tsl'
import {
  CanvasTexture,
  Color,
  ColorRepresentation,
  DataTexture,
  LinearFilter,
  Matrix3,
  MeshLambertNodeMaterial,
  MeshLambertNodeMaterialParameters,
  NearestFilter,
  Node,
  RGBAFormat,
  SRGBColorSpace,
  TangentSpaceNormalMap,
  Texture,
  TextureNode,
  Vector2,
} from 'three/webgpu'
import { rotateVec3 } from '../../materials/nodes/transforms'
import { colorRamps, createColorRamps } from './color-ramps'

const canvas = createColorRamps(colorRamps, 512)
const colorRampTexture = new CanvasTexture(canvas)
colorRampTexture.magFilter = LinearFilter
colorRampTexture.minFilter = NearestFilter
colorRampTexture.flipY = false
colorRampTexture.generateMipmaps = false
colorRampTexture.colorSpace = SRGBColorSpace
colorRampTexture.format = RGBAFormat
colorRampTexture.anisotropy = 4

export enum ContourColorMode {
  darken = 0,
  lighten = 1,
  mixed = 2,
}

export type SurfaceMaterialParameters = MeshLambertNodeMaterialParameters & {
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
  elevationTexture?: Texture
  normalTexture?: Texture
  debug?: boolean
}

/**
 * Shader material for `Surface` component.
 *
 * @see {@link Surface}
 */
export class SurfaceMaterial extends MeshLambertNodeMaterial {
  readonly isMeshSurfaceShader = true

  private _colorRampIndex: UniformNode<number> = uniform(0)
  private _colorRamps: UniformNode<number> = uniform(colorRamps.length)
  private _colorRampMin: UniformNode<number> = uniform<number>(0)
  private _colorRampMax: UniformNode<number> = uniform<number>(0)
  private _colorRampTexture: TextureNode = new TextureNode(colorRampTexture)
  private _referenceDepth: UniformNode<number> = uniform<number>(0)
  private _saturation: UniformNode<number> = uniform<number>(1)
  private _brightness: UniformNode<number> = uniform<number>(0)
  private _elevationTexture: TextureNode = new TextureNode()
  private _contoursInterval: UniformNode<number> = uniform<number>(100)
  private _contoursColorModeFactor: UniformNode<number> = uniform<number>(0.5)
  private _contoursColor: UniformNode<Color> = uniform(new Color('black'))
  private _contoursThickness: UniformNode<number> = uniform<number>(0.8)
  private _gridUvMat: UniformNode<Matrix3> = uniform(new Matrix3())
  private _size: UniformNode<Vector2> = uniform(new Vector2())
  private _scale: UniformNode<Vector2> = uniform(new Vector2())
  private _rotation: UniformNode<number> = uniform<number>(0)

  private _showContours: boolean = false
  private _contoursColorMode: UniformNode<number> = uniform<number>(0)
  private _useColorRamp: boolean = false
  private _colorRampReverse: boolean = false

  constructor(parameters: SurfaceMaterialParameters) {
    super()

    this.normalMapType = TangentSpaceNormalMap
    this.wireframe = false
    this.lights = true
    this.fog = true

    this.normalScale.set(0.25, 0.25)
    this.color.set('white')
    this.setValues(parameters)

    this._buildSurfaceMaterial()
  }

  private _buildSurfaceMaterial() {
    const {
      _gridUvMat: gridUvMat,
      _elevationTexture: elevationTexture,
      _size: size,
      _scale: scale,
      _rotation: rot,
      _referenceDepth: referenceDepth,
      _contoursInterval: countoursInterval,
      _contoursThickness: contoursThickness,
      _contoursColorMode: contoursColorMode,
      _contoursColorModeFactor: contoursColorModeFactor,
      _contoursColor: contoursColor,
      _colorRampMin: colorRampMin,
      _colorRampMax: colorRampMax,
      _colorRampIndex: colorRampIndex,
      _colorRamps: colorRamps,
    } = this

    const getElevation = (uv: Node) => texture(elevationTexture, uv).r

    const getColor = Fn<Node>(([v]) => {
      const min = colorRampMin
      const max = colorRampMax

      const t = saturate(v.sub(min).div(max.sub(min)))
      if (this._colorRampReverse) {
        t.assign(oneMinus(t))
      }

      return texture(
        colorRampTexture,
        vec2(t, float(colorRampIndex).add(0.5).div(float(colorRamps))),
      ).rgb
    })

    const getContours = Fn<Node>(([depth, interval, thickness]) => {
      const h = depth.add(interval.mul(0.5)).div(interval)
      const f = abs(fract(h).sub(0.5))
      const df = max(0.0025, fwidth(h).mul(thickness))
      const t = smoothstep(0.0, df, f)
      return t
    })

    const gridUv = vertexStage(gridUvMat.mul(vec3(uv(), 1.0)).xy).toVarying()
    const elevation = getElevation(gridUv)
    const depth = referenceDepth.sub(elevation)

    const gridSegments = size.sub(1.0)

    const calcNormal = Fn(() => {
      const normalOffset = reciprocal(gridSegments)
      const nw = getElevation(
        saturate(gridUv.add(vec2(negate(normalOffset.x), normalOffset.y))),
      )
      const ne = getElevation(
        saturate(gridUv.add(vec2(normalOffset.x, normalOffset.y))),
      )
      const sw = getElevation(saturate(gridUv.add(negate(normalOffset))))
      const se = getElevation(
        saturate(gridUv.add(vec2(normalOffset.x, negate(normalOffset.y)))),
      )

      const p1 = vec3(negate(scale.x), nw.sub(elevation), negate(scale.y))
      const p2 = vec3(scale.x, ne.sub(elevation), negate(scale.y))
      const p3 = vec3(negate(scale.x), sw.sub(elevation), scale.y)
      const p4 = vec3(scale.x, se.sub(elevation), scale.y)

      let n0 = vec3(0.0, 0.000001, 0.0)

      If(nw.greaterThanEqual(0).and(ne.greaterThanEqual(0)), () => {
        n0.addAssign(cross(p2, p1))
      })
      If(ne.greaterThanEqual(0).and(se.greaterThanEqual(0)), () => {
        n0.addAssign(cross(p4, p2))
      })
      If(sw.greaterThanEqual(0).and(se.greaterThanEqual(0)), () => {
        n0.addAssign(cross(p3, p4))
      })
      If(se.greaterThanEqual(0).and(nw.greaterThanEqual(0)), () => {
        n0.addAssign(cross(p1, p3))
      })

      n0 = rotateVec3(n0, vec3(0, 1, 0), rot)

      // TODO: Check if we need to check for double sided before multipling with faceDirection
      const normal = transformNormalToView(n0).normalize()
      if (this.normalMap) {
        const tbn = mat3(tangentView, bitangentView, normal)
        const mapUv = mat3(this.normalMap.matrix).mul(vec3(uv())).xy
        const mapN = texture(this.normalMap, mapUv).xyz.mul(2).sub(1)
        mapN.xy.mulAssign(vec2(this.normalScale))
        normal.assign(tbn.mul(mapN).normalize())
      }
      return select(frontFacing, normal, normal.negate())
    })

    //this.normalNode = calcNormal()
    this.normalNode = calcNormal()

    this.colorNode = Fn<Node>(() => {
      Discard(elevation.lessThan(0.0))

      const diffuse = vec3(materialColor)
      if (this._useColorRamp) {
        diffuse.assign(getColor(depth))
      }

      if (this._showContours) {
        const t = getContours(depth, countoursInterval, contoursThickness)

        If(contoursColorMode.equal(0), () => {
          diffuse.mulAssign(oneMinus(oneMinus(t).mul(contoursColorModeFactor)))
        })
          .ElseIf(contoursColorMode.equal(1), () => {
            diffuse.mulAssign(
              float(1).add(oneMinus(t).mul(contoursColorModeFactor)),
            )
          })
          .Else(() => {
            diffuse.assign(mix(diffuse, contoursColor, oneMinus(t)))
          })
      }

      return vec4(diffuse, this.opacity)
    })()
  }

  get useColorRamp() {
    return this._useColorRamp
  }

  set useColorRamp(value: boolean) {
    const changed = value !== this._useColorRamp
    if (changed) {
      this._useColorRamp = value
      this.needsUpdate = true
    }
  }

  get colorRampIndex() {
    return this._colorRampIndex.value
  }

  set colorRampIndex(value: number) {
    this._colorRampIndex.value = value
  }

  get colorRamps() {
    return this._colorRamps.value
  }

  set colorRamps(value: number) {
    this._colorRamps.value = value
  }

  get colorRampReverse() {
    return this._colorRampReverse
  }

  set colorRampReverse(value: boolean) {
    const changed = value !== this._colorRampReverse
    if (changed) {
      this._colorRampReverse = value
      this.needsUpdate = true
    }
  }

  get colorRampMin() {
    return this._colorRampMin.value
  }

  set colorRampMin(value: number | undefined) {
    this._colorRampMin.value = value || 0
  }

  get colorRampMax() {
    return this._colorRampMax.value
  }

  set colorRampMax(value: number | undefined) {
    this._colorRampMax.value = value || 0
  }

  get colorRampTexture() {
    return this._colorRampTexture.value as Texture
  }

  set colorRampTexture(v: Texture | null) {
    if (v) {
      this._colorRampTexture.value = v
    }
  }

  get referenceDepth() {
    return this._referenceDepth.value
  }

  set referenceDepth(value: number) {
    this._referenceDepth.value = value
  }

  get saturation() {
    return this._saturation.value
  }

  set saturation(value: number) {
    this._saturation.value = value
  }

  get brightness() {
    return this._brightness.value
  }

  set brightness(value: number) {
    this._brightness.value = value
  }

  get elevationTexture() {
    return this._elevationTexture.value as Texture
  }

  set elevationTexture(v: Texture | null) {
    if (v) {
      this._elevationTexture.value = v
      const tex = v as DataTexture
      const { width, height } = tex.image
      const sx = (width - 1) / width
      const sy = (height - 1) / height
      const tx = (1 - sx) / 2
      const ty = (1 - sy) / 2
      this._gridUvMat.value.setUvTransform(tx, ty, sx, sy, 0, 0, 0)
    }
  }

  get showContours() {
    return this._showContours
  }

  set showContours(value: boolean) {
    const changed = value !== this._showContours
    if (changed) {
      this._showContours = value
      this.needsUpdate = true
    }
  }

  get contoursInterval() {
    return this._contoursInterval.value
  }

  set contoursInterval(value: number) {
    this._contoursInterval.value = value
  }

  get contoursColorMode() {
    return this._contoursColorMode.value
  }

  set contoursColorMode(value: number) {
    this._contoursColorMode.value = value
  }

  get contoursColorModeFactor() {
    return this._contoursColorModeFactor.value
  }

  set contoursColorModeFactor(value: number) {
    this._contoursColorModeFactor.value = value
  }

  get contoursColor(): Color {
    return this._contoursColor.value
  }

  set contoursColor(v: Color | ColorRepresentation) {
    if (v instanceof Color) this._contoursColor.value = v
    else this._contoursColor.value = new Color(v)
  }

  get contoursThickness() {
    return this._contoursThickness.value
  }

  set contoursThickness(value: number) {
    this._contoursThickness.value = value
  }

  get size() {
    return this._size.value
  }

  set size(value: Vector2) {
    this._size.value = value
  }

  get scale() {
    return this._scale.value
  }

  set scale(value: Vector2) {
    this._scale.value = value
  }

  get rotation() {
    return this._rotation.value
  }

  set rotation(value: number) {
    this._rotation.value = value
  }

  // @ignore
  dispose(): void {
    super.dispose()
    this._elevationTexture.value?.dispose()
    this._colorRampTexture.value?.dispose()
  }
}
