import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Mesh, Texture } from 'three';
import { precompile } from '../../rendering/precompile';
import type { ReliefGeoGrid } from '../../sdk/geometries/relief-grid';
import type { SkyReliefResponse } from './sky-defs';
import {
  createSkyReliefFarMaterial,
  createSkyReliefTexture,
} from './sky-relief';
import { createSkyGeometry, type SkyMaterial } from './sky-material';

// The highest ground on the Earth, metres: how far past the sea's horizon land can show
// before the overview's grid, which knows its own, is in.
const HIGHEST_GROUND = 8849;

type SkyBoxStageReliefOverviewProps = {
  sky: SkyMaterial;
  /** the relief's first layer */
  reliefId: string;
  /** the `skyRelief` generator */
  generator: (id: string) => Promise<SkyReliefResponse>;
  /** the relief's looks (`SkyReliefLooks.texture`): the overview takes the relief's own */
  looks: Texture;
  /** how far from the camera the tiles draw: the overview draws past it */
  reach: number;
  /** the sky's seabed detail (its key), compiled into the material with the sky's defines */
  bedDetail?: string;
  /** the sky's sea surface layer's `renderOrder`: the overview draws after it */
  skyOrder: number;
  visible: boolean;
};

/**
 * The overview behind a stage's relief drawn from tiles: past the tiles' reach, while the
 * farthest ground in view lies farther, a fullscreen layer draws the land flat on the
 * globe's sea, from the relief's first layer in longitude and latitude, wherever on the
 * Earth. Its grid is made the first time it is needed, so a far plane that always reaches
 * the ground in view costs nothing.
 */
export const SkyBoxStageReliefOverview = ({
  sky,
  reliefId,
  generator,
  looks,
  reach,
  bedDetail,
  skyOrder,
  visible,
}: SkyBoxStageReliefOverviewProps) => {
  const [wanted, setWanted] = useState(false);
  const [grid, setGrid] = useState<ReliefGeoGrid | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    generator(reliefId).then(made => {
      if (current) setGrid(made ?? null);
    });
    return () => {
      current = false;
      setGrid(null);
    };
  }, [wanted, generator, reliefId]);

  const texture = useMemo(
    () => (grid ? createSkyReliefTexture(grid) : null),
    [grid],
  );
  useEffect(() => () => texture?.dispose(), [texture]);

  const material = useMemo(
    () =>
      grid && texture
        ? createSkyReliefFarMaterial(sky, texture, grid, looks)
        : null,
    // The seabed's detail is compiled in, from the sky's defines: a new one needs a new material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sky, texture, grid, looks, bedDetail],
  );
  useEffect(() => () => material?.dispose(), [material]);
  useEffect(() => {
    if (material) material.uniforms.uReliefReach.value = reach;
  }, [material, reach]);
  const geometry = useMemo(() => createSkyGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Compiled in the background, as the sky's own are, and shown once compiled: made late,
  // it would otherwise stall the frame that first draws it.
  const mesh = useRef<Mesh>(null);
  const [compiled, setCompiled] = useState<object | null>(null);
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const sceneCamera = useThree(state => state.camera);
  useLayoutEffect(() => {
    if (!material || !mesh.current) return;
    let current = true;
    const pending = precompile(
      gl,
      mesh.current,
      sceneCamera,
      scene,
      'scene',
      true,
    );
    if (!pending) setCompiled(material);
    else
      pending.then(() => {
        if (current) setCompiled(material);
      });
    return () => {
      current = false;
    };
  }, [gl, scene, sceneCamera, material]);

  useFrame(({ camera }) => {
    let beyond = true;
    if (sky.globeEnabled) {
      // The farthest ground in view: the globe's horizon from the camera, and past it the
      // highest ground's own; over the disc a view runs on level as far as its edge.
      const R = sky.globe.radius;
      const altitude = Math.max(sky.globe.altitude(camera.position), 0);
      const highest = Math.max(grid?.max ?? HIGHEST_GROUND, 0);
      const horizon =
        sky.globe.discRadius +
        Math.sqrt(2 * R * altitude + altitude * altitude) +
        Math.sqrt(2 * R * highest);
      beyond = horizon > reach;
    }
    if (visible && beyond && !wanted) setWanted(true);
    if (mesh.current)
      mesh.current.visible = visible && beyond && compiled === material;
  });

  if (!material) return null;
  return (
    // Shown each frame.
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={skyOrder + 1}
      visible={false}
      onBeforeRender={sky.onBeforeDraw}
    />
  );
};
