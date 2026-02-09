import { transfer } from 'comlink';
import _filter from 'lodash.filter';
import { KeyType, Store } from '../../sdk';
import { get } from './api';
import {
  loadCasings,
  loadCompletion,
  loadFormations,
  loadPerforations,
  //loadPicks,
  loadPositionLogs,
  //loadStratColumns,
  loadSurfaceMeta,
  loadWellboreHeaders,
} from './loaders';

export class MockStore implements Store {
  private loaders: Record<string, () => Promise<any>> = {
    'position-logs': loadPositionLogs,
    'wellbore-headers': loadWellboreHeaders,
    casings: loadCasings,
    'completion-tools': loadCompletion,
    perforations: loadPerforations,
    //picks: loadPicks,
    'surface-meta': loadSurfaceMeta,
    //'strat-columns': loadStratColumns,
    formations: loadFormations,
  };
  private data: Record<string, Record<KeyType, any>> = {};

  private activeLoaders: Record<string, Promise<unknown>> = {};

  private async getDataCollection(
    dataType: string,
  ): Promise<Record<string, any> | null> {
    if (this.data[dataType] === undefined) {
      if (this.activeLoaders[dataType] !== undefined) {
        await this.activeLoaders[dataType];
      } else {
        const loader = this.loaders[dataType];
        if (!loader)
          throw Error('No loader registered for data type: ' + dataType);
        const promise = loader()
          .then(loadedData => {
            this.data[dataType] = loadedData || {};
          })
          .finally(() => {
            delete this.activeLoaders[dataType];
          });
        this.activeLoaders[dataType] = promise;
        await promise;
      }
    }
    return this.data[dataType];
  }

  public async get<T>(dataType: string, key: KeyType): Promise<T | null> {
    // read surface values from file due to size

    if (dataType === 'surface-values') {
      const values = await get(`/data/surfaces/${key}.json`);
      const data = new Float32Array(values);
      if (data) {
        return transfer(data, [data.buffer]) as T;
      }

      return null;
    }
    const collection = await this.getDataCollection(dataType);
    const data = collection && collection[key] ? (collection[key] as T) : null;

    if (data && data instanceof Float32Array && data.length > 0) {
      const copy = new Float32Array(data);
      return transfer(copy, [copy.buffer]) as T;
    }

    return data;
  }

  public async set<T>(dataType: string, key: KeyType, value: T) {
    if (this.data[dataType] === undefined) {
      this.data[dataType] = {};
    }
    this.data[dataType][key] = value;
    return true;
  }

  public async all<T>(dataType: string): Promise<T[]> {
    const collection = await this.getDataCollection(dataType);
    return (collection ? Object.values(collection) : []) as T[];
  }

  public async query<T>(dataType: string, query: Partial<T>): Promise<T[]> {
    if (query) {
      const data = await this.all<T>(dataType);
      return data ? (_filter(data, query) as T[]) : [];
    }
    return this.all<T>(dataType);
  }
}
