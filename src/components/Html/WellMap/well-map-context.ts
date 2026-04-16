import { createContext, useContext } from 'react';
import { StoreApi, UseBoundStore } from 'zustand';
import { WellMapState } from './well-map-state';

/**
 * Context for providing `WellMap` state.
 *
 * @see {@link useWellMapState}
 * @see {@link WellMap}
 *
 * @group Contexts
 */
export const WellMapContext = createContext<
  UseBoundStore<StoreApi<WellMapState>>
>(null!);

/**
 * Allow child components of the `WellMap` component to get information from the well map state
 *
 * @example
 * const wellMapState = useWellMapState()
 *
 * const wellboresById = wellMapState(state => state.wellboresById)
 * const wellboresByName = wellMapState(state => state.wellboresByName)
 * const ratio = wellMapState(state => state.measures.ratio)
 * const domain = wellMapState(state => state.domain)
 * const range = wellMapState(state => state.measures.range)
 * const slotsById = wellMapState(state => state.slotsById)
 * const styles = wellMapState(state => state.styles)
 * const getSlotPosition = wellMapState(state => state.measures.getSlotPosition)
 *
 * @remarks
 * This is meant to be used for WellMap addons
 *
 * @see {@link WellMap}
 *
 * @group Hooks
 */
export const useWellMapState = () => {
  const context = useContext(WellMapContext);
  if (!context)
    throw Error(
      'WellMapState can only be used by children of the WellMap component!',
    );
  return context;
};
