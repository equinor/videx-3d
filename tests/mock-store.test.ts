import { afterEach, describe, expect, it, vi } from 'vitest';

// The demo files, as small as the store takes them.
vi.mock('../src/storybook/dependencies/api', () => ({
  get: vi.fn<(url: string) => Promise<unknown>>(async url =>
    url === '/data/surface-meta.json'
      ? { real: { id: 'real', name: 'Real' } }
      : {},
  ),
  getBinary: vi.fn<() => Promise<ArrayBuffer | null>>(async () => null),
}));

import { MockStore } from '../src/storybook/dependencies/MockStore';

const ids = async (store: MockStore) =>
  ((await store.all<{ id: string }>('surface-meta')) ?? []).map(m => m.id);

describe('MockStore init', () => {
  afterEach(() => vi.restoreAllMocks());

  it('holds no generated surface by default, and refuses one asked for', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new MockStore();
    expect(await ids(store)).toEqual(['real']);
    expect(await store.get('surface-values', 'synthetic:flat')).toBeNull();
    expect(await store.get('surface-meta', 'synthetic:flat')).toBeNull();
    expect(warn.mock.calls.some(c => String(c[0]).includes("'flat'"))).toBe(
      true,
    );
  });

  it('holds exactly what the latest init asks for', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new MockStore();

    await store.init({ syntheticScenarios: ['flat'] });
    expect(await ids(store)).toEqual(['real', 'synthetic:flat']);
    const meta = await store.get<{ header: { nx: number; ny: number } }>(
      'surface-meta',
      'synthetic:flat',
    );
    const values = await store.get<Float32Array>(
      'surface-values',
      'synthetic:flat',
    );
    expect(values?.length).toBe(meta!.header.nx * meta!.header.ny);

    // The next story asks for none: what was held, and loaded, is gone.
    await store.init({});
    expect(await ids(store)).toEqual(['real']);
    expect(await store.get('surface-values', 'synthetic:flat')).toBeNull();
  });

  it('warns of keys that name no generated surface', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new MockStore();
    await store.init({ syntheticScenarios: ['no-such-scenario'] });
    expect(await ids(store)).toEqual(['real']);
    expect(
      warn.mock.calls.some(c => String(c[0]).includes("'no-such-scenario'")),
    ).toBe(true);
  });
});
