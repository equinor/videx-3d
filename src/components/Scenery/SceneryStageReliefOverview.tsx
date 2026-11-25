import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Mesh, Texture } from 'three';
import {
  precompile,
  PRECOMPILE_PRIORITY,
  releaseMaterial,
  type PrecompileOptions,
} from '../../rendering/precompile';
import { createSceneryReliefFarMaterial } from './scenery-relief';
import type { SceneryReliefAtlas } from './scenery-relief-atlas';
import { SCENERY_RELIEF_OVERVIEW_ORDER } from './scenery-layers';
import {
  createSceneryGeometry,
  type SceneryMaterial,
} from './scenery-material';

/** What the tiles tell the overview each frame (see `SceneryStageReliefTiles`). */
export type SceneryReliefOverviewState = {
  /** the farthest ground in view lies past the tiles' reach: the overview is wanted */
  beyond: boolean;
  /** the deepest ground in view (the tiles drawn and the overview's), metres over the sea: the overview hands over where the view meets it past the tiles' reach */
  lowest: number;
  /** the nearest it hands over, as a share of the tiles' reach along the sea: where its tiles start at the nearest */
  handover: number;
};

type SceneryStageReliefOverviewProps = {
  scenery: SceneryMaterial;
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
  /** what it compiles with from the sky, as a key (`ScenerySeaState.definesKey`): a new one needs a new material */
  definesKey?: string;
  /** the sky's `renderOrder`: the overview draws before its background (`SCENERY_RELIEF_OVERVIEW_ORDER`) */
  sceneryOrder: number;
  visible: boolean;
  /** a count's tracker (`createPrecompileCount`'s `track`): its compile is reported through it */
  trackCompile?: () => NonNullable<PrecompileOptions['onProgress']>;
};

/**
 * The overview behind the relief drawn from tiles: past the tiles' reach, while the
 * farthest ground in view lies farther, a fullscreen layer draws the land flat on the
 * globe's sea, from the relief's own tiles — chosen for it by the tiles' frame loop, coarser
 * than theirs, and read per pixel through `atlas` — looked as the tiles look them, wherever
 * on the Earth. However many layers, and however large, only the tiles in view are read. Its
 * material is made once it is shown (`visible`: the relief drawn, under a sky drawn), and
 * compiled in the background after the sky's own programs, so it is ready before the far
 * ground first comes into view: made then, its program took some 6 s, the Earth past the
 * tiles bare sea meanwhile (2026-11-25). Nothing while the sky's background is off.
 */
export const SceneryStageReliefOverview = ({
  scenery,
  atlas,
  told,
  base,
  looks,
  reach,
  definesKey,
  sceneryOrder,
  visible,
  trackCompile,
}: SceneryStageReliefOverviewProps) => {
  const [wanted, setWanted] = useState(false);
  const gl = useThree(state => state.gl);
  const material = useMemo(
    () =>
      wanted
        ? createSceneryReliefFarMaterial(scenery, atlas, base, looks)
        : null,
    // The sky's defines are compiled in: new ones need a new material. The base is set below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wanted, scenery, atlas, looks, definesKey],
  );
  // Let go once its program has linked (`releaseMaterial`).
  useEffect(
    () => () => {
      if (material) releaseMaterial(gl, material);
    },
    [gl, material],
  );
  useEffect(() => {
    if (material) material.uniforms.uReliefReach.value = reach;
  }, [material, reach]);
  useEffect(() => {
    if (material) material.uniforms.uReliefBase.value = base;
  }, [material, base]);
  const geometry = useMemo(() => createSceneryGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Compiled in the background, after the sky's own programs, and shown once compiled: made
  // late, it would otherwise stall the frame that first draws it.
  const mesh = useRef<Mesh>(null);
  const [compiled, setCompiled] = useState<object | null>(null);
  const scene = useThree(state => state.scene);
  const sceneCamera = useThree(state => state.camera);
  // Read when its compile is asked for: a new tracker asks for none.
  const trackRef = useRef(trackCompile);
  useLayoutEffect(() => {
    trackRef.current = trackCompile;
  });
  useLayoutEffect(() => {
    if (!material || !mesh.current) return;
    let current = true;
    const pending = precompile(gl, mesh.current, sceneCamera, scene, 'scene', {
      priority: PRECOMPILE_PRIORITY.later,
      onProgress: trackRef.current?.(),
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
    // Made once shown, before it is wanted: compiled by the time the far ground is in view.
    if (visible && !wanted) setWanted(true);
    if (material) {
      material.uniforms.uReliefLowest.value = told.lowest;
      material.uniforms.uReliefHandoverMin.value = told.handover;
    }
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
      renderOrder={sceneryOrder + SCENERY_RELIEF_OVERVIEW_ORDER}
      visible={false}
      onBeforeRender={scenery.onBeforeDraw}
    />
  );
};
