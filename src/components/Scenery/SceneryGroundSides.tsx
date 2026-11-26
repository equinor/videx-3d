import { useFrame, useThree } from '@react-three/fiber';
import { ReactNode, useLayoutEffect, useRef } from 'react';
import { Group, Material, Object3D } from 'three';
import { precompile, PRECOMPILE_PRIORITY } from '../../rendering/precompile';
import {
  sceneryGroundSides,
  type SceneryGroundSide,
} from './scenery-ground-sides';

/**
 * SceneryBelowGround and SceneryAboveGround props
 * @expand
 */
export type SceneryGroundSideProps = {
  children?: ReactNode;
};

// How often, in frames, hidden content is looked through for programs not compiled yet.
const COMPILE_CHECK_FRAMES = 30;

const GroundSide = ({
  side,
  children,
}: SceneryGroundSideProps & { side: SceneryGroundSide }) => {
  const scene = useThree(state => state.scene);
  const gl = useThree(state => state.gl);
  const group = useRef<Group>(null);

  useLayoutEffect(() => {
    const own = group.current;
    if (!own) return;
    const sides = sceneryGroundSides(scene);
    sides.set(own, side);
    return () => {
      sides.delete(own);
      own.visible = true;
    };
  }, [scene, side]);

  // Hidden, three compiles nothing of it: what has no program yet is compiled in the
  // background meanwhile, once, so it shows without a stall.
  const queued = useRef(new WeakSet<Object3D>());
  const frames = useRef(0);
  useFrame(({ camera }) => {
    const own = group.current;
    if (!own || own.visible) return;
    if (frames.current++ % COMPILE_CHECK_FRAMES !== 0) return;
    own.traverse(object => {
      const material = (
        object as Object3D & { material?: Material | Material[] }
      ).material;
      if (!material || queued.current.has(object)) return;
      const compiled = [material]
        .flat()
        .every(
          m =>
            !!(gl.properties.get(m) as { currentProgram?: unknown })
              .currentProgram,
        );
      if (compiled) return;
      // Its descendants with it: `precompile` takes all it holds.
      object.traverse(o => queued.current.add(o));
      void precompile(gl, object, camera, scene, 'scene', {
        priority: PRECOMPILE_PRIORITY.background,
      });
    });
  });

  return <group ref={group}>{children}</group>;
};

/**
 * Content that lies wholly below the ground a {@link Scenery} draws — under its sea's seabed,
 * or in rock under a relief: a `ZoneStack` built on the relief, a seismic cube, a reservoir
 * model. Hidden, and so not drawn at all, while the ground hides it from the camera: the
 * camera above the seabed, and the seabed drawn whole and opaque — the Scenery drawn and
 * ready, with a sea whose seabed is on at full opacity (`seabedOpacity`), and nothing opening
 * it: no `SceneryCutaway` taking it, no stage occupant's cut through it, no open hollow
 * (`SceneryHollow.open`), no `debug.hide`. Shown wherever it can be seen: from below the
 * seabed, near it, through any opening, and without a Scenery in the scene.
 *
 * Decided by the Scenery each frame, as it draws, for the camera it draws with. It can sit
 * anywhere in the scene, inside the Scenery or not. What it holds is compiled while hidden,
 * so it shows without a stall.
 *
 * ⚠️ Only what lies wholly below the ground: a wellbore, which runs down from the surface
 * through the water, belongs to neither side. A stage's own debug views that draw the ground
 * see-through (a wireframe) are not seen.
 *
 * @group Components
 */
export const SceneryBelowGround = ({ children }: SceneryGroundSideProps) => (
  <GroundSide side="below">{children}</GroundSide>
);

/**
 * Content that lies wholly above the ground a {@link Scenery} draws — over its sea's seabed:
 * what stands on the seabed, floats on the sea or flies over it. Hidden, and so not drawn at
 * all, while the ground hides it from the camera: the camera below the seabed — in the void,
 * in rock — with the seabed closed over it as for {@link SceneryBelowGround}. Shown wherever
 * it can be seen.
 *
 * @group Components
 */
export const SceneryAboveGround = ({ children }: SceneryGroundSideProps) => (
  <GroundSide side="above">{children}</GroundSide>
);
