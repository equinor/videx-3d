import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  ColorRepresentation,
  InstancedBufferAttribute,
  Mesh,
  Vector2,
  Vector4,
} from 'three';
import type { ReliefGrid } from '../../sdk/geometries/relief-grid';
import {
  createTerrainLod,
  selectTerrainNodes,
  terrainLodHeightGap,
  terrainLodMorph,
} from '../../sdk/geometries/terrain-lod';
import {
  createSkyReliefFarMaterial,
  createSkyReliefMaterial,
  createSkyReliefPatch,
  createSkyReliefTexture,
  SKY_RELIEF_CELLS,
  SKY_RELIEF_LEVELS,
} from './sky-relief';
import { createSkyGeometry, type SkyMaterial } from './sky-material';
import { SKY_EARTH_RADIUS } from './sky-model';
import type { SkyStageBounds } from './sky-stage';

type SkyBoxStageReliefLayerProps = {
  sky: SkyMaterial;
  grid: ReliefGrid;
  /** the stage's own area, which the relief leaves to it */
  area: SkyStageBounds;
  falloff: number;
  color: 'ramp' | ColorRepresentation;
  /** how far from the camera to draw it */
  reach: number;
  level: number;
  bedY: number;
  /** the sky's seabed detail (its key), compiled into the material with the sky's defines */
  bedDetail?: string;
  visible: boolean;
};

/**
 * A stage's relief: the patch drawn once per node the level of detail picks from the
 * camera, every frame. Past its reach, while the sea's horizon lies farther, a fullscreen
 * layer draws the land flat on the sea.
 */
export const SkyBoxStageReliefLayer = ({
  sky,
  grid,
  area,
  falloff,
  color,
  reach,
  level,
  bedY,
  bedDetail,
  visible,
}: SkyBoxStageReliefLayerProps) => {
  const texture = useMemo(() => createSkyReliefTexture(grid), [grid]);
  useEffect(() => () => texture.dispose(), [texture]);
  const geometry = useMemo(() => createSkyReliefPatch(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const ramp = color === 'ramp';
  const material = useMemo(
    () => createSkyReliefMaterial(sky, texture, grid, ramp ? 'ramp' : 0),
    // The seabed's detail is compiled in, from the sky's defines: a new one needs a new material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sky, texture, grid, ramp, bedDetail],
  );
  useEffect(() => () => material.dispose(), [material]);
  const farMaterial = useMemo(
    () => createSkyReliefFarMaterial(material),
    [material],
  );
  useEffect(() => () => farMaterial.dispose(), [farMaterial]);
  useEffect(() => {
    material.uniforms.uReliefReach.value = reach;
  }, [material, reach]);
  const farGeometry = useMemo(() => createSkyGeometry(), []);
  useEffect(() => () => farGeometry.dispose(), [farGeometry]);
  const farMesh = useRef<Mesh>(null);
  useEffect(() => {
    if (!ramp) material.uniforms.uReliefLandColor.value.set(color);
  }, [material, ramp, color]);
  useEffect(() => {
    material.uniforms.uReliefArea.value.fromArray(area);
    material.uniforms.uReliefFalloff.value = falloff;
  }, [material, area, falloff]);

  const lod = useMemo(() => {
    const minY = level + Math.min(grid.min, bedY - level);
    const maxY = level + Math.max(grid.max, bedY - level);
    let made = createTerrainLod(grid.cell, SKY_RELIEF_CELLS, reach, minY, maxY);
    // Past the shader's table, coarser at the finest.
    const over = made.levels - (SKY_RELIEF_LEVELS - 1);
    if (over > 0) {
      made = createTerrainLod(
        grid.cell * 2 ** over,
        SKY_RELIEF_CELLS,
        reach,
        minY,
        maxY,
      );
    }
    return made;
  }, [grid, reach, level, bedY]);
  useEffect(() => {
    const morph = terrainLodMorph(lod);
    const table = material.uniforms.uReliefMorph.value as Vector2[];
    table.forEach((entry, i) => {
      const at = Math.min(i, lod.levels);
      entry.set(morph[2 * at], morph[2 * at + 1]);
    });
  }, [material, lod]);

  const nodes = geometry.getAttribute('reliefNode') as InstancedBufferAttribute;
  // The level of detail this frame: no farther than can be seen.
  const seen = useMemo(() => ({ ...lod }), [lod]);
  useFrame(({ camera }) => {
    const { x, y, z } = camera.position;
    seen.reach = lod.reach;
    let beyond = true;
    if (sky.curvedHorizon) {
      // The farthest the curved sea's horizon lies along any bearing (it curves away from
      // the disc the sea is flat over), and past it the highest relief's own horizon.
      const flat = sky.uniforms.uSkyFlat.value as Vector4;
      const horizon =
        flat.w +
        Math.hypot(x - flat.x, z - flat.z) +
        Math.sqrt(2 * SKY_EARTH_RADIUS * Math.max(y - level, 0)) +
        Math.sqrt(2 * SKY_EARTH_RADIUS * Math.max(grid.max, 0));
      seen.reach = Math.min(lod.reach, horizon + lod.nodeSize);
      beyond = horizon > lod.reach;
    }
    if (farMesh.current) farMesh.current.visible = visible && beyond;
    const count = selectTerrainNodes(
      [x, y, z],
      seen,
      nodes.array as Float32Array,
    );
    geometry.instanceCount = count;
    // ⚠️ An empty update range uploads the whole array's tail instead.
    if (count > 0) {
      nodes.clearUpdateRanges();
      nodes.addUpdateRange(0, 4 * count);
      nodes.needsUpdate = true;
    }
    material.uniforms.uReliefDy.value = terrainLodHeightGap([x, y, z], lod);
  });

  return (
    <>
      <mesh
        geometry={geometry}
        material={material}
        frustumCulled={false}
        visible={visible}
      />
      {/* Shown each frame. */}
      <mesh
        ref={farMesh}
        geometry={farGeometry}
        material={farMaterial}
        frustumCulled={false}
        visible={false}
      />
    </>
  );
};
