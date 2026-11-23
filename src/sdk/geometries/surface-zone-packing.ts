import { BufferAttribute, BufferGeometry } from 'three';
import {
  packBufferGeometry,
  PackedBufferGeometry,
  unpackBufferGeometry,
} from './packing';
import {
  SurfaceZone,
  SurfaceZoneHorizon,
  SurfaceZoneMesh,
  SurfaceZoneMetrics,
} from './surface-zone';
import { StackSectionSource } from './surface-section';

/**
 * A {@link SurfaceZoneMesh} packed for transfer across a worker boundary.
 *
 * ⭐ Derived from the mesh type rather than restated, and packed by SPREAD, so a
 * field added to a mesh survives the trip without anyone remembering to add it
 * here. Restating the fields compiles perfectly well and silently drops the rest —
 * extra properties on the source object are legal, so nothing warns.
 */
export type PackedSurfaceZoneMesh = Omit<SurfaceZoneMesh, 'geometry'> & {
  geometry: PackedBufferGeometry;
};

/**
 * A {@link SurfaceZone} with every `BufferGeometry` replaced by a
 * {@link PackedBufferGeometry}, so the whole zone can be returned from a worker
 * generator with its buffers transferred. Use {@link packSurfaceZone} to build
 * one (in the worker) and {@link unpackSurfaceZone} to restore it (on the main
 * thread).
 *
 * @group Geometries
 */
export type PackedSurfaceZone = {
  surfaces: PackedSurfaceZoneMesh[];
  walls: PackedSurfaceZoneMesh[];
  section?: StackSectionSource;
  horizons?: SurfaceZoneHorizon[];
  metrics: SurfaceZoneMetrics;
  /**
   * The meshes were streamed as packets (see `SurfaceZonePacket`); this carries
   * the metrics only, and how many cap packets were sent — a cap that collapsed
   * entirely sends none, so the base packet's count is an upper bound.
   */
  streamed?: { caps: number };
};

/**
 * Pack a built {@link SurfaceZone} for transfer from a worker: every geometry is
 * packed and its underlying buffers collected into the returned transfer list (so
 * they move zero-copy via `comlink`'s `transfer`). Colours and metrics are carried
 * as plain data.
 *
 * @group Geometries
 */
export function packSurfaceZone(
  zone: SurfaceZone,
): [PackedSurfaceZone, ArrayBufferLike[]] {
  const transferables: ArrayBufferLike[] = [];

  const packGeo = (geometry: BufferGeometry): PackedBufferGeometry => {
    const [packed, buffers] = packBufferGeometry(geometry);
    transferables.push(...buffers);
    return packed;
  };

  const packed: PackedSurfaceZone = {
    surfaces: zone.surfaces.map(s => ({
      ...s,
      geometry: packGeo(s.geometry),
    })),
    walls: zone.walls.map(w => ({ ...w, geometry: packGeo(w.geometry) })),
    section: zone.section,
    horizons: zone.horizons,
    metrics: zone.metrics,
  };

  // Carried by SPREAD above; only the transfer needs saying.
  for (const s of zone.surfaces) {
    if (s.patchIndex) transferables.push(s.patchIndex.buffer);
    s.levels?.forEach(level => transferables.push(level.buffer));
    s.tileStarts?.forEach(starts => transferables.push(starts.buffer));
    s.patchLevels?.forEach(level => transferables.push(level.buffer));
    s.patchTileStarts?.forEach(starts => transferables.push(starts.buffer));
    if (s.normalMap) transferables.push(s.normalMap.data.buffer);
    if (s.above) transferables.push(s.above.buffer);
    if (s.below) transferables.push(s.below.buffer);
  }

  // The section shares buffers with the geometries above — the shared triangle
  // index, and any layer's `inferred` attribute — so the caller's transfer list has
  // to be deduped either way (a repeated buffer is a DataCloneError).
  if (zone.section) {
    const { positionsXZ, indices, heights, intervals, gaps, inferred } =
      zone.section;
    transferables.push(positionsXZ.buffer, indices.buffer);
    for (const y of heights) transferables.push(y.buffer);
    for (const members of intervals)
      if (members) transferables.push(members.buffer);
    for (const members of gaps ?? [])
      if (members) transferables.push(members.buffer);
    if (inferred)
      for (const marks of inferred) transferables.push(marks.buffer);
    const index = zone.section.index;
    if (index) {
      transferables.push(
        index.starts.buffer,
        index.items.buffer,
        index.boxX.buffer,
        index.boxZ.buffer,
      );
    }
  }

  return [packed, transferables];
}

/**
 * Restore a {@link SurfaceZone} from a {@link PackedSurfaceZone} (the inverse of
 * {@link packSurfaceZone}), rebuilding each `BufferGeometry` on the main thread.
 * The caller owns the returned geometries (dispose them when done).
 *
 * @group Geometries
 */
export function unpackSurfaceZone(packed: PackedSurfaceZone): SurfaceZone {
  // ⭐ The caps share one `xz` and often one index: one attribute object each, or
  // three uploads them once per cap.
  const shared = new Map<ArrayBufferLike, BufferAttribute>();
  return {
    surfaces: packed.surfaces.map(s => ({
      ...s,
      geometry: unpackBufferGeometry(s.geometry, shared),
    })),
    walls: packed.walls.map(w => ({
      ...w,
      geometry: unpackBufferGeometry(w.geometry, shared),
    })),
    section: packed.section,
    horizons: packed.horizons,
    metrics: packed.metrics,
  };
}
