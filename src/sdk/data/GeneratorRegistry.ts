import { wrap } from 'comlink'
import pLimit from 'p-limit'
import { KeyType, ReadonlyStore } from '../data/Store'

export type RegistryConfig = {
  concurrentStoreCalls?: number
}

export type GeneratorFunction = (
  this: ReadonlyStore,
  ...args: any[]
) => Promise<any>

export class GeneratorRegistry {
  protected store: ReadonlyStore | null = null
  protected config: RegistryConfig
  protected generators: Map<string, GeneratorFunction> = new Map()

  constructor(config: RegistryConfig = {}, store?: ReadonlyStore) {
    this.config = { concurrentStoreCalls: 0, ...config }

    if (store) {
      this.setStore(store)
    }
  }

  add(key: string, generator: GeneratorFunction) {
    this.generators.set(key, generator)
  }

  setStore(store: ReadonlyStore) {   
    if (store && this.config.concurrentStoreCalls) {
      const limit = pLimit(this.config.concurrentStoreCalls)
      const throttledStore = {
        get: <T>(dataType: string, key: KeyType) =>
          limit(() => store.get<T>(dataType, key)),
        all: <T>(dataType: string) => limit(() => store.all<T>(dataType)),
        query: <T>(dataType: string, query: Partial<T>) => limit(() => store.query(dataType, query)),
      }
      this.store = throttledStore
    } else {
      this.store = store
    }
  }

  async connectRemoteStore(port: MessagePort) {
    const proxy = wrap(port)
    this.setStore(proxy as unknown as ReadonlyStore)
  }

  async invoke<T>(key: string, ...args: any[]): Promise<T> {
    if (!this.store) throw Error('No available store!')

    if (!this.generators.has(key))
      throw Error(`Generator with key '${key}' not found!`)

    const generatorFunc = this.generators.get(key)!.bind(this.store)

    return generatorFunc(...args)
  }
}
