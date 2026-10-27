import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Mesh, Texture } from 'three';
import { precompile, PRECOMPILE_PRIORITY } from '../../rendering/precompile';
import type { ReliefLayer } from '../../sdk/geometries/relief-tiles';
import type { SceneryReliefResponse } from './scenery-defs';
import {
  createSceneryReliefFarMaterial,
  createSceneryReliefTexture,
  SCENERY_RELIEF_FAR_MAX_LAYERS,
  type SceneryReliefFarLayer,
} from './scenery-relief';
import {
  createSceneryGeometry,
  type SceneryMaterial,
} from './scenery-material';

// The highest ground on the Earth, metres: how far past the sea's horizon land can show
// before the overview's grids, which know their own, are in.
const HIGHEST_GROUND = 8849;

type SceneryStageReliefOverviewProps = {
  sky: SceneryMaterial;
  /** the relief's layers, coarse to fine, as its tiles merge them */
  layers: ReliefLayer[];
  /** the height where no layer has data, metres over the sea: the tiles' base */
  base: number;
  /** the `sceneryRelief` generator */
  generator: (
    id: string,
    options?: { feather?: number },
  ) => Promise<SceneryReliefResponse>;
  /** the relief's looks (`SceneryReliefLooks.texture`): each layer takes its own, as on the tiles */
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
 * globe's sea, from the relief's layers in longitude and latitude, merged and looked as the
 * tiles merge and look them, wherever on the Earth. Its grids are made the first time it
 * is needed, so a far plane that always reaches the ground in view costs nothing.
 */
export const SceneryStageReliefOverview = ({
  sky,
  layers,
  base,
  generator,
  looks,
  reach,
  bedDetail,
  skyOrder,
  visible,
}: SceneryStageReliefOverviewProps) => {
  // Its first layers (a texture unit each), by value: a relief made each render bakes nothing again.
  const layerKey = JSON.stringify(
    layers
      .slice(0, SCENERY_RELIEF_FAR_MAX_LAYERS)
      .map(({ id, feather }) => [id, feather ?? 0]),
  );
  useEffect(() => {
    if (import.meta.env.DEV && layers.length > SCENERY_RELIEF_FAR_MAX_LAYERS)
      console.warn(
        `SceneryStage: the overview past the tiles merges the relief's first ${SCENERY_RELIEF_FAR_MAX_LAYERS} layers of ${layers.length}`,
      );
  }, [layers.length]);

  const [wanted, setWanted] = useState(false);
  const [grids, setGrids] = useState<
    { grid: NonNullable<SceneryReliefResponse>; look: number }[] | null
  >(null);
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    const specs = JSON.parse(layerKey) as [string, number][];
    Promise.all(specs.map(([id, feather]) => generator(id, { feather }))).then(
      made => {
        if (!current) return;
        const baked = made.flatMap((grid, i) =>
          grid ? [{ grid, look: i + 1 }] : [],
        );
        setGrids(baked.length ? baked : null);
      },
    );
    return () => {
      current = false;
      setGrids(null);
    };
  }, [wanted, generator, layerKey]);

  const far = useMemo<SceneryReliefFarLayer[] | null>(
    () =>
      grids?.map(({ grid, look }) => ({
        grid,
        texture: createSceneryReliefTexture(grid),
        look,
      })) ?? null,
    [grids],
  );
  useEffect(
    () => () => far?.forEach(({ texture }) => texture.dispose()),
    [far],
  );
  const highest = useMemo(
    () =>
      grids ? Math.max(...grids.map(({ grid }) => grid.max)) : HIGHEST_GROUND,
    [grids],
  );

  const material = useMemo(
    () => (far ? createSceneryReliefFarMaterial(sky, far, base, looks) : null),
    // The seabed's detail is compiled in, from the sky's defines: a new one needs a new material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sky, far, looks, bedDetail],
  );
  useEffect(() => () => material?.dispose(), [material]);
  useEffect(() => {
    if (material) material.uniforms.uReliefReach.value = reach;
  }, [material, reach]);
  useEffect(() => {
    if (material) material.uniforms.uReliefBase.value = base;
  }, [material, base]);
  const geometry = useMemo(() => createSceneryGeometry(), []);
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
    const pending = precompile(gl, mesh.current, sceneCamera, scene, 'scene', {
      priority: PRECOMPILE_PRIORITY.background,
    });
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
      const horizon =
        sky.globe.discRadius +
        Math.sqrt(2 * R * altitude + altitude * altitude) +
        Math.sqrt(2 * R * Math.max(highest, 0));
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
