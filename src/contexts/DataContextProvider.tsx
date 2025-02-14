import { Remote, createEndpoint } from 'comlink'
import { ReactNode, useCallback, useMemo } from 'react'
import { Store } from '../sdk/data/Store'
import { DataContext } from './DataContext'

/**
 * DataProvider props
 * @expand
 */
export type DataProviderProps = {
  store: Store | Remote<Store>,
  children: ReactNode
}

function isRemoteStore(store: Store | Remote<Store>): store is Remote<Store> {
  const remoteStore = store as Remote<Store>
  return !!remoteStore[createEndpoint]
}

/**
 * Provides sub components with the `DataContext`, which allow connecting to the
 * `Store` implementation. You can create your own provider if needed, but it will need to
 * provide an implementation of the `DataContext`.
 * 
 * @example
 * <DataProvider store={store}>
 *  { ... }
 * </DataProvider>
 * 
 * @remarks 
 * Components should use the `useData` hook to access the store. Generator functions
 * will have the store injected by the `GeneratorsProvider` provider component. 
 * 
 * @see {@link Store}
 * @see {@link DataContext}
 * @see {@link useData}
 * @see [Data](/videx-3d/docs/documents/data.html)
 * 
 * @group Components
 */
export const DataProvider = ({ store, children }: DataProviderProps) => {
  const isRemote = useMemo(() => isRemoteStore(store), [store])

  const connect = useCallback(() => {
    return store as Store
  }, [store])

  const connectByMessagePort = useCallback(() => {
    if (isRemote) {
      const remoteStore = store as Remote<Store>
      const portPromise = remoteStore[createEndpoint]()
      return portPromise
    }
    return Promise.reject('Unable to connect to store!')
  }, [store, isRemote])

  

  return (
    <DataContext.Provider value={{ isRemote, connect, connectByMessagePort }}>
      { children }
    </DataContext.Provider>
  )
}