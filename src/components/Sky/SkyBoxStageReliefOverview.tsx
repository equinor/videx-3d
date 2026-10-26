import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { ColorRepresentation, Mesh, Vector4 } from 'three';
import type { ReliefGrid } from '../../sdk/geometries/relief-grid';
import {
  createSkyReliefFarMaterial,
  createSkyReliefTexture,
} from './sky-relief';
import { createSkyGeometry, type SkyMaterial } from './sky-material';
import { SKY_EARTH_RADIUS } from './sky-model';

type SkyBoxStageReliefOverviewProps = {
  sky: SkyMaterial;
  /** the relief's first layer, resampled over the reach (the `skyRelief` generator) */
  grid: ReliefGrid;
  color: 'ramp' | ColorRepresentation;
  /** how far from the camera the tiles draw: the overview draws past it */
  reach: number;
  level: number;
  /** the sky's seabed detail (its key), compiled into the material with the sky's defines */
  bedDetail?: string;
  /** the sky's sea surface layer's `renderOrder`: the overview draws after it */
  skyOrder: number;
  visible: boolean;
};

/**
 * The overview behind a stage's relief drawn from tiles: past the tiles' reach, while the
 * sea's horizon lies farther, a fullscreen layer draws the land flat on the curved sea.
 */
export const SkyBoxStageReliefOverview = ({
  sky,
  grid,
  color,
  reach,
  level,
  bedDetail,
  skyOrder,
  visible,
}: SkyBoxStageReliefOverviewProps) => {
  const texture = useMemo(() => createSkyReliefTexture(grid), [grid]);
  useEffect(() => () => texture.dispose(), [texture]);

  const ramp = color === 'ramp';
  const material = useMemo(
    () => createSkyReliefFarMaterial(sky, texture, grid, ramp ? 'ramp' : 0),
    // The seabed's detail is compiled in, from the sky's defines: a new one needs a new material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sky, texture, grid, ramp, bedDetail],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.uniforms.uReliefReach.value = reach;
  }, [material, reach]);
  useEffect(() => {
    if (!ramp) material.uniforms.uReliefLandColor.value.set(color);
  }, [material, ramp, color]);
  const geometry = useMemo(() => createSkyGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const mesh = useRef<Mesh>(null);
  useFrame(({ camera }) => {
    if (!mesh.current) return;
    let beyond = true;
    if (sky.curvedHorizon) {
      // The farthest the curved sea's horizon lies along any bearing (it curves away from
      // the disc the sea is flat over), and past it the highest relief's own horizon.
      const { x, y, z } = camera.position;
      const flat = sky.uniforms.uSkyFlat.value as Vector4;
      const horizon =
        flat.w +
        Math.hypot(x - flat.x, z - flat.z) +
        Math.sqrt(2 * SKY_EARTH_RADIUS * Math.max(y - level, 0)) +
        Math.sqrt(2 * SKY_EARTH_RADIUS * Math.max(grid.max, 0));
      beyond = horizon > reach;
    }
    mesh.current.visible = visible && beyond;
  });

  return (
    // Shown each frame.
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={skyOrder + 1}
      visible={false}
    />
  );
};
