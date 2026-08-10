import { transfer } from 'comlink';
import { group } from 'd3-array';
import {
  CasingItem,
  getProjectedTrajectory,
  getTrajectory,
  KeyType,
  PositionLog,
  Store,
  WellboreHeader,
} from '../../sdk';
import { DataLoader } from '../../sdk/data/DataLoader';
import { VerticalSlice } from '../../sdk/data/types/VerticalSlice';
import {
  getSyntheticSurface,
  isSyntheticSurfaceId,
  syntheticSurfaceIds,
} from '../data/synthetic-surfaces';
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
      const real = Object.keys(data).map(key => [key, data[key]]);
      // Generated surfaces are listed alongside the real ones so anything that
      // enumerates the catalogue (story pickers, the strat sort) sees them too.
      const synthetic = syntheticSurfaceIds
        .map(id => getSyntheticSurface(id))
        .filter(s => s !== null)
        .map(s => [s.meta.id, s.meta]);
      return [...real, ...synthetic] as [KeyType, any][];
    },
  });

export const surfaceValuesLoader = (store: Store) =>
  new DataLoader(store, {
    load: async (key: KeyType) => {
      if (isSyntheticSurfaceId(key)) {
        // Generated on demand and memoized by the registry; the buffer is copied
        // per request below, exactly as for a fetched grid.
        const surface = getSyntheticSurface(key);
        return surface ? surface.values.buffer : new Float32Array(0).buffer;
      }
      const values = await get(`/data/surfaces/${key}.json`);
      // The source is a JSON number[] — parsing one field-scale grid costs ~260ms
      // and the parsed array holds 8 bytes per sample. Convert once on load and
      // cache the compact 4-byte-per-sample buffer instead, so repeat requests
      // cost a memcpy rather than a reparse (and the cache is ~2x smaller).
      return new Float32Array(values).buffer;
    },
    transform: (buffer: ArrayBuffer) => {
      // comlink transfer DETACHES the buffer it is given, so hand out a copy and
      // keep the cached one intact for the next request.
      const copy = buffer.slice(0);
      return transfer(new Float32Array(copy), [copy]);
    },
  });

function transformCasingData(items: CasingItem[]) {
  const grouped = group(items, d => d.properties.Diameter);

  const merged: CasingItem[] = [];

  grouped.forEach((groupItems: any[]) => {
    let max = Infinity;

    const shoe = groupItems.find(d => d.type.toLowerCase().includes('shoe'));
    if (shoe) {
      max = shoe.mdTopMsl;
      merged.push({ ...shoe, isShoe: true });
    }

    const filtered = groupItems.filter(
      d => !d.type.toLowerCase().includes('shoe') && d.mdTopMsl < max,
    );

    if (filtered.length) {
      const section = filtered.reduce<CasingItem>(
        (obj: CasingItem, itm: CasingItem) => {
          if (itm.mdBottomMsl > obj.mdBottomMsl) {
            obj.mdBottomMsl = Math.min(max, itm.mdBottomMsl);
          }
          if (itm.mdTopMsl < obj.mdTopMsl) {
            obj.mdTopMsl = itm.mdTopMsl;
          }
          return obj;
        },
        {
          innerDiameter: groupItems[0].innerDiameter,
          outerDiameter: groupItems[0].outerDiameter,
          mdTopMsl: groupItems[0].mdTopMsl,
          mdBottomMsl: groupItems[0].mdBottomMsl,
          type: 'Casing',
          properties: {
            Diameter: groupItems[0].properties.Diameter,
            Type: 'Casing',
          },
        },
      );
      merged.push(section);
    }
  });

  return merged;
}

export const casingLoader = (store: Store) =>
  new DataLoader(store, {
    preloaded: true,
    init: async () => {
      // Overlapping casing items with the same size will be merged to a single casing section.
      const data = await get('/data/casings.json');
      return Object.keys(data).map(key => [
        key,
        transformCasingData(data[key]) as any,
      ]);
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

/*
  This function will generate dummy data based on an existing seismic slice.
  This means that all wellbores will read from the same slice, but adapt the
  number of samples to the calculated trajectory of the wellbore.

  For an actual use-case, you would need an api serving true samples based
  on input coordinates.
*/
export const wellboreSeismicSectionLoader = (store: Store) =>
  new DataLoader(store, {
    noCache: true,
    load: async <T>(id: KeyType, args?: any): Promise<T | null> => {
      const data = await get('/data/seismic.json');
      if (!data) return null;
      const poslog = await store.get<PositionLog>('position-logs', id);
      const header = await store.get<WellboreHeader>('wellbore-headers', id);
      if (!header || !poslog) return null;

      const trajectory = getTrajectory(id as string, poslog);

      if (!trajectory) return null;

      const stepSize = args.stepSize || 3;
      const extension = Number.isFinite(args.extension) ? args.extension : 0;
      const minSize = Number.isFinite(args.minSize) ? args.minSize : 0;
      const defaultAngle = Number.isFinite(args.defaultExtensionAngle)
        ? args.defaultExtensionAngle
        : 0;

      const sampledPath = trajectory.curve.getPoints(
        trajectory.measuredLength * 10,
      );
      const projectedTrajectory = getProjectedTrajectory(
        sampledPath,
        stepSize,
        extension,
        minSize,
        defaultAngle,
      );

      if (!projectedTrajectory) return null;

      const sourceWidth = data.xsamples;
      const width = projectedTrajectory.positions.length;
      const height = data.ysamples;

      const values = new Float32Array(width * height);

      for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
          const overScan = Math.floor(c / sourceWidth);
          const reverse = overScan % 2 === 1;

          const itrg = r * width + c;

          // if we read beyond the number of columns we will
          // repeat the data by shifting column read direction
          const sourceCol = c % sourceWidth;
          const readCol = reverse ? sourceWidth - 1 - sourceCol : sourceCol;
          const isrc = r * sourceWidth + readCol;
          values[itrg] = data.values[isrc] / data.scaleFactor;
        }
      }

      const slice: VerticalSlice = {
        depthRange: [data.top, data.bottom],
        samples: [width, height],
        trajectory: projectedTrajectory,
        values,
        valueRange: [data.min, data.max],
      };

      return slice as T;
    },
  });
