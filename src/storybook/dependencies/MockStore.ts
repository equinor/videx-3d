import { filter as _filter } from 'lodash';
import { FIELD_COLUMN_SEISMIC_SECTION, KeyType, Store } from '../../sdk';
import { DataLoader } from '../../sdk/data/DataLoader';
import { BAKED_RELIEF_PREFIX } from '../data/baked-reliefs';
import { STAGE_GROUND_PREFIX } from '../data/stage-ground';
import {
  getSyntheticColumn,
  getSyntheticSurface,
  isSyntheticSurfaceId,
  SYNTHETIC_COLUMN,
  SYNTHETIC_COLUMN_PREFIX,
  SYNTHETIC_PREFIX,
  syntheticSurfaceIdsOf,
} from '../data/synthetic-surfaces';
import {
  casingLoader,
  completionLoader,
  fieldColumnSeismicSectionLoader,
  formationLoader,
  HeldSynthetic,
  perforationLoader,
  positionLogsLoader,
  reliefMetaLoader,
  reliefValuesLoader,
  surfaceMetaLoader,
  surfaceValuesLoader,
  syntheticColumnLoader,
  wellboreHeadersLoader,
  wellboreSeismicSectionLoader,
} from './loaders';

/**
 * What a story's store holds besides the demo files (`parameters.store`, `MockStore.init`):
 * the generated surfaces (`storybook/data/synthetic-surfaces.ts`) it uses, by key, or all.
 */
export type StoryStoreData = {
  /** generated scenarios by key (`syntheticScenarioKeys`), e.g. `['cap-seabed']`, or all */
  syntheticScenarios?: readonly string[] | 'all';
  /** generated columns by key (`syntheticColumnKeys`), all their units' surfaces, or all */
  syntheticColumns?: readonly string[] | 'all';
};

// The generated surface a loader's key names: a surface's own id, or one baked into a relief
// (not the stage's ground, whose reliefs share the prefix).
const syntheticIdOf = (key: KeyType) => {
  if (typeof key !== 'string' || key.startsWith(STAGE_GROUND_PREFIX))
    return null;
  const id = key.startsWith(BAKED_RELIEF_PREFIX)
    ? key.slice(BAKED_RELIEF_PREFIX.length)
    : key;
  return isSyntheticSurfaceId(id) ? id : null;
};

export class MockStore implements Store {
  private _loaders: Map<string, DataLoader> = new Map();
  // The preloads, then each init in turn: every call waits for the latest.
  private _ready: Promise<unknown>;
  private _dataKey = JSON.stringify([[], []]);
  // The generated surfaces and columns the latest init asked for, and those warned of since.
  private _surfaces = new Set<string>();
  private _columns = new Set<string>();
  private _warned = new Set<string>();

  private _held: HeldSynthetic = {
    surface: id => {
      if (this._surfaces.has(id)) return getSyntheticSurface(id);
      this.warnNotHeld(id);
      return null;
    },
    column: key => {
      if (this._columns.has(key)) return getSyntheticColumn(key);
      this.warnNotHeld(`${SYNTHETIC_COLUMN_PREFIX}${key}`);
      return null;
    },
  };

  constructor() {
    this._loaders.set('wellbore-headers', wellboreHeadersLoader(this));
    this._loaders.set('position-logs', positionLogsLoader(this));
    this._loaders.set('surface-meta', surfaceMetaLoader(this));
    this._loaders.set('surface-values', surfaceValuesLoader(this, this._held));
    this._loaders.set('relief-meta', reliefMetaLoader(this, this._held));
    this._loaders.set('relief-values', reliefValuesLoader(this, this._held));
    this._loaders.set(
      SYNTHETIC_COLUMN,
      syntheticColumnLoader(this, this._held),
    );
    this._loaders.set('formations', formationLoader(this));
    this._loaders.set('casings', casingLoader(this));
    this._loaders.set('completion-tools', completionLoader(this));
    this._loaders.set('perforations', perforationLoader(this));
    this._loaders.set(
      'wellbore-seismic-section',
      wellboreSeismicSectionLoader(this),
    );
    this._loaders.set(
      FIELD_COLUMN_SEISMIC_SECTION,
      fieldColumnSeismicSectionLoader(this),
    );

    // For the mock store used in our storybooks, we only need to preload data once.
    // In a real scenario, you would typically re-initialize preloaded data based on
    // some parameters within your application's workflow.
    const dataInitializers: Promise<boolean>[] = [];

    this._loaders.forEach(loader => {
      if (loader.config.preloaded) {
        dataInitializers.push(loader.init());
      }
    });
    this._ready = Promise.all(dataInitializers);
  }

