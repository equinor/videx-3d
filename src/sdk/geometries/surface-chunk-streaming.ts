import { BufferAttribute, BufferGeometry } from 'three';
import { packBufferGeometry, unpackBufferGeometry } from './packing';
import {
  SurfaceChunk,
  SurfaceChunkBoundary,
  SurfaceChunkMesh,
  SurfaceChunkMetrics,
} from './surface-chunk';
import {
  PackedSurfaceChunk,
  PackedSurfaceChunkMesh,
} from './surface-chunk-packing';
import { StackSectionSource } from './surface-section';
import type { SurfaceStackShared } from './surface-stack-geometry';

/**
 * The first packet of a streamed chunk: what its caps share, plus the walls and
 * the section, which are built before any cap (see `SurfaceStackOptions.stream`
 * and `documents/chunk-stack/streaming.md`).
 *
 * @group Geometries
 */
export type SurfaceChunkBasePacket = {
  kind: 'base';
  positionsXZ: Float32Array;
  indices: Uint32Array;
  /** per BUILD layer: the cap's `y` */
  heights: Float32Array[];
  /** per build layer: the cap's `inferred`, when the build marks inference */
  inferred?: Float32Array[];
  walls: PackedSurfaceChunkMesh[];
  section?: StackSectionSource;
  boundaries?: SurfaceChunkBoundary[];
  /** how many cap packets follow, at most (see `PackedSurfaceChunk.streamed`) */
  caps: number;
};

/**
 * One cap of a streamed chunk. Its geometry carries only what is its OWN; `shared`
 * says which of the base packet's arrays complete it.
 *
 * @group Geometries
 */
export type SurfaceChunkCapPacket = {
  kind: 'cap';
  /** the build layer: index into the base packet's `heights` */
  layer: number;
  mesh: PackedSurfaceChunkMesh;
  shared: { xz: boolean; y: boolean; inferred: boolean; index: boolean };
};

/**
 * A step of a chunk build, in the order they run. `plan` lays out the shared
 * tessellation, `tessellate` triangulates its tiles, `assemble` turns them into
 * the walls and what the caps share. `caps` is counted on the receiving side, as
 * cap packets arrive.
 *
 * @group Geometries
 */
export type SurfaceChunkPhase =
  | 'fetch'
  | 'resolve'
  | 'refine'
  | 'terminations'
  | 'plan'
  | 'tessellate'
  | 'assemble'
  | 'caps';

/**
 * How far a streamed build has come: `done` of `total` units of `phase` (layers,
 * pairs, tiles or caps). A phase with no countable units reports `0` of `1` as it
 * starts.
 *
 * @group Geometries
 */
export type SurfaceChunkProgressPacket = {
  kind: 'progress';
  phase: SurfaceChunkPhase;
  done: number;
  total: number;
};

const PHASE_ORDER: SurfaceChunkPhase[] = [
  'fetch',
  'resolve',
  'refine',
  'terminations',
  'plan',
  'tessellate',
  'assemble',
  'caps',
];

// Rough seconds per step: a cold 33-layer field (Troll) with 64-cell tiles.
const PHASE_WEIGHTS: Record<SurfaceChunkPhase, number> = {
  fetch: 3,
  resolve: 1.2,
  refine: 2.2,
  terminations: 1.1,
  plan: 2,
  tessellate: 0.6,
  assemble: 5,
  caps: 3.6,
};

/**
 * A tracker that turns a chunk build's steps into an ESTIMATE of how far the
 * whole build has come, 0 to 1. Each step weighs a fixed share, so the number is
 * only as good as those weights (cold caches and untiled builds shift them).
 *
 * It starts at 0 from the first step it hears, so a build that skips the column
 * (already cached) still runs from 0; a step skipped later counts as done, and
 * the estimate never goes back.
 *
 * @returns call with every step, in the order they arrive; one tracker per build
 *
 * @group Geometries
 */
export function createSurfaceChunkProgress(): (
  phase: SurfaceChunkPhase,
  done: number,
  total: number,
) => number {
  let start = -1;
  let span = 0;
  let estimate = 0;
  return (phase, done, total) => {
    const at = PHASE_ORDER.indexOf(phase);
    if (start < 0) {
      start = at;
      for (let k = at; k < PHASE_ORDER.length; k++) {
        span += PHASE_WEIGHTS[PHASE_ORDER[k]];
      }
    }
    if (at < start) return estimate;
    let before = 0;
    for (let k = start; k < at; k++) before += PHASE_WEIGHTS[PHASE_ORDER[k]];
    const part = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
    estimate = Math.max(
      estimate,
      (before + PHASE_WEIGHTS[phase] * part) / span,
    );
    return estimate;
  };
}

/**
 * A whole chunk built at coarse sampling, sent before any other geometry so there
 * is something to show while the real one builds. It shares nothing with the
 * packets that follow: unpack it with `unpackSurfaceChunk`, and dispose it once
 * the real chunk replaces it.
 *
 * @group Geometries
 */
