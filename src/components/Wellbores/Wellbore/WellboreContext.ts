import { createContext } from 'react';

/**
 * WellboreContext props
 * @expand
 */
export type WellboreContextProps = {
  /** Wellbore id. */
  id: string;
  /** What should be considered the top of the wellbore for visualization purposes (may be different from kickoff). */
  fromMsl?: number;
  /** Number of segments to use per meter for visualization purposes. */
  segmentsPerMeter: number;
  /** A threshold value that can be set to reduce the number of segments where the trajectory is near linear. */
  simplificationThreshold: number;
};

/**
 * Wellbore context
 *
 * @see {@link Wellbore}
 * @see {@link useWellboreContext}
 *
 * @group Contexts
 */
export const WellboreContext = createContext<WellboreContextProps>(null!);
