import { BufferGeometry, InstancedBufferAttribute, InstancedMesh, Layers, Material } from 'three'
import { SymbolsType } from '../../sdk/data/types/Symbol'
import { forwardRef, useEffect, useImperativeHandle, useMemo } from 'react'
import { PointerEvents } from '../../events/interaction-events'
import { EventEmitterCallback, useEventEmitter } from '../Handlers/EventEmitter/EventEmitterContext'
import { CommonComponentProps } from '../common'

/**
 * Symbol props
 * @expand
 */
export type SymbolProps = {
  geometry: BufferGeometry,
  material: Material | Material[],
  data: SymbolsType,
  customDepthMaterial?: Material,
  customDistanceMaterial?: Material,
} & PointerEvents & CommonComponentProps

/**
 * A generic component used for simplifying mesh instancing. Use this component if you need a large number of
 * meshes sharing the same base geometry and material, but that may be transformed or colored individually.
 * 
 * Typical use case is for visualizations of data along a wellbore, such as in the `Shoes` and `Picks` component.
 * 
 * @remarks
 * Data, including colors, transformations and user defined data, must be mapped to the `SymbolsType` type.
 * 
 * @example
 *  <Symbols
 *    position={position}
 *    data={data}
 *    geometry={geometry}
 *    material={material}
 *    layers={layers}
 *  />
 * 
 * @see {@link SymbolsType}
 * @see [InstancedMesh](https://threejs.org/docs/#api/en/objects/InstancedMesh)
 * 
 * @group Components
 */
export const Symbols = forwardRef<InstancedMesh, SymbolProps>(({
  name,
  position,
  userData,
  castShadow,
  receiveShadow,
  renderOrder,
  visible,
  data,
  geometry,
  material,
  layers,
  onPointerClick,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
}, ref) => {
  const eventHandler = useEventEmitter()

  const object = useMemo(() => {
    const count = data.transformations.length / 16
    const mesh = new InstancedMesh(geometry, material, count)

    mesh.instanceMatrix.set(data.transformations)
    mesh.instanceMatrix.needsUpdate = true
    if (data.colors) {
      mesh.instanceColor = new InstancedBufferAttribute(data.colors, 3)
      mesh.instanceColor.needsUpdate = true
    }

    if (layers) {
      const mask =  layers instanceof Layers ? layers.mask : layers
      mesh.layers.mask = mask
    }

    mesh.castShadow = !!castShadow
    mesh.receiveShadow = !!receiveShadow

    return mesh
  }, [geometry, material, data, layers, castShadow, receiveShadow])

  useImperativeHandle(ref, () => object)

  // register event handlers
  useEffect(() => {
    let unregister: (() => void) | null = null
    if (eventHandler) {
      const handlers: Record<string, EventEmitterCallback> = {}

      if (onPointerClick) handlers.click = onPointerClick
      if (onPointerEnter) handlers.enter = onPointerEnter
      if (onPointerLeave) handlers.leave = onPointerLeave
      if (onPointerMove) handlers.move = onPointerMove

      if (Object.keys(handlers).length) {
        unregister = eventHandler.register(object, handlers)
      }
    }

    return () => {
      if (unregister) unregister()
    }
  }, [eventHandler, object, onPointerClick, onPointerEnter, onPointerLeave, onPointerMove])

  useEffect(() => {

  }, [])

  return (
    <group
      name={name}
      userData={userData}
      renderOrder={renderOrder}
      position={position}
      visible={visible}
    >
      <primitive object={object} />
    </group>
  )
})