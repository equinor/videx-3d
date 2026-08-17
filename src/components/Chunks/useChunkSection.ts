import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, DynamicDrawUsage } from 'three';
import {
  buildStackSectionIndex,
  createStackSectionTarget,
  growStackSectionTarget,
  sectionStackInterval,
  StackSectionPlane,
  StackSectionSource,
  StackSectionTarget,
} from '../../sdk';
import { ChunkLayer, ChunkSectionState } from './chunk-defs';

/** One interval's cut face, ready to be drawn with that interval's own material. */
export type ChunkSectionFace = {
  /** the interval, i.e. the index of the BUILD layer above it */
  interval: number;
  /** the CALLER's layer index for that interval — which material it takes */
  layer: number;
  /**
   * Which contour this face is: always `0` for a plane or a one-sided fence, `0`
   * and `1` for the two walls of a corridor.
   *
   * ⚠️ Part of a face's IDENTITY, not decoration: a corridor gives one interval
   * two faces, so keying only on the interval collides and React drops one.
   */
  wall: number;
  geometry: BufferGeometry;
};

type Face = ChunkSectionFace & { target: StackSectionTarget };

// Enough for a plane crossing a few hundred cells; grown by doubling from there.
const INITIAL_CAPACITY = 1024;

function attach(geometry: BufferGeometry, target: StackSectionTarget) {
  const set = (name: string, array: Float32Array, itemSize: number) => {
    const attribute = new BufferAttribute(array, itemSize);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  };
  set('position', target.positions, 3);
  set('normal', target.normals, 3);
  set('uv', target.uvs, 2);
  set('wallV', target.wallV, 1);
  if (target.inferred) set('inferred', target.inferred, 1);
}

/**
 * Build one cut face per filled interval of a chunk, rebuilt every frame from the
 * stack's live plane.
 *
 * ⭐ This is the **appearance** layer: it reads the channels the build already
 * produced ({@link StackSectionSource}) and never touches the worker, so a moving
 * plane costs a pass over the crossed cells and nothing else. Buffers are
 * preallocated and only the draw range moves — allocating a `BufferGeometry` per
 * frame would make a rotating plane a garbage generator.
 *
 * @param source the chunk's section channels, from its build
 * @param section the stack's live section state, or `null` for none
 * @param layers the caller's layers, read for `ChunkLayer.section`: a unit kept
 *   whole gets no cut face — there is nothing to close, and a face there would sit
 *   inside solid material
 * @returns one face per filled interval, or `null` when there is nothing to cut
 *
 * @group Components
 */
export function useChunkSection(
  source: StackSectionSource | undefined,
  section: ChunkSectionState | null | undefined,
  layers?: ChunkLayer[],
): ChunkSectionFace[] | null {
  const faces = useMemo<Face[] | null>(() => {
    if (!source || !section) return null;
    const built: Face[] = [];
    source.intervals.forEach((members, interval) => {
      if (!members) return;
      const layer = source.layers?.[interval] ?? interval;
      if (layers?.[layer]?.section === false) return;
      const target = createStackSectionTarget(
        INITIAL_CAPACITY,
        !!source.inferred,
      );
      const geometry = new BufferGeometry();
      attach(geometry, target);
      geometry.setDrawRange(0, 0);
      built.push({ interval, layer, geometry, target, wall: 0 });
    });
    return built.length > 0 ? built : null;
  }, [source, section, layers]);

  useEffect(() => {
    return () => faces?.forEach(face => face.geometry.dispose());
  }, [faces]);

  const plane = useMemo<StackSectionPlane>(
    () => ({ normal: [0, 0, 0], constant: 0 }),
    [],
  );

  // ⭐ The plane is the only thing that changes: the geometry is fixed for the
  // life of the build, so the index is built once and every frame reuses it.
  const index = useMemo(
    () => (source && section ? buildStackSectionIndex(source) : null),
    [source, section],
  );
  // What the faces were last cut with. A section that is not moving — a fixed
  // plane, or a camera-locked one with the camera at rest — would otherwise
  // recompute an identical face every frame, which on a field-sized stack is the
  // difference between a still view being free and costing tens of millions of
  // prism tests per second.
  const last = useRef<{
    faces: Face[] | null;
    x: number;
    y: number;
    z: number;
    c: number;
    on: boolean;
    off: number;
  }>({ faces: null, x: NaN, y: NaN, z: NaN, c: NaN, on: false, off: NaN });

  useFrame(() => {
    if (!faces || !source || !section) return;
    const state = last.current;
    if (!section.enabled) {
      if (state.on) {
        for (const face of faces) face.geometry.setDrawRange(0, 0);
      }
      state.on = false;
      return;
    }
    const { normal, constant } = section.plane;
    const offset = section.offset;
    if (
      state.on &&
      state.faces === faces &&
      state.x === normal.x &&
      state.y === normal.y &&
      state.z === normal.z &&
      state.c === constant &&
      state.off === offset
    ) {
      return;
    }
    state.on = true;
    state.faces = faces;
    state.x = normal.x;
    state.y = normal.y;
    state.z = normal.z;
    state.c = constant;
    state.off = offset;

    plane.normal[0] = normal.x;
    plane.normal[1] = normal.y;
    plane.normal[2] = normal.z;
    plane.constant = constant;

    for (const face of faces) {
      const options = { offset, index: index ?? undefined };
      let needed = sectionStackInterval(
        source,
        face.interval,
        plane,
        face.target,
        options,
      );
      if (needed > face.target.capacity) {
        growStackSectionTarget(face.target, needed);
        attach(face.geometry, face.target);
        needed = sectionStackInterval(
          source,
          face.interval,
          plane,
          face.target,
          options,
        );
      }
      face.geometry.setDrawRange(0, face.target.count);
      for (const name in face.geometry.attributes) {
        face.geometry.attributes[name].needsUpdate = true;
      }
    }
  });

  return faces;
}
