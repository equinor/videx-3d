import { transfer } from 'comlink';
import { Store } from '../../sdk';
import { DataLoader } from '../../sdk/data/DataLoader';
import { get } from './api';

export const wellboreHeadersLoader = (store: Store) =>
  new DataLoader(store, {
    preloaded: true,
    init: async () => {
      const data = await get('/data/wellbore-headers.json');
      return Object.keys(data).map(key => {
        const record = data[key];
        const drilled = record.drilled ? new Date(record.drilled) : null;
        return [key, { ...record, drilled }];
      });
    },
  });

export const positionLogsLoader = (store: Store) =>
  new DataLoader(store, {
    preloaded: true,
    init: async () => {
      const positionLogsData = await get('/data/position-logs.json');
      return Object.keys(positionLogsData).map(key => [
        key,
        positionLogsData[key],
      ]);
    },
    transform: (r: number[]) => {
      // create a typed array of source data so it can be transferred using comlink
      const floatArray = new Float32Array(r);
      return transfer(floatArray, [floatArray.buffer]);
    },
  });

export const surfaceMetaLoader = (store: Store) =>
  new DataLoader(store, {
    preloaded: true,
    init: async () => {
      const data = await get('/data/surface-meta.json');
      return Object.keys(data).map(key => [key, data[key]]);
    },
  });

export const surfaceValuesLoader = (store: Store) =>
  new DataLoader(store, {
    load: async (key: string) => {
      return get(`/data/surfaces/${key}.json`);
    },
    transform: (r: number[]) => {
      // create a typed array of source data so it can be transferred using comlink
      const floatArray = new Float32Array(r);
      return transfer(floatArray, [floatArray.buffer]);
    },
  });

export const casingLoader = (store: Store) =>
  new DataLoader(store, {
    preloaded: true,
    init: async () => {
      const data = await get('/data/casings.json');
      return Object.keys(data).map(key => [key, data[key]]);
    },
  });

export const completionLoader = (store: Store) =>
  new DataLoader(store, {
    preloaded: true,
    init: async () => {
      const data = await get('/data/completion.json');
      return Object.keys(data).map(key => [key, data[key]]);
    },
  });

export const perforationLoader = (store: Store) =>
  new DataLoader(store, {
    preloaded: true,
    init: async () => {
      const data = await get('/data/perforations.json');
      return Object.keys(data).map(key => [key, data[key]]);
    },
  });

export const formationLoader = (store: Store) =>
  new DataLoader(store, {
    preloaded: true,
    init: async () => {
      const data = await get('/data/formations.json');
      return Object.keys(data).map(key => [key, data[key]]);
    },
  });

export const stratColumnLoader = (store: Store) =>
  new DataLoader(store, {
    preloaded: true,
    init: async () => {
      const data = await get('/data/strat-columns.json');
      return Object.keys(data).map(key => [key, data[key]]);
    },
  });

export const picksLoader = (store: Store) =>
  new DataLoader(store, {
    preloaded: true,
    init: async () => {
      const data = await get('/data/picks.json');
      return Object.keys(data).map(key => [key, data[key]]);
    },
  });
