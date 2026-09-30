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
  /**
   * In-flight store CALLS per proxy. A retired proxy is released the instant its
   * own count reaches 0, so a build still reading the old channel is never cut off
   * and an idle one is not pinned waiting on unrelated work.
   */
  private inFlight = new Map<Remote<ReadonlyStore>, number>();
  /** Proxies replaced by a reconnect, awaiting their last call to drain. */
  private pendingRelease = new Set<Remote<ReadonlyStore>>();

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
      const run = <T>(
        fn: (active: ReadonlyStore) => Promise<T>,
      ): Promise<T> => {
        const exec = () => {
          const active = at();
          // Count the call against the proxy actually serving it, so retiring a
          // proxy waits for exactly the calls that used it — no more, no less.
          const proxy =
            this.storeProxy && (active as unknown) === this.storeProxy
              ? this.storeProxy
              : null;
          if (proxy)
            this.inFlight.set(proxy, (this.inFlight.get(proxy) ?? 0) + 1);
          return Promise.resolve()
            .then(() => fn(active))
            .finally(() => {
              if (proxy) this.retire(proxy);
            });
        };
        return this.limit ? this.limit(exec) : exec();
      };
      this.facade = {
        get: <T>(dataType: string, key: KeyType, args?: any) =>
          run(active => active.get<T>(dataType, key, args)),
        all: <T>(dataType: string) => run(active => active.all<T>(dataType)),
        query: <T>(dataType: string, query: Partial<T>) =>
          run(active => active.query<T>(dataType, query)),
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
    // ⚠️ NOT immediately: a build in flight is awaiting `store.get` on the old
    // proxy, and releasing it makes every further call throw 'Proxy has been
    // released' — which kills the build and leaves the chunk empty with no error
    // the caller can see. Release it once the calls that were using it have
    // drained, which is right now if none are in flight.
    if (previous && previous !== proxy) {
      if ((this.inFlight.get(previous) ?? 0) === 0) previous[releaseProxy]();
      else this.pendingRelease.add(previous);
    }
  }

  /** One store call on `proxy` has settled; release it if it was retired and idle. */
  private retire(proxy: Remote<ReadonlyStore>) {
    const remaining = (this.inFlight.get(proxy) ?? 0) - 1;
    if (remaining > 0) {
      this.inFlight.set(proxy, remaining);
      return;
    }
    this.inFlight.delete(proxy);
    if (this.pendingRelease.delete(proxy)) proxy[releaseProxy]();
  }

  async invoke<T>(key: string, ...args: any[]): Promise<T> {
    if (!this.store || !this.facade) throw Error('No available store!');

    if (!this.generators.has(key))
      throw Error(`Generator with key '${key}' not found!`);

    const generatorFunc = this.generators.get(key)!.bind(this.facade);

    return generatorFunc(...args);
  }
}
