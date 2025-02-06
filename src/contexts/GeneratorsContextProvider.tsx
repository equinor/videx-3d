import { ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { DataContext } from './DataContext'
import { Remote, createEndpoint, proxy, transfer } from 'comlink'
import { GeneratorRegistry } from '../sdk/data/GeneratorRegistry'
import { GeneratorsContext } from './GeneratorsContext'

/**
 * GeneratorsProvider props
 * @expand
 */
export type GeneratorsProviderProps = {
  registry: GeneratorRegistry | Remote<GeneratorRegistry>,
  isRemote?: boolean,
  children: ReactNode
}

function isRemoteRegistry(registry: GeneratorRegistry | Remote<GeneratorRegistry>): registry is Remote<GeneratorRegistry> {
  const remoteRegistry = registry as Remote<GeneratorRegistry>
  return !!remoteRegistry[createEndpoint]
}

/**
 * Provides sub components with the `GeneratorRegistry`, which allow access to the
 * registered _generator_ functions. You can create your own provider if needed, but it will need to
 * provide an implementation of the `GeneratorsContext`.
 * 
 * @example
 * <GeneratorsProvider registry={registry}>
 *  { ... }
 * </GeneratorsProvider>
 * 
 * @remarks 
 * Components should use the `useGenerator` hook to access generator functions. 
 * 
 * @see {@link GeneratorRegistry}
 * @see {@link GeneratorsContext}
 * @see {@link useGenerator}
 * @see [Generators](/docs/documents/generators.html)
 * 
 * @group Components
 */
export const GeneratorsProvider = ({ registry, children }: GeneratorsProviderProps) => {
  const [isReady, setIsReady] = useState(false)

  const dataContext = useContext(DataContext)

  const isRemote = useMemo(() => isRemoteRegistry(registry), [registry])
  
  useEffect(() => {
    if (dataContext) {
      if (dataContext.isRemote && isRemote) {
        dataContext.connectByMessagePort().then(port => {
          if (port) {
            registry.connectRemoteStore(transfer(port, [port])).then(() => setIsReady(true))
          } else {
            throw Error('Unable to get port!')
          }
        })
      } else {
        const store = dataContext.connect()
        if (store) {
          registry.setStore(isRemote ? proxy(store) : store)
          setIsReady(true)
        }
      }
    }
  }, [dataContext, registry, isRemote])

  return (
    <GeneratorsContext.Provider value={registry}>
      { isReady && children }
    </GeneratorsContext.Provider>
  )
}