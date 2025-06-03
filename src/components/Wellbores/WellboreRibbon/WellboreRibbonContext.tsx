
import { createContext } from 'react'
import { InstancedBufferGeometry } from 'three'
import { Trajectory, Vec3 } from '../../../sdk'



/**
 * GlyphsContext props
 * @expand
 */
export type WellboreRibbonContextProps = {
  trajectory: Trajectory
  geometry: InstancedBufferGeometry
  direction: Vec3
}

/**
 * Glyphs context
 * @group Contexts
 */
export const WellboreRibbonContext = createContext<WellboreRibbonContextProps | null>(null)