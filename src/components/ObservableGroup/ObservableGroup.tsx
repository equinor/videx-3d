import { GroupProps } from '@react-three/fiber'
import { PropsWithChildren, useEffect, useMemo, useRef } from 'react'
import { Box3, Group, Vector3 } from 'three'
import { Vec3 } from '../../sdk'



const _box = new Box3()

/**
 * Needed to tweak the Three implementation to prevent objects with infinite
 * bounding boxes (instanced mesh) to break the calculations.
 */
function expandByObject(object: any, box: Box3) {
  // Computes the world-axis-aligned bounding box of an object (including its children),
  // accounting for both the object's, and children's, world transforms
  object.updateWorldMatrix(false, false)
  const geometry = object.geometry

  if (geometry !== undefined) {
    if (object.boundingBox !== undefined) {
      // object-level bounding box
      if (object.boundingBox === null) {
        object.computeBoundingBox()
      }
      _box.copy(object.boundingBox)
    } else {
      // geometry-level bounding box
      if (geometry.boundingBox === null) {
        geometry.computeBoundingBox()
      }
      _box.copy(geometry.boundingBox)
    }
    if (!(isNaN(_box.min.x) || isNaN(_box.min.y) || isNaN(_box.min.z))) {
      _box.applyMatrix4(object.matrixWorld)
      box.union(_box)
    }
  }

  const children = object.children
  for (let i = 0, l = children.length; i < l; i++) {
    expandByObject(children[i], box)
  }

  return box
}

/**
 * ObservableGroup state
 */
export type ObservableGroupState = {
  center: Vec3,
  size: Vec3,
}

export type BoxPadding = {
  x0?: number,
  x1?: number,
  y0?: number,
  y1?: number,
  z0?: number,
  z1?: number,
}

/**
 * ObservableGroup props
 * @expand
 */
export type ObservableGroupProps = GroupProps & {
  padding?: number | Vec3 | BoxPadding
  snapTo?: number
  updateRate?: number
  enabled?: boolean
  onChange?: (state: ObservableGroupState) => void
}

const vCenter = new Vector3()
const vSize = new Vector3()
const bbox = new Box3()


/**
 * Monitors the bounds of its children and will invoke a callback when it
 * changes.
 * 
 * This feature is used by the `BoxGrid` component if `autoSize` is enabled.
 * 
 * @group Components
 */
export const ObservableGroup = (props: PropsWithChildren<ObservableGroupProps>) => {
  const ref = useRef<Group>(null)
  const state = useRef<ObservableGroupState>({ center: [0, 0, 0], size: [0, 0, 0] })

  const {
    padding = [0, 0, 0],
    snapTo,
    updateRate = 1000,
    enabled = true,
    onChange,
  } = props

  const pad = useMemo<Required<BoxPadding>>(() => {
    if (Number.isFinite(padding)) {
      const v = padding as number
      return {
        x0: v,
        x1: v,
        y0: v,
        y1: v,
        z0: v,
        z1: v,
      }
    } else if (Array.isArray(padding)) {
      const v = padding as Vec3
      return {
        x0: v[0],
        x1: v[0],
        y0: v[1],
        y1: v[1],
        z0: v[2],
        z1: v[2],
      }
    } else if (padding !== undefined) {
      const v = padding as BoxPadding
      return {
        x0: v.x0 || 0,
        x1: v.x1 || 0,
        y0: v.y0 || 0,
        y1: v.y1 || 0,
        z0: v.z0 || 0,
        z1: v.z1 || 0,
      }  
    }

    return {
      x0: 0,
      x1: 0,
      y0: 0,
      y1: 0,
      z0: 0,
      z1: 0,
    }
  }, [padding])

  useEffect(() => {
    let interval: number | null = null

    if (onChange && enabled) {
      interval = setInterval(() => {
        if (onChange && ref.current && ref.current.children.length) {
          bbox.makeEmpty()

          expandByObject(ref.current, bbox)

          if (snapTo) {
            bbox.min.set(
              Math.floor((bbox.min.x - pad.x0) / snapTo) * snapTo,
              Math.floor((bbox.min.y - pad.y0) / snapTo) * snapTo,
              Math.floor((bbox.min.z - pad.z0) / snapTo) * snapTo,
            )
            bbox.max.set(
              Math.ceil((bbox.max.x + pad.x1) / snapTo) * snapTo,
              Math.ceil((bbox.max.y + pad.y1) / snapTo) * snapTo,
              Math.ceil((bbox.max.z + pad.z1) / snapTo) * snapTo,
            )
          } else {
            bbox.min.set(
              bbox.min.x - pad.x0,
              bbox.min.y - pad.y0,
              bbox.min.z - pad.z0,
            )
            bbox.max.set(
              bbox.max.x + pad.x1,
              bbox.max.y + pad.y1,
              bbox.max.z + pad.z1,
            )
          }

          bbox.getCenter(vCenter)
          bbox.getSize(vSize)

          const changed = (
            vCenter.x !== state.current.center[0] ||
            vCenter.y !== state.current.center[1] ||
            vCenter.z !== state.current.center[2] ||
            vSize.x !== state.current.size[0] ||
            vSize.y !== state.current.size[1] ||
            vSize.z !== state.current.size[2]
          )

          if (changed) {
            state.current.center = vCenter.toArray()
            state.current.size = vSize.toArray()
            onChange(state.current)
          }
        }
      }, updateRate)
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [pad, snapTo, updateRate, enabled, onChange])


  return (
    <group {...props} ref={ref} />
  )
}