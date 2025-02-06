
import { Layers } from '@react-three/fiber'
import { Material } from 'three'
import { Vec3 } from '../sdk'

/**
 * Common props for 3d components
 */
export type CommonComponentProps = {
  name?: string
  visible?: boolean
  userData?: Record<string, any>
  position?: Vec3
  castShadow?: boolean
  receiveShadow?: boolean
  renderOrder?: number
  layers?: Layers
}

/**
 * Common props for 3d components that allow overriding shader materials
 */
export type CustomMaterialProps = {
  customMaterial?: Material | Material[]
  customDepthMaterial?: Material
  customDistanceMaterial?: Material
  onMaterialPropertiesChange?: (props: Record<string, any>, material: Material | Material[]) => void
}
