import { useContext } from 'react';
import {
  WellboreContext,
  WellboreContextProps,
} from '../components/Wellbores/Wellbore/WellboreContext';

/**
 * Get the wellbore context from a parent `Wellbore` component.
 *
 *
 * @example
 * const { id } = useWellboreContext()
 *
 * @see {@link Wellbore}
 *
 * @group Hooks
 */
export const useWellboreContext = () => {
  const context = useContext<WellboreContextProps>(WellboreContext);
  if (!context) {
    throw Error(
      'useWellboreContext may only be used within a Wellbore component!',
    );
  }
  return context;
};
