import { filter as _filter } from 'lodash';
import { KeyType, Store } from '../../sdk';
import { DataLoader } from '../../sdk/data/DataLoader';
import {
  casingLoader,
  completionLoader,
  formationLoader,
  perforationLoader,
  positionLogsLoader,
  surfaceMetaLoader,
  surfaceValuesLoader,
  wellboreHeadersLoader,
} from './loaders';

export class MockStore implements Store {
  private _loaders: Map<string, DataLoader> = new Map();
  private _initialized: Promise<boolean[]> | null = null;

  constructor() {
    this._loaders.set('wellbore-headers', wellboreHeadersLoader(this));
    this._loaders.set('position-logs', positionLogsLoader(this));
    this._loaders.set('surface-meta', surfaceMetaLoader(this));
    this._loaders.set('surface-values', surfaceValuesLoader(this));
    this._loaders.set('formations', formationLoader(this));
    this._loaders.set('casings', casingLoader(this));
    this._loaders.set('completion-tools', completionLoader(this));
    this._loaders.set('perforations', perforationLoader(this));

    // For the mock store used in our storybooks, we only need to preload data once.
    // In a real scenario, you would typically re-initialize preloaded data based on
    // some parameters within your application's workflow.
    const dataInitializers: Promise<boolean>[] = [];

    this._loaders.forEach(loader => {
      if (loader.config.preloaded) {
        dataInitializers.push(loader.init());
      }
    });
    this._initialized = Promise.all(dataInitializers);
  }

  loader(dataType: string): DataLoader {
    if (this._loaders.has(dataType)) {
      return this._loaders.get(dataType)!;
    }
    throw Error('No loader registered for data type: ' + dataType);
  }

  async all<T>(dataType: string): Promise<T[] | null> {
    await this._initialized;
    return this.loader(dataType).all<T>();
  }

  async get<T>(dataType: string, key: KeyType, args?: any) {
    await this._initialized;
    return this.loader(dataType).get<T>(key, args);
  }

  async query<T>(dataType: string, query: Partial<T>): Promise<T[]> {
    if (query) {
      const data = await this.all<T>(dataType);
      return data ? _filter(data, query as any) : [];
    }
    return (await this.all<T>(dataType)) || [];
  }

  async set<T>(dataType: string, key: KeyType, value: T) {
    this.loader(dataType).set(key, value);
    return true;
  }
}
