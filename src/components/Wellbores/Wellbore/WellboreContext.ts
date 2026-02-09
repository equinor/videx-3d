import { createContext } from 'react';

/**
 * WellboreContext props
 * @expand
 */
export type WellboreContextProps = {
  // wellbore id
  id: string;
  // what should be considered the top of the wellbore for visualization purposes (may be different from kickoff)
  fromMsl?: number;
  // number of segments to use per meter for visualization purposes
  segmentsPerMeter: number;
  // a threshold value that can be set to reduce the number of segments where the trajectory is near linear
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
