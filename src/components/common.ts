import { Layers } from '@react-three/fiber'
import { Material } from 'three/webgpu'
import { Vec3 } from '../sdk'

/**
 * Common props for 3d components
 */
export type CommonComponentProps = {
  // will be added to the name property of the THREE.js Object3D instance
  name?: string
  // set the visible flag on the THREE.js Object3D instance
  visible?: boolean
  // set the userData object on the THREE.js Object3D instance
  userData?: Record<string, any>
  // set the position in parent's local coordinates
  position?: Vec3
  // set the castShadow property on the THREE.js Object3D instance.
  castShadow?: boolean
  // set the receiveShadow property on the THREE.js Object3D instance.
  receiveShadow?: boolean
  // set the renderOrder property on the THREE.js Object3D instance.
  renderOrder?: number
  // set the layers property on the THREE.js Object3D instance.
  layers?: Layers
}

/**
 * Common props for 3d components that allow overriding shader materials
 */
export type CustomMaterialProps = {
  // custom material or array of materials for overriding default component material(s)
  customMaterial?: Material | Material[]
  // set a custom depth material if required
  customDepthMaterial?: Material
  // set a custom distance material if required
  customDistanceMaterial?: Material
  // callback to invoke when component is updated. Use this for setting/uppdaing uniforms in your custom material(s)
  onMaterialPropertiesChange?: (
    props: Record<string, any>,
    material: Material | Material[],
  ) => void
}
