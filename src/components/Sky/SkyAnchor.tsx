import { useFrame } from '@react-three/fiber';
import { ReactNode, useEffect, useRef } from 'react';
import { Group, Vector4 } from 'three';
import type { Vec2 } from '../../sdk/types/common';
import { placeOnSkyCurve } from './sky-anchor';
import { useSkyOcean } from './sky-context';

/**
 * SkyAnchor props
 * @expand
 */
export type SkyAnchorProps = {
  /**
   * World X/Z of the point placed on the curve: what lies there meets the curved sea
   * level and square. Default the middle of the flat sea's disc — a `SkyBoxStage`'s
   * `bounds` — where a field usually lies.
   */
  at?: Vec2;
  children?: ReactNode;
};

/**
 * Places its children on the curve of the enclosing {@link Sky}'s sea, rigidly, each
 * frame: lowered by as much as the sea is at `at` and tilted to its slope there, so a
 * field — a chunk stack, wellbores, anything drawn flat — stays on the sea as the sky
 * curves it, seen from anywhere.
 *
 * While the camera is near the scene the sea is flat over it, and the children are not
 * moved at all. Once the camera is far off along the level (or high up), and while the
 * ground curves with the sea (a stage's relief drawn from tiles), the sky measures its
 * curve from under the camera (`SkyMaterial.followFlatSea`), and the scene's disc falls
 * away with the rest: without an anchor, what lies on it would stand off the sea. Over a
 * field the curve and the plane it is placed on then part by `d² / 2R`: about 5 m at 8 km
 * from `at`, 20 m at 16 km.
 *
 * What lies outside the `Sky` can be anchored by the stage it occupies instead
 * (`SkyBoxStageOccupant.anchor`).
 *
 * ⚠️ Assumes the default `up` (+Y), as a `SkyBoxStage` does. Without a sky with a sea, or
 * without `curvedHorizon`, it does nothing.
 *
 * @group Components
 */
export const SkyAnchor = ({ at, children }: SkyAnchorProps) => {
  const material = useSkyOcean()?.material ?? null;
  const group = useRef<Group>(null);
  const ax = at?.[0];
  const az = at?.[1];

  useEffect(() => {
    if (material) return;
    group.current?.position.set(0, 0, 0);
    group.current?.quaternion.identity();
  }, [material]);

  useFrame(({ camera }) => {
    if (!group.current || !material) return;
    const stage = material.uniforms.uSkyStageFlat.value as Vector4;
    placeOnSkyCurve(
      group.current,
      material,
      camera.position,
      ax ?? stage.x,
      az ?? stage.z,
    );
  });

  return <group ref={group}>{children}</group>;
};