export type SurfaceChunkPreviewPacket = {
  kind: 'preview';
  chunk: PackedSurfaceChunk;
};

/** @group Geometries */
export type SurfaceChunkPacket =
  | SurfaceChunkPreviewPacket
  | SurfaceChunkBasePacket
  | SurfaceChunkCapPacket
  | SurfaceChunkProgressPacket;

const distinct = (buffers: Transferable[]) => [...new Set(buffers)];

/**
 * Pack the {@link SurfaceChunkBasePacket}.
 *
 * ⚠️ The shared arrays are COPIED, not moved: the build goes on reading them to
 * make the caps (see `SurfaceStackShared`). The walls and the section's own
 * arrays move.
 *
 * @param walls the chunk's walls (see `chunkWallMeshes`)
 * @param sectionLayers the section's caller layers (see `StackSectionSource.layers`)
 *
 * @group Geometries
 */
export function packSurfaceChunkBase(
  shared: SurfaceStackShared,
  walls: SurfaceChunkMesh[],
  boundaries: SurfaceChunkBoundary[] | undefined,
  sectionLayers: number[],
): [SurfaceChunkBasePacket, Transferable[]] {
  const positionsXZ = shared.positionsXZ.slice();
  const indices = shared.indices.slice();
  const heights = shared.heights.map(h => h.slice());
  const inferred = shared.inferred?.map(m => m.slice());
  const transfer: Transferable[] = [
    positionsXZ.buffer,
    indices.buffer,
    ...heights.map(h => h.buffer),
    ...(inferred ?? []).map(m => m.buffer),
  ];

  // Nothing the build still reads may be detached, whoever else holds it.
  const kept = new Set<ArrayBufferLike>([
    shared.positionsXZ.buffer,
    shared.indices.buffer,
    ...shared.heights.map(h => h.buffer),
    ...(shared.inferred ?? []).map(m => m.buffer),
  ]);
  const move = (buffer: ArrayBufferLike) => {
    if (!kept.has(buffer)) transfer.push(buffer as ArrayBuffer);
  };

  let section: StackSectionSource | undefined;
  if (shared.section) {
    const source = shared.section;
    section = {
      ...source,
      positionsXZ,
      indices,
      heights,
      inferred,
      layers: sectionLayers,
    };
    for (const mask of source.intervals) if (mask) move(mask.buffer);
    for (const mask of source.gaps ?? []) if (mask) move(mask.buffer);
    if (source.index) {
      const { starts, items, boxX, boxZ } = source.index;
      [starts, items, boxX, boxZ].forEach(array => move(array.buffer));
    }
  }

  const packedWalls = walls.map(wall => {
    const [geometry, buffers] = packBufferGeometry(wall.geometry);
    buffers.forEach(move);
    const index = wall.geometry.getIndex();
    if (index) move(index.array.buffer);
    return { ...wall, geometry };
  });

  return [
    {
      kind: 'base',
      positionsXZ,
      indices,
      heights,
      inferred,
      walls: packedWalls,
      section,
      boundaries,
      caps: shared.caps.filter(Boolean).length,
    },
    distinct(transfer),
  ];
}

/**
 * Pack one {@link SurfaceChunkCapPacket}: the cap's own arrays move, and what it
 * shares with the base packet is left out and flagged.
 *
 * @param layer the build layer the cap belongs to
 *
 * @group Geometries
 */
export function packSurfaceChunkCap(
  layer: number,
  mesh: SurfaceChunkMesh,
  shared: SurfaceStackShared,
): [SurfaceChunkCapPacket, Transferable[]] {
  const source = mesh.geometry;
  const flags = {
    xz: source.getAttribute('xz')?.array === shared.positionsXZ,
    y: source.getAttribute('y')?.array === shared.heights[layer],
    inferred:
      !!shared.inferred &&
      source.getAttribute('inferred')?.array === shared.inferred[layer],
    index: source.getIndex()?.array === shared.indices,
  };

  const own = new BufferGeometry();
  for (const name in source.attributes) {
    if (name === 'xz' && flags.xz) continue;
    if (name === 'y' && flags.y) continue;
    if (name === 'inferred' && flags.inferred) continue;
    own.setAttribute(name, source.attributes[name]);
  }
  const index = source.getIndex();
  if (index && !flags.index) own.setIndex(index);
  own.boundingBox = source.boundingBox;
  own.boundingSphere = source.boundingSphere;
  own.drawRange = source.drawRange;
  own.groups = source.groups;

  const [geometry, transfer] = packBufferGeometry(own);
  const moved: Transferable[] = transfer.map(buffer => buffer as ArrayBuffer);
  if (index && !flags.index) moved.push(index.array.buffer as ArrayBuffer);
  for (const array of [
    mesh.patchIndex,
    mesh.above,
    mesh.below,
    ...(mesh.levels ?? []),
    ...(mesh.tileStarts ?? []),
    ...(mesh.patchLevels ?? []),
    ...(mesh.patchTileStarts ?? []),
    mesh.normalMap?.data,
  ]) {
    if (array) moved.push(array.buffer as ArrayBuffer);
  }
  return [
    { kind: 'cap', layer, mesh: { ...mesh, geometry }, shared: flags },
    distinct(moved),
  ];
}

