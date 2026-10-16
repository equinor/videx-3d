import { createContext } from 'react';

export type DistanceContextProps = {
  current: number;
  /** How much `current` may exceed the true distance, when the provider knows. */
  tolerance?: number;
};

/**
 * A context for providing an object's distance to the camera. This will allow child
 * components to use the `Distance` component.
 *
 * @see {@link Distance}
 *
 * @group Contexts
 */
export const DistanceContext = createContext<DistanceContextProps>({
  current: Infinity,
});
