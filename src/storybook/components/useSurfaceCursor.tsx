import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Color, DoubleSide, Group, MeshBasicMaterial, Vector3 } from 'three';
import {
  sampleSurfaceFootprint,
  SurfaceFootprint,
  useSurfaceSampler,
} from '../../components/Chunks/surface-sampler';
import { EventEmitterCallbackEvent } from '../../components/EventEmitter';
import { CameraFocusAtPointEvent } from '../../events/camera-events';
import { PointerEvents } from '../../events/interaction-events';
import { createLayers, LAYERS } from '../../layers/layers';
import { Vec3 } from '../../sdk';

/** Where a click put the cursor down, and how the ground was lying there. */
export type SurfacePlacement = {
  position: Vec3;
  normal: Vec3;
  /** angle between the fitted plane and horizontal, in degrees */
  tilt: number;
  coverage: number;
  /** height range of the surface under the footprint (m) */
  relief: number;
};

export type SurfaceCursorOptions = {
  /** radius of the placeholder, in metres — also the radius it samples over */
  radius?: number;
  /** points around the ring it fits its plane to */
  samples?: number;
  color?: string;
  /** colour when part of the footprint is off the drawn surface */
  rejectColor?: string;
  /** ctrl+click flies the camera to the point under the cursor. Default true. */
  focus?: boolean;
  /** how close the camera ends up (m). Follows the cursor's own size when unset. */
  focusDistance?: number;
  onPlace?: (placement: SurfacePlacement) => void;
};

const UP = new Vector3(0, 1, 0);

/**
 * A placeholder that follows the pointer across a drawn surface — the third
 * sampling case, and the only DYNAMIC one.
 *
 * ⭐ Two mechanisms, each answering what the other cannot. GPU picking says WHERE
 * the pointer is, against what is actually rendered — a height sampler cannot,
 * since it has no idea where the ray went. The footprint fit then says HOW the
 * object sits there: a pick returns a single point, and one point cannot orient a
 * disc metres across.
 *
 * Returns the handlers to hand to a `Chunk` and the gizmo to render beside it —
 * the gizmo must stay OUTSIDE the chunk, or the pointer picks the cursor instead
 * of the ground. (An object can also opt out with `LAYERS.NOT_EMITTER`.)
 *
 * ⚠️ Call it BELOW a `ChunkStack`: it reads the surface sampler from that
 * provider. Called in the component that RENDERS the stack it gets `null`, and
 * the pointer then does nothing at all — with no error to say why.
 *
 * Storybook only.
 *
 * @example
 * const cursor = useSurfaceCursor({ radius: 120 });
 * <Chunk layers={layers} {...cursor.events} />
 * {cursor.node}
 */