  /**
   * Hold what a story uses besides the demo files: generated surfaces, by key
   * ({@link StoryStoreData}). Exact: what an earlier init held and this one does not ask for
   * is no longer listed or served (its generation stays cached, for a story that asks
   * again). Calls made meanwhile wait for it; the same data again changes nothing. Without
   * one, the store holds the demo files only.
   */
  init(data: StoryStoreData = {}): Promise<void> {
    const scenarios = data.syntheticScenarios ?? [];
    const columns = data.syntheticColumns ?? [];
    const key = JSON.stringify([scenarios, columns]);
    if (key !== this._dataKey) {
      this._dataKey = key;
      this._ready = this._ready.then(() => this.hold(scenarios, columns));
    }
    return this._ready.then(() => undefined);
  }

  private hold(
    scenarios: readonly string[] | 'all',
    columns: readonly string[] | 'all',
  ) {
    const { ids, unknown } = syntheticSurfaceIdsOf(scenarios, columns);
    if (unknown.length) {
      console.warn(
        `[store] parameters.store names no generated surface ${unknown.map(k => `'${k}'`).join(', ')}`,
      );
    }
    this._surfaces = new Set(ids);
    this._columns = new Set(
      columns === 'all'
        ? ids
            .filter(id => id.startsWith(SYNTHETIC_COLUMN_PREFIX))
            .map(id => id.slice(SYNTHETIC_COLUMN_PREFIX.length).split(':')[0])
        : columns,
    );
    this._warned.clear();
    // Listed exactly as held; what was loaded for a surface no longer held is dropped.
    const meta = this.loader('surface-meta');
    for (const key of [...meta.cached.keys()])
      if (syntheticIdOf(key)) meta.cached.delete(key);
    for (const id of ids) {
      const surface = getSyntheticSurface(id);
      if (surface) meta.set(id, surface.meta);
    }
    for (const type of ['surface-values', 'relief-meta']) {
      const cached = this.loader(type).cached;
      for (const key of [...cached.keys()]) {
        const id = syntheticIdOf(key);
        if (id && !this._surfaces.has(id)) cached.delete(key);
      }
    }
  }

  private warnNotHeld(id: string) {
    if (this._warned.has(id)) return;
    this._warned.add(id);
    const column = id.startsWith(SYNTHETIC_COLUMN_PREFIX);
    const key = id
      .slice(column ? SYNTHETIC_COLUMN_PREFIX.length : SYNTHETIC_PREFIX.length)
      .split(':')[0];
    console.warn(
      `[store] '${id}' is not in this story's store: name '${key}' in parameters.store.${column ? 'syntheticColumns' : 'syntheticScenarios'}`,
    );
  }

  loader(dataType: string): DataLoader {
    if (this._loaders.has(dataType)) {
      return this._loaders.get(dataType)!;
    }
    throw Error('No loader registered for data type: ' + dataType);
  }

  async all<T>(dataType: string): Promise<T[] | null> {
    await this._ready;
    return this.loader(dataType).all<T>();
  }

  async get<T>(dataType: string, key: KeyType, args?: any) {
    await this._ready;
    if (dataType === 'surface-meta' && isSyntheticSurfaceId(key))
      return (this._held.surface(key)?.meta ?? null) as T | null;
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
    // After the preloads, which replace a loader's cache, and any init.
    await this._ready;
    this.loader(dataType).set(key, value);
    return true;
  }
}
