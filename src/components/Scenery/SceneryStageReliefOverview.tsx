import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Mesh, Texture } from 'three';
import { precompile, PRECOMPILE_PRIORITY } from '../../rendering/precompile';
import { createSceneryReliefFarMaterial } from './scenery-relief';
import type { SceneryReliefAtlas } from './scenery-relief-atlas';
import {
  createSceneryGeometry,
  type SceneryMaterial,
} from './scenery-material';

/** What the tiles tell the overview each frame (see `SceneryStageReliefTiles`). */
export type SceneryReliefOverviewState = {
  /** the farthest ground in view lies past the tiles' reach: the overview is wanted */
  beyond: boolean;
};

type SceneryStageReliefOverviewProps = {
  sky: SceneryMaterial;
  /** the tiles chosen for it, indexed in `geoTileSquare`'s coordinates, by the tiles' frame loop */
  atlas: SceneryReliefAtlas;
  /** what the tiles' frame loop tells it, each frame */
  told: SceneryReliefOverviewState;
  /** the height where no layer has data, metres over the sea: the tiles' base */
  base: number;
  /** the relief's looks (`SceneryReliefLooks.texture`): each layer takes its own, as on the tiles */
  looks: Texture;
  /** how far from the camera the tiles draw: the overview draws past it */
  reach: number;
  /** what it compiles with from the sky, as a key (`SceneryOceanState.definesKey`): a new one needs a new material */
  definesKey?: string;
  /** the sky's sea surface layer's `renderOrder`: the overview draws after it */
  skyOrder: number;
  visible: boolean;
};

/**
 * The overview behind a stage's relief drawn from tiles: past the tiles' reach, while the
 * farthest ground in view lies farther, a fullscreen layer draws the land flat on the
 * globe's sea, from the relief's own tiles — chosen for it by the tiles' frame loop, coarser
 * than theirs, and read per pixel through `atlas` — looked as the tiles look them, wherever
 * on the Earth. However many layers, and however large, only the tiles in view are read. Its
 * material is made the first time it is wanted, so a far plane that always reaches the
 * ground in view costs nothing.
 */
export const SceneryStageReliefOverview = ({
  sky,
  atlas,
  told,
  base,
  looks,
  reach,
  definesKey,
  skyOrder,
  visible,
}: SceneryStageReliefOverviewProps) => {
  const [wanted, setWanted] = useState(false);
  const material = useMemo(
    () =>
      wanted ? createSceneryReliefFarMaterial(sky, atlas, base, looks) : null,
    // The sky's defines are compiled in: new ones need a new material. The base is set below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wanted, sky, atlas, looks, definesKey],
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

  useFrame(() => {
    const beyond = told.beyond;
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
