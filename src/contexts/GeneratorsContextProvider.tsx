import { Remote, createEndpoint, proxy, transfer } from 'comlink'
import PQueue from 'p-queue'
import { ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { GeneratorRegistry } from '../sdk/data/GeneratorRegistry'
import { DataContext } from './DataContext'
import { GeneratorsContext } from './GeneratorsContext'

// TODO: Should I create a controller class that contains the queue logic?

/**
 * GeneratorsProvider props
 * @expand
 */
export type GeneratorsProviderProps = {
  registry: GeneratorRegistry | Remote<GeneratorRegistry>
  concurrency?: number
  signal?: AbortSignal
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
 * @see [Generators](/videx-3d/docs/documents/generators.html)
 * 
 * @group Components
 */
export const GeneratorsProvider = ({ registry, concurrency = Infinity, signal, children }: GeneratorsProviderProps) => {
  const [isReady, setIsReady] = useState(false)
  const queue = useRef<PQueue>(new PQueue({ concurrency }))
  const suspended = useRef(false);

  const dataContext = useContext(DataContext)

  const isRemote = useMemo(() => isRemoteRegistry(registry), [registry])

  const registryContext = useMemo(() => {
    const invoke = async <T,>(key: string, priority: number, args: any[]) => {
      if (suspended.current) return Promise.reject('aborted')
      return queue.current.add(() => {
        if (suspended.current) return Promise.reject('aborted')
        return registry.invoke<T>(key, ...args)
      }, { priority }) as T
    }
    return { invoke }
  }, [registry])

  useEffect(() => {
    const currentQueue = queue.current
    return () => {
      if (currentQueue) {
        currentQueue.clear()
      }
    }
  }, [])

  useEffect(() => {
    suspended.current = !!signal?.aborted
  }, [signal])

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

  useEffect(() => {
    if (signal && !signal.aborted) {
      function onAbort() {
        suspended.current = true
        queue.current?.clear()
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  }, [signal])

  return (
    <GeneratorsContext.Provider value={registryContext}>
      {isReady && children}
    </GeneratorsContext.Provider>
  )
}