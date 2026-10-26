import { describe, expect, it } from 'vitest';
import { stackColumnSpec } from '../src/components/Chunks/chunk-spec';
import { reliefSource } from '../src/components/Sky/sky-relief-source';
import {
  clearStackContext,
  getStackContext,
} from '../src/generators/surface-stack-context';
import { gridToRelief } from '../src/sdk/data/relief/grid-to-relief';
import { reliefWindow } from '../src/sdk/data/relief/relief-window';
import type {
  ReliefData,
  ReliefWindow,
} from '../src/sdk/data/types/ReliefMeta';
import type { SurfaceMeta } from '../src/sdk/data/types/SurfaceMeta';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import { surfaceGridToWorld } from '../src/sdk/geometries/surface-grid';
import { STACK_MASK_DATA } from '../src/sdk/geometries/surface-stack-resample';
import { Vec3 } from '../src/sdk/types/common';
import { TestStore } from './mocks/test-store';

const UTM = '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs';
// As `UtmArea` maps: X east of easting 1000, Z south of northing 5000.
const utmToArea = (e: number, n: number, a = 0): Vec3 => [
  e - 1000,
  a,
  5000 - n,
];
const frame = { projection: UTM, origin: [1000, 5000] as [number, number] };

const NX = 21;
// A survey 2 km square from (0, 0) UTM, 100 m cells, at `depth` metres; the sea bed
// mapped over its western half only.
function surface(id: string, depth: number, west = false) {
  const values = new Float32Array(NX * NX);
  for (let r = 0; r < NX; r++)
    for (let c = 0; c < NX; c++) values[r * NX + c] = west && c > 10 ? -1 : 0;
  const meta = {
    id,
    max: depth,
    header: { nx: NX, ny: NX, xinc: 100, yinc: 100, rot: 0, xori: 0, yori: 0 },
  } as unknown as SurfaceMeta;
  return { meta, values };
}
const bed = surface('bed', 90, true);
const base = surface('base', 2000);

// The relief: 100 m cells over the survey and around it, sloping up to the east.
const height = (e: number) => -150 + 0.02 * e;
function relief(): ReliefData {
  const n = 41;
  const values = new Float32Array(n * n);
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++)
      values[row * n + col] = height(-1000 + col * 100);
  return gridToRelief(
    {
      values,
      size: [n, n],
      origin: [-1000, -1000],
      cell: [100, 100],
      crs: UTM,
    },
    { id: 'slope', name: 'slope' },
  );
}

class Store extends TestStore {
  constructor(private readonly reliefs: ReliefData[]) {
    super();
    this.data = {
      'surface-values': { bed: bed.values, base: base.values },
    };
  }
  async get<T>(dataType: string, key: string | number, args?: unknown) {
    const found = this.reliefs.find(r => r.meta.id === key);
    if (dataType === 'relief-meta') return (found?.meta ?? null) as T;
    if (dataType === 'relief-values')
      return (found ? reliefWindow(found, args as ReliefWindow) : null) as T;
    return super.get<T>(dataType, key);
  }
}

// The survey, in the scene.
const envelope = new PlanarPolygonGeometry([
  [
    [
      [-1000, 3000],
      [1000, 3000],
      [1000, 5000],
      [-1000, 5000],
      [-1000, 3000],
    ],
  ],
]);

describe('reliefSource', () => {
  it('takes the sea and the stage as the stage does, keyed by content', () => {
    const a = reliefSource({ frame, layers: [{ id: 'slope' }] }, {});
    expect(a).toMatchObject({ base: -100, level: 0 });
    const b = reliefSource(
      { frame, layers: [{ id: 'slope', feather: 0 }], depth: 70 },
      { level: -10, depth: 300 },
      2,
    );
    expect(b).toMatchObject({ base: -70, level: -10, margin: 2 });
    expect(reliefSource({ frame, layers: [{ id: 'slope' }] }, {})!.key).toBe(
      a!.key,
    );
    expect(b!.key).not.toBe(a!.key);
    expect(reliefSource({ frame, layers: [] }, {})).toBeUndefined();
  });
});

describe('a column on the relief', () => {
  const source = reliefSource(
    { frame, layers: [{ id: 'slope' }] },
    { level: -10 },
    2,
  )!;

  it('builds its sea bed on the relief, the key telling the two apart', () => {
    const plain = stackColumnSpec([bed.meta, base.meta], envelope, utmToArea);
    const onRelief = stackColumnSpec(
      [bed.meta, base.meta],
      envelope,
      utmToArea,
      undefined,
      { source, seabed: 'bed' },
    );
    expect(plain.layers.some(l => l.reliefSource)).toBe(false);
    expect(onRelief.layers[0].reliefSource).toBe(source);
    expect(onRelief.layers[1].reliefSource).toBeUndefined();
    expect(onRelief.key).not.toBe(plain.key);
    // A column without its sea bed is not on the relief.
    expect(
      stackColumnSpec([base.meta], envelope, utmToArea, undefined, {
        source,
        seabed: 'bed',
      }).key,
    ).toBe(stackColumnSpec([base.meta], envelope, utmToArea).key);
  });

  it('samples the relief onto the common grid, covering all of it', async () => {
    clearStackContext();
    const store = new Store([relief()]);
    const spec = stackColumnSpec(
      [bed.meta, base.meta],
      envelope,
      utmToArea,
      undefined,
      { source, seabed: 'bed' },
    );
    const context = await getStackContext(store, spec, { seal: false });
    expect(context).not.toBeNull();
    const { header, worldPosition, channels, masks } = context!.reference;
    const at = context!.index.get('bed')!;
    const toWorld = surfaceGridToWorld(header, worldPosition);
    let checked = 0;
    for (let row = 0; row < header.ny; row += 3) {
      for (let col = 0; col < header.nx; col += 3) {
        const [x] = toWorld(col, row);
        // The sea's level, the height, the margin.
        expect(channels[at][row * header.nx + col]).toBeCloseTo(
          -10 + height(x + 1000) + 2,
          3,
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
    // The surface maps only the west; the relief covers it all.
    expect(masks[at].every(m => m === STACK_MASK_DATA)).toBe(true);
    // The base is the surface's, as ever.
    expect(channels[context!.index.get('base')!][0]).toBeCloseTo(-2000, 3);
    clearStackContext();
  });
});
