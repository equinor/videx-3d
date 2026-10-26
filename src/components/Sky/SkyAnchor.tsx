import { useFrame } from '@react-three/fiber';
import { ReactNode, useEffect, useRef } from 'react';
import { Group } from 'three';
import type { Globe } from '../../sdk/projection/globe';
import type { Vec2 } from '../../sdk/types/common';
import { placeOnGlobe } from './sky-anchor';
import { useSkyOcean } from './sky-context';

/**
 * SkyAnchor props
 * @expand
 */
export type SkyAnchorProps = {
  /**
   * World X/Z of the point placed on the globe: what lies there meets the globe's sea level
   * and square. Default the middle of the globe's disc — a `SkyBoxStage`'s `bounds` — where
   * a field usually lies, and where nothing moves.
   */
  at?: Vec2;
  /** the globe to place on; default the enclosing {@link Sky}'s */
  globe?: Globe;
  children?: ReactNode;
};

/**
 * Places its children rigidly on the globe — the enclosing {@link Sky}'s, or `globe` —
 * about `at`: what lies there goes where the globe has it, turned so the scene's up is the
 * globe's up there (`Globe.place`). For content drawn flat that lies beyond the globe's flat
 * disc: a second field, a facility far out. Over the disc nothing moves, so the field the
 * sky is about never does; the plane and the globe part by `d² / 2R` across what is placed,
 * about 5 m at 8 km from `at`. Nothing in it depends on the camera.
 *
 * What lies outside the `Sky` can be anchored by the stage it occupies instead
 * (`SkyBoxStageOccupant.anchor`); what is long rather than rigid, per vertex
 * (`applyGlobe`).
 *
 * ⚠️ Assumes the default `up` (+Y), as a `SkyBoxStage` does. Without a globe, or with it
 * off (`curvedHorizon: false`), it does nothing.
 *
 * @group Components
 */
export const SkyAnchor = ({ at, globe, children }: SkyAnchorProps) => {
  const material = useSkyOcean()?.material ?? null;
  const placing = globe ?? material?.globe ?? null;
  const group = useRef<Group>(null);
  const ax = at?.[0];
  const az = at?.[1];

  useEffect(() => {
    if (placing) return;
    group.current?.position.set(0, 0, 0);
    group.current?.quaternion.identity();
  }, [placing]);

  // Each frame, as the globe's disc or level may change under it: a few vector operations.
  useFrame(() => {
    if (!group.current || !placing) return;
    const centre = placing.discCentre;
    placeOnGlobe(group.current, placing, ax ?? centre.x, az ?? centre.z);
  });

  return <group ref={group}>{children}</group>;
};
