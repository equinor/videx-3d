import { wrap } from 'comlink'
import { ReadonlyStore, Store } from '../data/Store'

export type GeneratorFunction = (
  this: ReadonlyStore,
  ...args: any[]
) => Promise<any>
export class GeneratorRegistry {
  protected store: ReadonlyStore | null = null

  protected generators: Map<string, GeneratorFunction> = new Map()

  constructor(store?: ReadonlyStore) {
    if (store) {
      this.store = store
    }
  }

  add(key: string, generator: GeneratorFunction) {
    this.generators.set(key, generator)
  }

  setStore(store: Store) {
    this.store = store
  }

  async connectRemoteStore(port: MessagePort) {
    const proxy = wrap(port)
    this.store = proxy as unknown as ReadonlyStore
  }

  async invoke<T>(key: string, ...args: any[]): Promise<T> {
    if (!this.store) throw Error('No available store!')

    if (!this.generators.has(key))
      throw Error(`Generator with key '${key}' not found!`)

    const generatorFunc = this.generators.get(key)!.bind(this.store)

    return generatorFunc(...args)
  }
}
