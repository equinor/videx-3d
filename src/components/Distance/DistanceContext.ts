import { createContext } from 'react'

export type DistanceContextProps = {
  current: number
}

/**
 * A context for providing an object's distance to the camera. This will allow child
 * components to use the `Distance` component.
 * 
 * @see {@link Distance}
 * 
 * @group Contexts
 */
export const DistanceContext = createContext<DistanceContextProps>({ current: Infinity })
