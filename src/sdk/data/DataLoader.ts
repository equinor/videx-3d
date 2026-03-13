import { KeyType, Store } from './Store';

const defaultBatchSize = 10;
const defaultBatchMaxDelay = 25;

/**
 * Used internally by DataLoader class
 */
export type BatchQueueEntry = {
  key: KeyType;
  promise: Promise<any>;
  _resolve: ((value?: any) => void) | null;
};

/**
 * Loader Config
 */
export type LoaderConfig = {
  preloaded?: boolean;
  batched?: boolean;
  batchSize?: number;
  batchMaxDelay?: number;
  noCache?: boolean;
  transform?: (record: any) => any;
  init?: <T>(...args: any[]) => Promise<[KeyType, T][]>;
  load?: <T>(...args: any[]) => Promise<T | null>;
  batchLoad?: <T>(...args: any[]) => Promise<[KeyType, T][]>;
};

/**
 * This is a helper class that may be used to simplify implementation
 * of the Store interface. The Store may be implemented as you wish, as
 * long as it adapts to the interface, but this class can be useful for
 * managing loading on demand, caching, preloading and more.
 *
 * You would typically build your store to hold a loader instance per
 * data type. See the implementation of the MockStore for example usage.
 *
 * The DataLoader has the following features:
 * - optional caching of data
 * - preload complete data set or on-demand loading of data (single record or batched)
 * - promise sharing of multiple requests for the same data record
 */
export class DataLoader {
  store: Store;
  config: LoaderConfig;
  cached: Map<KeyType, unknown> = new Map();

  private _activeLoaders: Record<string, Promise<any>> = {};
  private _batchqueue: Map<KeyType, BatchQueueEntry> = new Map();
  private _flushScheduled: any = null;

  constructor(store: Store, config: LoaderConfig = {}) {
    this.store = store;
    this.config = { ...config };

    if (this.config.batched) {
      if (this.config.batchSize === undefined) {
        this.config.batchSize = defaultBatchSize;
      }

      if (this.config.batchMaxDelay === undefined) {
        this.config.batchMaxDelay = defaultBatchMaxDelay;
      }
    }
    this._flushScheduled = null;
  }

  async init(...args: any[]) {
    if (this.config.init) {
      try {
        const result = await this.config.init(...args);
        if (Array.isArray(result)) {
          this.cached = new Map(result);
          return true;
        }
      } catch (err) {
        console.warn('Init failed', err);
      }
    }
    this.clear();
    return false;
  }

  async all<T>(): Promise<T[] | null> {
    if (this.config.preloaded) {
      if (this.config.transform) {
        const transform = this.config.transform;
        return Array.from(this.cached.values()).map(r => transform(r)) as T[];
      }
      return Array.from(this.cached.values()) as T[];
    } else {
      console.warn('Data Loader: "all" called on non-preloaded dataset!');
    }
    return [];
  }

  async _enqueueRequest(key: KeyType) {
    if (this._batchqueue.has(key)) {
      return this._batchqueue.get(key)!.promise;
    }

    let _resolve = null;

    const promise = new Promise(resolve => {
      _resolve = resolve;
    });

    const queueEntry: BatchQueueEntry = {
      key,
      promise,
      _resolve,
    };

    this._batchqueue.set(key, queueEntry);

    if (!this._flushScheduled) {
      this._flushScheduled = setTimeout(() => {
        this._processBatchQueue();
      }, this.config.batchMaxDelay);
    }
    return promise;
  }

  async _processBatch(batch: BatchQueueEntry[]) {
    //console.log('processBatch', batch)
    const args = batch.map(item => item.key);

    if (!this.config.batchLoad) return null;

    this.config
      .batchLoad(args)
      .then(result => {
        if (Array.isArray(result)) {
          result.forEach(([key, value]) => {
            this.set(key, value);
          });
        }
      })
      .catch(err => {
        console.warn('Batch load failed', err);
      })
      .finally(() => {
        batch.forEach(item => {
          const value = this.cached.get(item.key) || null;
          item._resolve!(value);
        });
        //console.log('processBatch complete!')
      });
  }

  async _processBatchQueue() {
    //console.log('processBatchQueue', this._batchqueue.size)
    let batch = [];
    for (const item of this._batchqueue.values()) {
      batch.push(item);
      this._batchqueue.delete(item.key);
      if (
        batch.length >= this.config.batchSize! ||
        this._batchqueue.size === 0
      ) {
        this._processBatch(batch);
        batch = [];
      }
    }
    //console.log('processBatchQueue completed', this._batchqueue.size)

    if (this._batchqueue.size) {
      this._flushScheduled = setTimeout(() => this._processBatchQueue(), 1);
    } else {
      this._flushScheduled = null;
    }
  }

  async get<T>(key: KeyType, args?: any): Promise<T | null> {
    if (this.cached.has(key)) {
      if (this.config.transform) {
        return this.config.transform(this.cached.get(key)) as T;
      }
      return this.cached.get(key) as T;
    }

    if (this.config.preloaded) return null;

    if (!this.config.batched && this.config.load) {
      if (this.config.noCache) {
        return this.config.load(key, args);
      }
      let promise = this._activeLoaders[key];
      if (!promise) {
        if (args)
          throw Error(
            'DataLoader: A load function with additional args may not be cached. Set noCache to true in config.',
          );
        promise = this.config
          .load(key)
          .then(value => {
            if (value) {
              this.cached.set(key, value);
            }
          })
          .catch(err => {
            console.warn('Load failed', err);
          })
          .finally(() => {
            delete this._activeLoaders[key];
          });
        this._activeLoaders[key] = promise;
      }
      await promise;
      if (this.config.transform) {
        return this.config.transform(this.cached.get(key)) as T;
      }
      return this.cached.get(key) as T;
    }

    if (this.config.batched && this.config.batchLoad) {
      return this._enqueueRequest(key);
    }

    return null;
  }

  set<T>(key: KeyType, value: T): void {
    this.cached.set(key, value);
  }

  clear(): void {
    this.cached.clear();
  }
}
