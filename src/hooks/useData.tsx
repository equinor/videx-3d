import { useContext, useEffect, useState } from 'react';
import { DataContext } from '../contexts/DataContext';
import { Store } from '../sdk/data/Store';

/**
 * Access the store from the `DataProvider` within a component to retrieve data.
 *
 * @example
 * const store = useData()
 *
 * @remarks
 * Use the store in a `useEffect` hook to retrieve the data you need and save it
 * to a local state (if required)
 *
 * @example
 * useEffect(() => {
 *   if (store) {
 *     store.get<WellboreHeader>('wellbore-headers', id).then(response => {
 *       ... // do something with the data
 *     })
 *   }
 * }, [store, id])
 *
 * @see [Data](/videx-3d/docs/documents/data.html)
 *
 * @group Hooks
 */
export const useData = () => {
  const dataContext = useContext(DataContext);
  const [store, setStore] = useState<Store | null>(null);

  useEffect(() => {
    if (dataContext) {
      const dataContextStore = dataContext.connect() as unknown as Store;

      // in order to set a comlink proxy to state, it needs to be added as an arrow function (https://github.com/GoogleChromeLabs/comlink/issues/571)
      setStore(() => dataContextStore);
    }
  }, [dataContext]);

  return store;
};
