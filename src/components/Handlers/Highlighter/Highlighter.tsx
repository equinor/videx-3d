import { useMemo } from 'react'
import { useHighlightState } from './highlight-state'
import { AdditiveBlending, DoubleSide, InstancedMesh, Line, Matrix4, Mesh, MeshBasicMaterial } from 'three'

const mat = new MeshBasicMaterial({
  color: 0x404040,
  depthTest: true,
  depthWrite: false,
  transparent: true,
  opacity: 1, 
  blending: AdditiveBlending,
  side: DoubleSide,
})

const instanceMatrix = new Matrix4()

/**
 * Adds highlighting to rendered objects by rendering a "ghost" object on top it.
 *
 * @example
 * <Highlighter />
 * 
 * @remarks
 * This component manages highlights in a global state and needs to be added to 
 * enable it as a feature. To interact with this component, you must use the
 * `useHighlighter` hook from another component. 
 * 
 * @see {@link useHighlighter}
 * @see {@link EventEmitter}
 * 
 * @group Components
 */
export const Highlighter = () => {
  const { highlighted } = useHighlightState()

  const highlightObjects = useMemo(() => {
    return highlighted.map(item => {
      let primitiveObject: Mesh | Line | InstancedMesh
      const geometry = item.object.geometry

      if (item.object instanceof InstancedMesh) {
        const instanced = item.object as InstancedMesh
        if (item.instanceIndex) {
          primitiveObject = new Mesh(geometry, mat)
          item.object.getWorldPosition(primitiveObject.position)
          instanced.getMatrixAt(item.instanceIndex, instanceMatrix)
          primitiveObject.applyMatrix4(instanceMatrix)
        } else {
          const imesh = new InstancedMesh(geometry, mat, instanced.count)
          item.object.getWorldPosition(imesh.position)
          imesh.instanceMatrix = instanced.instanceMatrix
          primitiveObject = imesh
        }
      } 
      else if (item.object instanceof Mesh) {
        primitiveObject = new Mesh(geometry, mat)
        item.object.getWorldPosition(primitiveObject.position)
      } else {
        primitiveObject = new Line(geometry, mat)
        item.object.getWorldPosition(primitiveObject.position)
      }
      primitiveObject.visible = item.object.visible
      

      
      return primitiveObject
    })
  }, [highlighted])

  return <group renderOrder={999}>
    {highlightObjects.map(po => (
      <primitive key={po.uuid} object={po} />
    ))}
  </group>
}