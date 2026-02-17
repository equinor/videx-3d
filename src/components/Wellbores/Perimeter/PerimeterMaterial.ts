import {
  abs,
  attribute,
  Discard,
  Fn,
  fract,
  frontFacing,
  fwidth,
  materialColor,
  materialOpacity,
  min,
  mix,
  mod,
  oneMinus,
  pow,
  select,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl'
import {
  Color,
  DoubleSide,
  MeshBasicMaterialParameters,
  MeshBasicNodeMaterial,
  Node,
} from 'three/webgpu'

export type PerimeterMaterialParameters = MeshBasicMaterialParameters & {
  from?: number
  to?: number
}

export class PerimeterMaterial extends MeshBasicNodeMaterial {
  private _from: UniformNode<number>
  private _to: UniformNode<number>

  constructor(params: PerimeterMaterialParameters = {}) {
    super()

    this._from = uniform(0)
    this._to = uniform(1)

    this.transparent = true
    this.side = DoubleSide
    this.color = new Color('#c0fc09')

    this.setValues(params)
    this._buildPerimeterMaterial()
  }

  private _buildPerimeterMaterial() {
    const length = attribute('curveLength', 'float').toVarying()

    const density = 300.0

    const from = this._from
    const to = this._to

    this.colorNode = Fn<Node>(() => {
      Discard(
        length
          .lessThan(from)
          .or(length.greaterThan(to))
          .or(materialOpacity.lessThan(0.01)),
      )

      const modulatedLength = mod(length.sub(from), density)
      const coord1 = modulatedLength.div(10.0)
      const coord2 = uv().x.mul(20.0)

      const line1 = abs(fract(coord1.sub(0.5)).sub(0.5).div(fwidth(coord1)))
      const line2 = abs(fract(coord2.sub(0.5)).sub(0.5).div(fwidth(coord2)))
      const line = min(line1, line2)

      const strength = pow(oneMinus(min(line, 1.0)), 1.0 / 2.2)

      const outColor = select(
        frontFacing,
        materialColor,
        mix(materialColor, vec3(0), 0.75),
      )

      return vec4(outColor.mul(strength), materialOpacity)
    })()
  }

  get from() {
    return this._from.value as number
  }

  set from(value: number) {
    this._from.value = value
  }

  get to() {
    return this._to.value as number
  }

  set to(value: number) {
    this._to.value = value
  }
}
