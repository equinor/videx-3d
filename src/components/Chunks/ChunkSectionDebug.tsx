import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  LineBasicMaterial,
  LineSegments,
} from 'three';
import { createLayers, LAYERS } from '../../layers/layers';
import { sectionPlaneOutline, StackSectionPlane, Vec3 } from '../../sdk';
import { ChunkSectionState } from './chunk-defs';

/** {@link ChunkSectionDebug} props. */
export type ChunkSectionDebugProps = {
  section: ChunkSectionState | null;
  /** the stack's bounds in its own frame — what the plane's outline is traced in */
  min: Vec3;
  max: Vec3;
  color?: string;
};

// The outline is at most a hexagon (6 segments), plus a 3-segment centre cross.
const MAX_POINTS = (6 + 3) * 2;
const CROSS = 0.02;

/**
 * Where the section plane is: its outline through the stack's bounds, and a cross
 * at its centre.
 *
 * ⭐ The outline is traced against the BOX rather than drawn as an arbitrary quad,
 * so it shows exactly where the cut meets the block — which is the question being
 * asked. `sectionPlaneOutline` is the same convex-polygon-from-edges trick the cut
 * face itself uses.
 *
 * On `LAYERS.OVERLAY` so it is drawn after the transparent passes and stays
 * legible through a translucent stack, and on `LAYERS.NOT_EMITTER` so a debug aid
 * can never take a pointer hit off the geology.
 *
 * @group Components
 */
export const ChunkSectionDebug = ({
  section,
  min,
  max,
  color = '#ffcc33',
}: ChunkSectionDebugProps) => {
  const lines = useRef<LineSegments>(null);
  const layers = useMemo(
    () => createLayers(LAYERS.OVERLAY, LAYERS.NOT_EMITTER),
    [],
  );

  const { geometry, material, points, outline } = useMemo(() => {
    const positions = new Float32Array(MAX_POINTS * 3);
    const attribute = new BufferAttribute(positions, 3);
    attribute.setUsage(DynamicDrawUsage);
    const geo = new BufferGeometry();
    geo.setAttribute('position', attribute);
    geo.setDrawRange(0, 0);
    return {
      geometry: geo,
      material: new LineBasicMaterial({ color, toneMapped: false }),
      points: positions,
      outline: new Float32Array(18),
    };
  }, [color]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  const plane = useMemo<StackSectionPlane>(
    () => ({ normal: [0, 0, 0], constant: 0 }),
    [],
  );

  useFrame(() => {
    const node = lines.current;
    if (!node) return;
    if (!section?.enabled) {
      geometry.setDrawRange(0, 0);
      return;
    }
    const n = section.plane.normal;
    plane.normal[0] = n.x;
    plane.normal[1] = n.y;
    plane.normal[2] = n.z;
    plane.constant = section.plane.constant;

    const count = sectionPlaneOutline(min, max, plane, outline);
    if (count === 0) {
      geometry.setDrawRange(0, 0);
      return;
    }

    let at = 0;
    const push = (x: number, y: number, z: number) => {
      points[3 * at] = x;
      points[3 * at + 1] = y;
      points[3 * at + 2] = z;
      at++;
    };
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < count; k++) {
      const j = (k + 1) % count;
      push(outline[3 * k], outline[3 * k + 1], outline[3 * k + 2]);
      push(outline[3 * j], outline[3 * j + 1], outline[3 * j + 2]);
      cx += outline[3 * k];
      cy += outline[3 * k + 1];
      cz += outline[3 * k + 2];
    }
    cx /= count;
    cy /= count;
    cz /= count;

    // Sized from the outline itself, so the cross reads at any scale.
    const span =
      Math.hypot(outline[0] - cx, outline[1] - cy, outline[2] - cz) * CROSS + 1;
    push(cx - span, cy, cz);
    push(cx + span, cy, cz);
    push(cx, cy - span, cz);
    push(cx, cy + span, cz);
    push(cx, cy, cz - span);
    push(cx, cy, cz + span);

    geometry.setDrawRange(0, at);
    geometry.attributes.position.needsUpdate = true;
  });

  return (
    <lineSegments
      ref={lines}
      name="ChunkSectionDebug"
      geometry={geometry}
      material={material}
      layers={layers}
      frustumCulled={false}
    />
  );
};
