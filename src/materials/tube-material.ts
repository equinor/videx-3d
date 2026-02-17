import {
  MeshBasicMaterialParameters,
  MeshBasicNodeMaterial,
} from 'three/webgpu'
import { depthShade } from './nodes/depth-shade'

export class TubeMaterial extends MeshBasicNodeMaterial {
  isTubeMaterial = true
  constructor(parameters?: MeshBasicMaterialParameters) {
    super(parameters)

    this.colorNode = depthShade()
  }
}