const emptyMetrics = (): SurfaceChunkMetrics => ({
  densifyMs: 0,
  clipMs: 0,
  rimMs: 0,
  wallsMs: 0,
  totalMs: 0,
  layers: 0,
  surfaces: 0,
  walls: 0,
  triangles: 0,
  wallTriangles: 0,
  rimPoints: 0,
});

/**
 * Rebuilds a {@link SurfaceChunk} on the main thread from streamed packets, as
 * they arrive. See {@link createSurfaceChunkReceiver}.
 *
 * @group Geometries
 */
export type SurfaceChunkReceiver = {
  /**
   * Take one packet. Returns a NEW chunk object holding every mesh so far, in
   * layer order whatever order the caps arrive in (the meshes themselves are
   * kept), or `null` before the base packet. A progress or preview packet changes
   * nothing and returns the current chunk.
   */
  receive(packet: SurfaceChunkPacket): SurfaceChunk | null;
  /**
   * Every cap has arrived: as many as {@link SurfaceChunkReceiver.finish} says were
   * sent, or before it, as many as the base packet announced.
   */
  readonly complete: boolean;
  /** caps received so far */
  readonly received: number;
  /** caps expected, by the same rule as `complete` (0 before the base packet) */
  readonly expected: number;
  /**
   * Attach the generator's return value. ⚠️ Across a worker it can arrive BEFORE
   * the last caps — they travel on another port — so wait for `complete` too.
   */
  finish(final: PackedSurfaceChunk): SurfaceChunk | null;
};

/**
 * Create a {@link SurfaceChunkReceiver}.
 *
 * ⭐ The caps share ONE `xz` attribute and ONE shared index, as they do in the
 * worker — three uploads per attribute object.
 *
 * @group Geometries
 */
export function createSurfaceChunkReceiver(): SurfaceChunkReceiver {
  let base: SurfaceChunkBasePacket | null = null;
  let chunk: SurfaceChunk | null = null;
  let xz: BufferAttribute | null = null;
  let index: BufferAttribute | null = null;
  const ys: BufferAttribute[] = [];
  const marks: BufferAttribute[] = [];
  const shared = new Map<ArrayBufferLike, BufferAttribute>();
  // The build layer of each of `chunk.surfaces`, ascending.
  const order: number[] = [];
  let caps = 0;
  let sent: number | null = null;

  return {
    receive(packet) {
      if (packet.kind === 'progress' || packet.kind === 'preview') return chunk;
      if (packet.kind === 'base') {
        base = packet;
        xz = new BufferAttribute(packet.positionsXZ, 2);
        index = new BufferAttribute(packet.indices, 1);
        chunk = {
          surfaces: [],
          walls: packet.walls.map(wall => ({
            ...wall,
            geometry: unpackBufferGeometry(wall.geometry, shared),
          })),
          section: packet.section,
          boundaries: packet.boundaries,
          metrics: chunk?.metrics ?? emptyMetrics(),
        };
        return chunk;
      }
      if (!base || !chunk) return null;
      const { layer } = packet;
      const geometry = unpackBufferGeometry(packet.mesh.geometry, shared);
      if (packet.shared.xz) geometry.setAttribute('xz', xz!);
      if (packet.shared.y) {
        ys[layer] ??= new BufferAttribute(base.heights[layer], 1);
        geometry.setAttribute('y', ys[layer]);
      }
      const inferred = base.inferred?.[layer];
      if (packet.shared.inferred && inferred) {
        marks[layer] ??= new BufferAttribute(inferred, 1);
        geometry.setAttribute('inferred', marks[layer]);
      }
      if (packet.shared.index) geometry.setIndex(index);
      caps++;
      let at = order.length;
      while (at > 0 && order[at - 1] > layer) at--;
      order.splice(at, 0, layer);
      const surfaces = chunk.surfaces.slice();
      surfaces.splice(at, 0, { ...packet.mesh, geometry });
      chunk = { ...chunk, surfaces };
      return chunk;
    },
    get complete() {
      return !!base && caps >= (sent ?? base.caps);
    },
    get received() {
      return caps;
    },
    get expected() {
      return sent ?? base?.caps ?? 0;
    },
    finish(final) {
      sent = final.streamed?.caps ?? null;
      if (!chunk) return null;
      chunk = { ...chunk, metrics: final.metrics };
      return chunk;
    },
  };
}
