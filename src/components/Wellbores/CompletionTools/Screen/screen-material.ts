import {
  attribute,
  Fn,
  materialColor,
  mix,
  mod,
  step,
  uniform,
  uv,
} from 'three/tsl'
import {
  Color,
  ColorRepresentation,
  MeshLambertMaterialParameters,
  MeshLambertNodeMaterial,
  Node,
} from 'three/webgpu'

export type ScreenMaterialParameters = MeshLambertMaterialParameters & {
  altColor?: ColorRepresentation
}

export class ScreenMaterial extends MeshLambertNodeMaterial {
  private _altColor: UniformNode<Color>

  constructor(params: ScreenMaterialParameters = {}) {
    super()

    this._altColor = uniform(new Color('black'))

    this.setValues(params)
    this._buildScreenMaterial()
  }

  private _buildScreenMaterial() {
    const altColor = this._altColor
    this.colorNode = Fn<Node>(() => {
      const curvelLength = attribute('curveLength', 'float').toVarying()
      const strength = mod(curvelLength.add(uv().x.mul(2.0)), 2.0)
      strength.assign(step(1.5, strength))

      return mix(altColor, materialColor, strength)
    })()
  }

  get altColor() {
    return this._altColor.value as ColorRepresentation
  }

  set altColor(value: ColorRepresentation) {
    this._altColor.value.set(value)
  }
}
