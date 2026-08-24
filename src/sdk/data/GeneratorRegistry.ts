import { releaseProxy, Remote, wrap } from 'comlink';
import pLimit from 'p-limit';
import { KeyType, ReadonlyStore } from '../data/Store';

export type RegistryConfig = {
  concurrentStoreCalls?: number;
};

export type GeneratorFunction = (
  this: ReadonlyStore,
  ...args: any[]
) => Promise<any>;

export class GeneratorRegistry {
  protected store: ReadonlyStore | null = null;
  protected storeProxy: Remote<ReadonlyStore> | null = null;
  protected config: RegistryConfig;
  protected generators: Map<string, GeneratorFunction> = new Map();

  /** The store a generator is bound to. STABLE across reconnects — see `setStore`. */
  private facade: ReadonlyStore | null = null;
  private limit: ReturnType<typeof pLimit> | null = null;
  private running = 0;

  constructor(config: RegistryConfig = {}, store?: ReadonlyStore) {
    this.config = { concurrentStoreCalls: 0, ...config };

    if (store) {
      this.setStore(store);
    }
  }

  add(key: string, generator: GeneratorFunction) {
    this.generators.set(key, generator);
  }

  setStore(store: ReadonlyStore) {
    this.store = store;
    // ⭐ A generator is bound to this object for the whole of its run, so it must
    // OUTLIVE a reconnect: it reads `this.store` per call, which means a build
    // still in flight when the channel is re-opened continues on the new one
    // instead of on a proxy that is about to be released.
    if (!this.facade) {
      const at = () => {
        if (!this.store) throw Error('No available store!');
        return this.store;
      };
      const run = <T>(fn: () => Promise<T>) =>
        this.limit ? this.limit(fn) : fn();
      this.facade = {
        get: <T>(dataType: string, key: KeyType, args?: any) =>
          run(() => at().get<T>(dataType, key, args)),
        all: <T>(dataType: string) => run(() => at().all<T>(dataType)),
        query: <T>(dataType: string, query: Partial<T>) =>
          run(() => at().query<T>(dataType, query)),
      };
    }
    if (this.config.concurrentStoreCalls && !this.limit) {
      this.limit = pLimit(this.config.concurrentStoreCalls);
    }
  }

  async connectRemoteStore(port: MessagePort) {
    // Every provider mount opens a NEW channel. The previous proxy has to be
    // released — otherwise the store keeps answering on a port nothing reads, and
    // the listener holding it is never removed.
    const previous = this.storeProxy;
    const proxy = wrap<ReadonlyStore>(port);
    this.storeProxy = proxy;
    this.setStore(proxy as unknown as ReadonlyStore);
    // ⚠️⚠️ NOT immediately: a build in flight is awaiting `store.get` on the old
    // proxy, and releasing it makes every further call throw 'Proxy has been
    // released' — which kills the build and leaves the chunk empty with no error
    // the caller can see. Hand the port back once the work that was using it has
    // drained.
    if (previous) this.releaseWhenIdle(previous);
  }

  private releaseWhenIdle(proxy: Remote<ReadonlyStore>, waited = 0) {
    // Bounded, so a generator that never settles cannot pin the port for good.
    if (this.running === 0 || waited > 30000) {
      proxy[releaseProxy]();
      return;
    }
    setTimeout(() => this.releaseWhenIdle(proxy, waited + 250), 250);
  }

  async invoke<T>(key: string, ...args: any[]): Promise<T> {
    if (!this.store || !this.facade) throw Error('No available store!');

    if (!this.generators.has(key))
      throw Error(`Generator with key '${key}' not found!`);

    const generatorFunc = this.generators.get(key)!.bind(this.facade);

    this.running++;
    try {
      return await generatorFunc(...args);
    } finally {
      this.running--;
    }
  }
}