export function useSurfaceCursor({
  radius = 60,
  samples = 12,
  color = '#4be0c8',
  rejectColor = '#e0644b',
  focus = true,
  focusDistance,
  onPlace,
}: SurfaceCursorOptions = {}): { events: PointerEvents; node: ReactNode } {
  const sampler = useSurfaceSampler();
  const group = useRef<Group>(null);
  const [placed, setPlaced] = useState<SurfacePlacement[]>([]);

  const onPlaceRef = useRef(onPlace);
  useEffect(() => {
    onPlaceRef.current = onPlace;
  }, [onPlace]);

  const materials = useMemo(
    () => ({
      cursor: new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        side: DoubleSide,
        // The ring lies ON the surface, so it would z-fight it.
        depthTest: false,
      }),
      // A marker stands clear of the ground, so it can be depth-tested normally:
      // hidden behind land, still seen through the water, which writes no depth.
      pin: new MeshBasicMaterial({ color }),
    }),
    [color],
  );
  useEffect(() => {
    return () => {
      materials.cursor.dispose();
      materials.pin.dispose();
    };
  }, [materials]);

  const accept = useMemo(() => new Color(color), [color]);
  const reject = useMemo(() => new Color(rejectColor), [rejectColor]);
  const overlay = useMemo(() => createLayers(LAYERS.OVERLAY), []);

  // Everything the pointer drives is written straight onto the Object3D: a move
  // must not cost a React render.
  const state = useRef({
    point: new Vector3(),
    normal: new Vector3(),
    fit: null as SurfaceFootprint | null,
  });

  const events = useMemo<PointerEvents>(() => {
    const track = (event: EventEmitterCallbackEvent) => {
      const cursor = group.current;
      if (!cursor || !sampler || !event.position) return;
      // ⚠️ The hit is in WORLD space; the chunk's geometry — and so the sampler —
      // lives in the UtmArea group's frame. `event.target` is the chunk's own
      // group, which is in exactly that frame.
      const local = event.target.worldToLocal(
        state.current.point.set(
          event.position[0],
          event.position[1],
          event.position[2],
        ),
      );

      const fit = sampleSurfaceFootprint(sampler, {
        x: local.x,
        z: local.z,
        radius,
        samples,
      });
      state.current.fit = fit;
      if (!fit) {
        cursor.visible = false;
        return;
      }

      cursor.visible = true;
      cursor.position.set(local.x, fit.y, local.z);
      state.current.normal.set(fit.normal[0], fit.normal[1], fit.normal[2]);
      cursor.quaternion.setFromUnitVectors(UP, state.current.normal);
      materials.cursor.color.copy(fit.coverage < 1 ? reject : accept);
    };

    return {
      onPointerMove: track,
      onPointerEnter: track,
      onPointerLeave: () => {
        if (group.current) group.current.visible = false;
      },
      onPointerClick: (event: EventEmitterCallbackEvent) => {
        // Right-click clears. A right DRAG trucks the camera, but the emitter
        // only calls a short, still press a click, so the two do not collide.
        if (event.button === 2) {
          setPlaced([]);
          return;
        }
        if (event.button !== undefined && event.button !== 0) return;

        const fit = state.current.fit;
        const cursor = group.current;
        if (!fit || !cursor || fit.coverage < 1) return;

        if (focus && event.keys.ctrlKey) {
          // ⚠️ Back to WORLD space: the camera knows nothing about the stack's
          // frame. The pick's own position would do, but this is the point the
          // cursor settled on, which is what was aimed at.
          const world = event.target.localToWorld(
            new Vector3(cursor.position.x, fit.y, cursor.position.z),
          );
          dispatchEvent(
            new CameraFocusAtPointEvent({
              point: [world.x, world.y, world.z],
              distance: focusDistance ?? radius * 8,
            }),
          );
          return;
        }

        const placement: SurfacePlacement = {
          position: [cursor.position.x, fit.y, cursor.position.z],
          normal: fit.normal,
          tilt: (Math.acos(Math.min(1, fit.normal[1])) * 180) / Math.PI,
          coverage: fit.coverage,
          relief: fit.max - fit.min,
        };
        setPlaced(previous => [...previous, placement]);
        onPlaceRef.current?.(placement);
      },
    };
  }, [
    sampler,
    radius,
    samples,
    materials,
    accept,
    reject,
    focus,
    focusDistance,
  ]);

  const node = (
    <>
      {/* ⭐ On the OVERLAY layer: the OITRenderPass draws that last, after the
          transparent layers, so the sea is not painted over the top of it. */}
      <group ref={group} visible={false}>
        <mesh
          material={materials.cursor}
          layers={overlay}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[radius * 0.82, radius, 48]} />
        </mesh>
        <mesh
          material={materials.cursor}
          layers={overlay}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[radius * 0.12, 16]} />
        </mesh>
      </group>

      {placed.map(placement => (
        <mesh
          key={placement.position.join(',')}
          material={materials.pin}
          layers={overlay}
          position={[
            placement.position[0],
            placement.position[1] + radius * 0.5,
            placement.position[2],
          ]}
        >
          <cylinderGeometry args={[0, radius * 0.18, radius, 8]} />
        </mesh>
      ))}
    </>
  );

  return { events, node };
}
