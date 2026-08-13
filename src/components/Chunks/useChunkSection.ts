import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, DynamicDrawUsage } from 'three';
import {
  createStackSectionTarget,
  growStackSectionTarget,
  sectionStackInterval,
  StackSectionPlane,
  StackSectionSource,
  StackSectionTarget,
} from '../../sdk';
import { ChunkSectionState } from './chunk-defs';

/** One interval's cut face, ready to be drawn with that interval's own material. */
export type ChunkSectionFace = {
  /** the interval, i.e. the index of the BUILD layer above it */
  interval: number;
  /** the CALLER's layer index for that interval — which material it takes */
  layer: number;
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
 * @returns one face per filled interval, or `null` when there is nothing to cut
 *
 * @group Components
 */
export function useChunkSection(
  source: StackSectionSource | undefined,
  section: ChunkSectionState | null | undefined,
): ChunkSectionFace[] | null {
  const faces = useMemo<Face[] | null>(() => {
    if (!source || !section) return null;
    const built: Face[] = [];
    source.intervals.forEach((members, interval) => {
      if (!members) return;
      const target = createStackSectionTarget(
        INITIAL_CAPACITY,
        !!source.inferred,
      );
      const geometry = new BufferGeometry();
      attach(geometry, target);
      geometry.setDrawRange(0, 0);
      built.push({
        interval,
        layer: source.layers?.[interval] ?? interval,
        geometry,
        target,
      });
    });
    return built.length > 0 ? built : null;
  }, [source, section]);

  useEffect(() => {
    return () => faces?.forEach(face => face.geometry.dispose());
  }, [faces]);

  const plane = useMemo<StackSectionPlane>(
    () => ({ normal: [0, 0, 0], constant: 0 }),
    [],
  );

  useFrame(() => {
    if (!faces || !source || !section) return;
    if (!section.enabled) {
      for (const face of faces) face.geometry.setDrawRange(0, 0);
      return;
    }
    const { normal, constant } = section.plane;
    plane.normal[0] = normal.x;
    plane.normal[1] = normal.y;
    plane.normal[2] = normal.z;
    plane.constant = constant;

    for (const face of faces) {
      const options = { offset: section.offset };
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
