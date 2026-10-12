import { BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { buildSurfaceChunkSpec } from '../src/components/Chunks/chunk-spec';
import type { ChunkLayer } from '../src/components/Chunks/chunk-defs';
import { generateSurfaceChunk } from '../src/generators/surface-chunk-generator';
import type { SurfaceMeta } from '../src/sdk/data/types/SurfaceMeta';
import { PlanarPolygonGeometry } from '../src/sdk/geometries/planar-geometry';
import type { SurfaceChunk } from '../src/sdk/geometries/surface-chunk';
import {
  PackedSurfaceChunk,
  unpackSurfaceChunk,
} from '../src/sdk/geometries/surface-chunk-packing';
import {
  createSurfaceChunkReceiver,
  SurfaceChunkPacket,
  SurfaceChunkPreviewPacket,
} from '../src/sdk/geometries/surface-chunk-streaming';
import { Vec3 } from '../src/sdk/types/common';
import { TestStore } from './mocks/test-store';

const utmToArea = (e: number, n: number, a = 0): Vec3 => [
  e - 1000,
  a,
  5000 - n,
];

const NX = 41;

function surface(id: string, depthAt: (c: number, r: number) => number | null) {
  const depths = new Float32Array(NX * NX);
  let max = -Infinity;
  for (let r = 0; r < NX; r++)
    for (let c = 0; c < NX; c++) {
      const d = depthAt(c, r) ?? NaN;
      depths[r * NX + c] = d;
      if (d > max) max = d;
    }
  const values = depths.map(d => (Number.isNaN(d) ? -1 : max - d));
  const meta = {
    id,
    max,
    header: { nx: NX, ny: NX, xinc: 100, yinc: 100, rot: 0, xori: 0, yori: 0 },
  } as unknown as SurfaceMeta;
  return { meta, values };
}

const top = surface(
  'top',
  (c, r) => 1000 + 20 * Math.sin(c / 4) * Math.cos(r / 5),
);
// Unmapped in the middle (a void opens there), and pinching onto `base` on one side.
const mid = surface('mid', (c, r) =>
  c >= 15 && c <= 25 && r >= 15 && r <= 25
    ? null
    : Math.min(2000, 1500 + 20 * c),
);
const base = surface('base', () => 2000);

const outline = new PlanarPolygonGeometry([
  [
    [
      [0, 2000],
      [2000, 2000],
      [2000, 4000],
      [0, 4000],
      [0, 2000],
    ],
  ],
]);

async function build(stream: boolean, column?: { preview?: boolean }) {
  const store = new TestStore();
  store.data = {
    'surface-values': { top: top.values, mid: mid.values, base: base.values },
  };
  const layers: ChunkLayer[] = [
    { surface: top.meta, fill: true },
    { surface: mid.meta, fill: true },
    { surface: base.meta },
  ];
  const spec = buildSurfaceChunkSpec(layers, utmToArea, outline, {
    resolve: { seal: true, sealMode: 'void', constrainTerminations: true },
    maxError: 5,
    section: true,
    ...(column && {
      stack: {
        surfaces: [top.meta, mid.meta, base.meta],
        envelope: outline,
      },
      preview: column.preview,
    }),
  });
  const packets: SurfaceChunkPacket[] = [];
  const final = (await generateSurfaceChunk.call(
    store,
    spec,
    ...(stream ? [(p: SurfaceChunkPacket) => packets.push(p)] : []),
  )) as PackedSurfaceChunk;
  return { final, packets };
}

const arrays = (geometry: BufferGeometry) => ({
  attributes: Object.fromEntries(
    Object.entries(geometry.attributes).map(([name, a]) => [
      name,
      Array.from(a.array as ArrayLike<number>),
    ]),
  ),
  index: Array.from(geometry.getIndex()?.array ?? []),
  sphere: geometry.boundingSphere,
});

const meshes = (chunk: SurfaceChunk) => ({
  surfaces: chunk.surfaces.map(
    ({ geometry, above, below, patchIndex, ...rest }) => ({
      ...rest,
      above: Array.from(above ?? []),
      below: Array.from(below ?? []),
      patchIndex: Array.from(patchIndex ?? []),
      geometry: arrays(geometry),
    }),
  ),
  walls: chunk.walls.map(({ geometry, ...rest }) => ({
    ...rest,
    geometry: arrays(geometry),
  })),
});

describe('a streamed chunk', () => {
  it('rebuilds exactly the chunk the packed result describes', async () => {
    const whole = unpackSurfaceChunk(
      structuredClone((await build(false)).final),
    );
    const { final, packets: all } = await build(true);
    const packets = all.filter(p => p.kind !== 'progress');

    expect(final.surfaces).toHaveLength(0);
    // The base first, then one packet per cap.
    expect(packets[0].kind).toBe('base');
    const caps = packets.slice(1);
    expect(caps.every(p => p.kind === 'cap')).toBe(true);
    expect(final.streamed).toEqual({ caps: caps.length });

    const receiver = createSurfaceChunkReceiver();
    let streamed: SurfaceChunk | null = null;
    // Cloned one by one, as each crosses the worker as its own message — and the
    // caps in REVERSE, since the pool finishes them in any order.
    const delivery = [
      ...all.filter(p => p.kind !== 'cap'),
      ...caps.slice().reverse(),
    ];
    for (const packet of delivery) {
      streamed = receiver.receive(structuredClone(packet)) ?? streamed;
    }
    expect(receiver.complete).toBe(true);
    streamed = receiver.finish(final)!;

    // Both kinds of cap are exercised: on the shared index, and on one of its own.
    const sharedIndex = caps.map(p => p.kind === 'cap' && p.shared.index);
    expect(sharedIndex).toContain(true);
    expect(sharedIndex).toContain(false);

    expect(whole.surfaces.length).toBeGreaterThan(1);
    expect(whole.walls.length).toBeGreaterThan(0);
    expect(meshes(streamed)).toEqual(meshes(whole));
    expect(streamed.boundaries).toEqual(whole.boundaries);
    expect(streamed.section!.heights).toEqual(whole.section!.heights);
    expect(streamed.section!.intervals).toEqual(whole.section!.intervals);
    expect(streamed.section!.layers).toEqual(whole.section!.layers);
    expect(streamed.section!.index!.items).toEqual(whole.section!.index!.items);
    expect(streamed.metrics.triangles).toBe(whole.metrics.triangles);

    // One attribute object for what the caps share, as the worker built them.
    const xz = new Set(
      streamed.surfaces.map(s => s.geometry.getAttribute('xz')),
    );
    expect(xz.size).toBe(1);
    const indices = new Set(
      streamed.surfaces
        .filter((_, i) => sharedIndex[i])
        .map(s => s.geometry.getIndex()),
    );
    expect(indices.size).toBe(1);
  });

  it('reports each step before the geometry, in order', async () => {
    const { packets } = await build(true);
    const steps = packets.flatMap(p => (p.kind === 'progress' ? [p] : []));
    const phases = [...new Set(steps.map(p => p.phase))];
    expect(phases).toEqual(['fetch', 'resolve', 'refine', 'tessellate']);
    const fetched = steps.filter(p => p.phase === 'fetch');
    expect(fetched.map(p => p.done)).toEqual([1, 2, 3]);
    expect(fetched.every(p => p.total === 3)).toBe(true);
    // Nothing reports once the geometry has started to arrive.
    const kinds = packets.map(p => p.kind);
    expect(kinds.indexOf('base')).toBeGreaterThan(
      kinds.lastIndexOf('progress'),
    );
  });

  it('sends a coarse preview first from a column, and builds the same chunk after it', async () => {
    const whole = unpackSurfaceChunk(
      structuredClone((await build(false, {})).final),
    );
    const { final, packets } = await build(true, {});
    const kinds = packets.filter(p => p.kind !== 'progress').map(p => p.kind);
    expect(kinds[0]).toBe('preview');
    expect(kinds.filter(k => k === 'preview')).toHaveLength(1);

    const preview = packets.find(
      (p): p is SurfaceChunkPreviewPacket => p.kind === 'preview',
    )!;
    const coarse = unpackSurfaceChunk(structuredClone(preview.chunk));
    expect(coarse.surfaces.length).toBeGreaterThan(0);
    expect(coarse.walls.length).toBeGreaterThan(0);
    expect(coarse.section).toBeDefined();

    // The receiver leaves the preview to the caller.
    const receiver = createSurfaceChunkReceiver();
    expect(receiver.receive(structuredClone(preview))).toBeNull();
    let streamed: SurfaceChunk | null = null;
    for (const packet of packets) {
      streamed = receiver.receive(structuredClone(packet)) ?? streamed;
    }
    expect(receiver.complete).toBe(true);
    streamed = receiver.finish(final)!;
    expect(meshes(streamed)).toEqual(meshes(whole));

    const { packets: without } = await build(true, { preview: false });
    expect(without.some(p => p.kind === 'preview')).toBe(false);
  });

  it('completes on the count actually sent, not the one announced', () => {
    const receiver = createSurfaceChunkReceiver();
    receiver.receive({
      kind: 'base',
      positionsXZ: new Float32Array(0),
      indices: new Uint32Array(0),
      heights: [],
      walls: [],
      caps: 2,
    });
    expect(receiver.complete).toBe(false);
    expect(receiver.expected).toBe(2);
    receiver.finish({
      surfaces: [],
      walls: [],
      metrics: {} as PackedSurfaceChunk['metrics'],
      streamed: { caps: 0 },
    });
    expect(receiver.complete).toBe(true);
    expect(receiver.expected).toBe(0);
  });
});
