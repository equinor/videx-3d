import { useFrame } from '@react-three/fiber'
import { ReactNode, startTransition, useContext, useRef, useState } from 'react'
import { Group } from 'three'
import { DistanceContext } from './DistanceContext'

/**
 * Distance props
 * @expand
 */
export type DistanceProps = {
  min?: number,
  max: number,
  onDemand?: boolean,
  children: ReactNode
}

/**
 * The Distance component can be used to conditionally render other components.
 * 
 * @example
 * <Wellbore id={wellboreId}>
 *  { // DistanceContext provider }
 *   <WellboreBounds id={wellboreId}>
 *     <BasicTrajectory />
 *     <Distance min={0} max={2000}>
 *       <TubeTrajectory />
 *     </Distance>
 *   </WellboreBounds>
 * </Wellbore>
 * 
 * @remarks
 * This component depends on a `DistanceContext` being provided by a parent component.
 * 
 * @see [Storybook](/videx-3d/?path=/docs/components-misc-distance--docs) 
 * @see {@link DistanceContext}
 * @see {@link WellboreBounds}
 * 
 * @group Components
 */

export const Distance = ({ min = 0, max, onDemand = false, children }: DistanceProps) => {
  const distanceContext = useContext(DistanceContext)
  const ref = useRef<Group>(null)
  const [demanded, setDemanded] = useState(!onDemand)

  useFrame(() => {
    if (distanceContext && ref.current) {
      const isVisible = distanceContext.current >= min && distanceContext.current < max
      if (onDemand && isVisible && !demanded) {
        startTransition(() => setDemanded(true))
      } else if (onDemand && !isVisible && demanded) {
        startTransition(() => setDemanded(false))
      } else if (ref.current.visible !== isVisible) {
        ref.current.visible = isVisible 
      }  
    }

  })

  return (
    <group ref={ref} visible={false}>
      { demanded && children}
    </group>
  )
}