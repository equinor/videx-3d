import { useFrame } from '@react-three/fiber'
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Object3D, PerspectiveCamera, Sphere, Vector3 } from 'three'
import { useGenerator } from '../../../hooks/useGenerator'
import { Vec3 } from '../../../sdk/types/common'
import { DistanceContext } from '../../Distance/DistanceContext'
import { wellboreBounds } from './wellbore-bounds-defs'

/**
 * WellboreBounds props
 * @expand
 */
export type WellboreBoundsProps = {
  id: string,
  fromMsl?: number,
  boundsSampleSize?: number,
  visible?: boolean,
  priority?: number,
  children?: ReactNode,
}

export type WellboreBoundingSphere = {
  center: Vec3
  radius: number
}

export type WellboreBoundsType = {
  main: WellboreBoundingSphere
  sampled: WellboreBoundingSphere[]
}

const vec = new Vector3()
const sphere = new Sphere()

/**
 * This component is used to provide a `DistanceContext` for a `Wellbore`, which allow the use
 * of the `Distance` component to conditionally show/hide other components depending on the distance from the
 * wellbore to the camera.
 * 
 * @example
 * <Wellbore id={wellboreId}>
 *   <WellboreBounds id={wellboreId}>
 *     <BasicTrajectory />
 *     <Distance min={0} max={2000}>
 *       <TubeTrajectory />
 *     </Distance>
 *   </WellboreBounds>
 * </Wellbore>
 * 
 * @remarks
 * This component does not use the `WellboreContext` to retrieve the wellbore id, and must be provided as a prop.
 * 
 * @see [Storybook](/videx-3d/?path=/docs/components-wellbores-wellborebounds--docs)
 * @see {@link Distance}
 * @see {@link DistanceContext}
 * 
 * @group Components
 */
export const WellboreBounds = ({
  id,
  fromMsl,
  boundsSampleSize = 250,
  visible = false,
  priority = 0,
  children,
}: WellboreBoundsProps) => {
  const boundsRef = useRef<Object3D>(null!)

  const boundsGenerator = useGenerator<Float32Array>(wellboreBounds, priority)

  const [bounds, setBounds] = useState<WellboreBoundsType | null>(null)
  const currentDistanceRef = useMemo<{ current: number }>(() => ({ current: Infinity }), [])

  const calculateDistance = useCallback((wellboreBounds: WellboreBoundsType, camera: PerspectiveCamera) => {
    vec.copy(camera.position)
    boundsRef.current.worldToLocal(vec)
    sphere.center.set(...wellboreBounds.main.center)
    sphere.radius = wellboreBounds.main.radius

    const mainDist = sphere.distanceToPoint(vec) / camera.zoom
    let dist = wellboreBounds.sampled.length ? Math.max(sphere.radius, mainDist) : Math.max(0, mainDist)

    if (mainDist <= 0 && wellboreBounds.sampled.length) {
      // negative distance means camera is inside main sphere, refine
      dist = wellboreBounds.sampled.reduce((min, s) => {
        sphere.center.set(...s.center)
        sphere.radius = s.radius
        const sampledDist = Math.max(0, sphere.distanceToPoint(vec) / camera.zoom)

        return Math.min(min, sampledDist)
      }, wellboreBounds.main.radius)
    }
    currentDistanceRef.current = dist
  }, [currentDistanceRef])

  useEffect(() => {
    if (boundsGenerator) {

      boundsGenerator(id, fromMsl, boundsSampleSize).then(boundsData => {
        if (boundsData) {
          const generatedBounds: WellboreBoundsType = {
            main: {
              center: [boundsData[0], boundsData[1], boundsData[2]],
              radius: boundsData[3]
            },
            sampled: []
          }

          for (let i = 4; i < boundsData.length; i += 4) {
            generatedBounds.sampled.push({
              center: [boundsData[i], boundsData[i + 1], boundsData[i + 2]],
              radius: boundsData[i + 3]
            })
          }
          setBounds(generatedBounds)

        }
      })
    }
  }, [id, boundsGenerator, fromMsl, boundsSampleSize])



  useFrame(({ camera }) => {
    if (bounds) {
      calculateDistance(bounds, camera as PerspectiveCamera)
    }
  })

  return (
    <object3D name="wellbore-bounds" ref={boundsRef}>
      <DistanceContext.Provider value={currentDistanceRef}>
        {children}
      </DistanceContext.Provider>
      { // for debug purposes
        visible && bounds && (
          <mesh name="wellbore-bounds-debug" position={bounds.main.center}>
            <sphereGeometry args={[bounds.main.radius, 32, 16]} />
            <meshBasicMaterial color="green" wireframe transparent opacity={0.1} />
          </mesh>
        )
      }
      {
        visible && bounds && bounds.sampled.map((s, i) => (
          <mesh name="wellbore-bounds-debug" key={i} position={s.center}>
            <sphereGeometry args={[s.radius, 16, 8]} />
            <meshBasicMaterial color="gray" wireframe transparent opacity={0.25} />
          </mesh>
        ))
      }
    </object3D>
  )
}
