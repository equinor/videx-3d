import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Mesh, Vector2, Vector3 } from 'three';
import {
  createSkyAbyssWallGeometry,
  createSkyAbyssWallMaterial,
} from './sky-abyss-walls';
import type { SkyMaterial } from './sky-material';

type SkyAbyssWallLayerProps = {
  sky: SkyMaterial;
  renderOrder: number;
  visible: boolean;
  /** its triangles drawn as lines, in one colour */
  wireframe?: boolean;
  /** shaded without the rock's relief, as the mesh faces */
  flat?: boolean;
};

/**
 * The void's walls' faces as a mesh (see `SkyAbyssWalls`): one fixed grid round their
 * outline and down from the lid, as many columns as the sky's grid has
 * (`uSkyAbyssWallGrid`), below the lid only. The background draws their fill and what lies
 * beyond them.
 */
export const SkyAbyssWallLayer = ({
  sky,
  renderOrder,
  visible,
  wireframe = false,
  flat = false,
}: SkyAbyssWallLayerProps) => {
  const geometry = useMemo(createSkyAbyssWallGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => createSkyAbyssWallMaterial(sky), [sky]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.wireframe = wireframe;
    (material.uniforms.uSkyAbyssWallDebug.value as Vector2).set(
      wireframe ? 1 : 0,
      flat ? 1 : 0,
    );
  }, [material, wireframe, flat]);
  const mesh = useRef<Mesh>(null);

  useFrame(({ camera }) => {
    const m = mesh.current;
    if (!m) return;
    const height = camera.position.dot(sky.up) - sky.abyssLevel;
    m.visible = visible && sky.abyssWallRock !== null && height < 0;
    if (!m.visible) return;
    const grid = sky.uniforms.uSkyAbyssWallGrid.value as Vector3;
    geometry.setDrawRange(0, 6 * grid.x * grid.y);
    // This frame's cut, not the last: the sky's own frame may run after this one.
    camera.updateMatrixWorld();
    sky.clipAbyssWalls(camera);
  });

  return (
    <mesh
      ref={mesh}
      name="sky:abyss-walls"
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={renderOrder}
    />
  );
};
