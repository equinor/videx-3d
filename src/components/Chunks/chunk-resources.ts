import { BufferGeometry } from 'three';
import { SurfaceChunk } from '../../sdk';

/**
 * What the built chunks currently on the main thread cost.
 *
 * ⭐ A chunk is by far the largest thing the library puts on the main thread: at
 * field scale every layer carries a full copy of the shared tessellation, so a
 * column of 30+ layers runs to hundreds of MB. This is what makes that visible —
 * `chunks` above one means a rebuild has both the old and the new alive (which is
 * unavoidable, the new one is unpacked before React drops the old), and a `chunks`
 * that keeps climbing means one is being retained.
 */
export type ChunkResourceStats = {
  /** built chunks currently held */
  chunks: number;
  /** bytes of their geometry, indices and section channels */
  bytes: number;
  /** the highest `bytes` seen since load */
  peakBytes: number;
  /** vertices across every drawn cap and wall */
  vertices: number;
  /** triangles across every drawn cap and wall */
  triangles: number;
  /**
   * Bytes held by the SECTION cut-face buffers.
   *
   * ⭐ Worth its own line: they are preallocated and grown by re-cutting, so they
   * keep climbing after a build has settled — a moving plane finds ever larger
   * faces — which reads as a leak in a heap graph but is a high-water mark.
   */
  sectionBytes: number;
  /** chunks built since load */
  builds: number;
  /**
   * Built, minus reclaimed by the GC, minus live — i.e. chunks that are neither
   * in use nor collectable.
   *
   * ⭐ The number that settles "is it a leak or is it garbage": force a collection
   * (DevTools → Memory → collect garbage) and read it. Anything above 0 afterwards
   * is retained by something. ⚠️ `FinalizationRegistry` callbacks are not prompt,
   * so without an explicit collection this over-reports.
   */
  stranded: number;
};

/** The shape {@link registerSectionTargets} needs; see `StackSectionTarget`. */
type SectionFaceLike = {
  target: { capacity: number; inferred: unknown | null };
};

const sectionSets = new Set<readonly SectionFaceLike[]>();

/**
 * Count a set of cut faces while it is live. Summed on demand rather than at
 * registration, because a target's capacity grows in place.
 */
export function registerSectionTargets(
  faces: readonly SectionFaceLike[],
): () => void {
  sectionSets.add(faces);
  return () => {
    sectionSets.delete(faces);
  };
}

function sectionBytes() {
  let total = 0;
  for (const faces of sectionSets) {
    for (const face of faces) {
      // position 3 + normal 3 + uv 2 + wallV 1 (+ inferred 1) floats per vertex
      const floats = 9 + (face.target.inferred ? 1 : 0);
      total += face.target.capacity * floats * 4;
    }
  }
  return total;
}

type Measured = { bytes: number; vertices: number; triangles: number };

let chunks = 0;
let bytes = 0;
let peakBytes = 0;
let vertices = 0;
let triangles = 0;
let builds = 0;
let collected = 0;

// The held value must not reference the chunk, or it could never be collected.
const finalizer =
  typeof FinalizationRegistry === 'undefined'
    ? null
    : new FinalizationRegistry<number>(() => {
        collected++;
      });

const measured = new WeakMap<object, Measured>();

function geometryBytes(geometry: BufferGeometry, seen: Set<ArrayBufferLike>) {
  let total = 0;
  const add = (buffer: ArrayBufferLike) => {
    // Layers that kept the full triangle set SHARE one index buffer, and a
    // dropped layer shares its neighbour's attributes — counting either twice
    // would report several times the real cost.
    if (seen.has(buffer)) return;
    seen.add(buffer);
    total += buffer.byteLength;
  };
  const index = geometry.getIndex();
  if (index) add(index.array.buffer);
  for (const name in geometry.attributes) {
    add(geometry.getAttribute(name).array.buffer);
  }
  return total;
}

/** Bytes a built chunk holds, counting each shared buffer once. */
export function chunkBytes(chunk: SurfaceChunk): number {
  return measure(chunk).bytes;
}

/**
 * Dispose a geometry AND drop its arrays.
 *
 * ⭐ `dispose()` only releases the GPU side. The CPU arrays go when the last
 * reference does — and a React fiber's `alternate`, a memo's dependency array or
 * a sampler entry can all outlive the swap. At field scale one chunk is hundreds
 * of MB, so the payload is dropped explicitly: whatever still points here then
 * holds an empty husk rather than a copy of the field.
 *
 * ⚠️ The geometry is unusable afterwards. Only call it where the meshes that drew
 * it are already unmounted.
 *
 * @group Components
 */
export function releaseGeometry(geometry: BufferGeometry): void {
  geometry.dispose();
  for (const name in geometry.attributes) geometry.deleteAttribute(name);
  geometry.setIndex(null);
  geometry.morphAttributes = {};
  geometry.clearGroups();
  geometry.boundingBox = null;
  geometry.boundingSphere = null;
}

function measure(chunk: SurfaceChunk): Measured {
  const seen = new Set<ArrayBufferLike>();
  let total = 0;
  let verts = 0;
  let tris = 0;
  const add = (view: ArrayBufferView | undefined | null) => {
    if (!view || seen.has(view.buffer)) return;
    seen.add(view.buffer);
    total += view.buffer.byteLength;
  };
  const count = (geometry: BufferGeometry) => {
    verts += geometry.getAttribute('position')?.count ?? 0;
    const index = geometry.getIndex();
    tris +=
      (index ? index.count : (geometry.getAttribute('position')?.count ?? 0)) /
      3;
  };
  for (const mesh of chunk.surfaces) {
    total += geometryBytes(mesh.geometry, seen);
    count(mesh.geometry);
    add(mesh.patchIndex);
  }
  for (const wall of chunk.walls) {
    total += geometryBytes(wall.geometry, seen);
    count(wall.geometry);
  }
  const section = chunk.section;
  if (section) {
    add(section.positionsXZ);
    add(section.indices);
    section.heights.forEach(add);
    section.intervals.forEach(add);
    section.inferred?.forEach(add);
  }
  return { bytes: total, vertices: verts, triangles: Math.round(tris) };
}

/** Start counting a built chunk (call once the geometries exist). */
export function trackChunk(chunk: SurfaceChunk): void {
  if (measured.has(chunk)) return;
  const size = measure(chunk);
  measured.set(chunk, size);
  chunks++;
  bytes += size.bytes;
  vertices += size.vertices;
  triangles += size.triangles;
  peakBytes = Math.max(peakBytes, bytes);
  finalizer?.register(chunk, ++builds);
}

/** Stop counting a chunk (call where it is disposed). */
export function untrackChunk(chunk: SurfaceChunk): void {
  const size = measured.get(chunk);
  if (size === undefined) return;
  measured.delete(chunk);
  chunks--;
  bytes -= size.bytes;
  vertices -= size.vertices;
  triangles -= size.triangles;
}

/** What the built chunks currently cost (diagnostics). */
export function chunkResourceStats(): ChunkResourceStats {
  return {
    chunks,
    bytes,
    peakBytes,
    vertices,
    triangles,
    sectionBytes: sectionBytes(),
    builds,
    stranded: Math.max(0, builds - collected - chunks),
  };
}
