import { useMemo } from 'react'
import { AdditiveBlending, Blending, Color, DoubleSide, InstancedMesh, Line, Matrix4, Mesh, MeshBasicMaterial } from 'three'
import { useHighlightState } from './highlight-state'

const instanceMatrix = new Matrix4()

export type HighlighterProps = {
  color?: string | number | Color
  blending?: Blending
  renderOrder?: number
}

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
export const Highlighter = ({
  color,
  blending,
  renderOrder,
}: HighlighterProps) => {
  const { highlighted } = useHighlightState()

  const material = useMemo(() => {
    return new MeshBasicMaterial({
      color: color || 0x404040,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 1,
      blending: blending || AdditiveBlending,
      side: DoubleSide,
    })
  }, [color, blending])

  const highlightObjects = useMemo(() => {
    return highlighted.map(item => {
      let primitiveObject: Mesh | Line | InstancedMesh
      const geometry = item.object.geometry

      if (item.object instanceof InstancedMesh) {
        const instanced = item.object as InstancedMesh
        if (item.instanceIndex) {
          primitiveObject = new Mesh(geometry, material)
          item.object.getWorldPosition(primitiveObject.position)
          instanced.getMatrixAt(item.instanceIndex, instanceMatrix)
          primitiveObject.applyMatrix4(instanceMatrix)
        } else {
          const imesh = new InstancedMesh(geometry, material, instanced.count)
          item.object.getWorldPosition(imesh.position)
          imesh.instanceMatrix = instanced.instanceMatrix
          primitiveObject = imesh
        }
      }
      else if (item.object instanceof Mesh) {
        primitiveObject = new Mesh(geometry, material)
        item.object.getWorldPosition(primitiveObject.position)
      } else {
        primitiveObject = new Line(geometry, material)
        item.object.getWorldPosition(primitiveObject.position)
      }
      primitiveObject.visible = item.object.visible
      return primitiveObject
    })
  }, [highlighted, material])


  return <group renderOrder={renderOrder}>
    {highlightObjects.map(po => (
      <primitive key={po.uuid} object={po} />
    ))}
  </group>
}