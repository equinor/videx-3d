import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  ShaderMaterial,
  Texture,
  Uniform,
  Vector2,
} from 'three';
import { createLayers, LAYERS } from '../../layers/layers';
import fragmentShader from './shaders/cube-view-fragment.glsl';
import vertexShader from './shaders/cube-view-vertex.glsl';

// Pixels per face, and from the canvas' lower right corner.
const FACE_SIZE = 80;
const MARGIN = 12;
// Drawn last by the OITRenderPass too, over its transparent layers.
const OVERLAY_LAYERS = createLayers(LAYERS.OVERLAY);

// Each face: its cell in the 4 x 3 cross, and the direction, right and up it is seen with.
const FACES: [number, number, number[], number[], number[]][] = [
  [0, 1, [-1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [1, 1, [0, 0, -1], [1, 0, 0], [0, 1, 0]],
  [2, 1, [1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [3, 1, [0, 0, 1], [-1, 0, 0], [0, 1, 0]],
  [1, 2, [0, 1, 0], [1, 0, 0], [0, 0, 1]],
  [1, 0, [0, -1, 0], [1, 0, 0], [0, 0, -1]],
];

function createCubeViewGeometry() {
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const position: number[] = [];
  const cell: number[] = [];
  const axis: number[] = [];
  const right: number[] = [];
  const up: number[] = [];
  const index: number[] = [];
  FACES.forEach(([column, row, a, r, u], f) => {
    for (const [x, y] of corners) {
      position.push(x, y, 0);
      cell.push(column, row);
      axis.push(...a);
      right.push(...r);
      up.push(...u);
    }
    const o = f * 4;
    index.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  const geometry = new BufferGeometry();
  const attribute = (values: number[], size: number) =>
    new BufferAttribute(new Float32Array(values), size);
  geometry.setAttribute('position', attribute(position, 3));
  geometry.setAttribute('cell', attribute(cell, 2));
  geometry.setAttribute('axis', attribute(axis, 3));
  geometry.setAttribute('right', attribute(right, 3));
  geometry.setAttribute('up', attribute(up, 3));
  geometry.setIndex(index);
  return geometry;
}

/**
 * A cube map's six faces as a cross in the canvas' lower right corner, over everything:
 * `+Y` over `-X -Z +X +Z`, `-Y` under. Debug only; `cube` is read every frame.
 */
export const SkyCubeView = ({ cube }: { cube: () => Texture | null }) => {
  const size = useThree(state => state.size);
  const geometry = useMemo(createCubeViewGeometry, []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uCubeViewMap: new Uniform<Texture | null>(null),
          uCubeViewCell: new Uniform(new Vector2()),
          uCubeViewOrigin: new Uniform(new Vector2()),
        },
        // In the transparent list, so the default render draws it after the water.
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useEffect(() => {
    const cellX = (2 * FACE_SIZE) / size.width;
    const cellY = (2 * FACE_SIZE) / size.height;
    material.uniforms.uCubeViewCell.value.set(cellX, cellY);
    material.uniforms.uCubeViewOrigin.value.set(
      1 - (2 * MARGIN) / size.width - 4 * cellX,
      -1 + (2 * MARGIN) / size.height,
    );
  }, [material, size]);

  useFrame(() => {
    material.uniforms.uCubeViewMap.value = cube();
  });

  return (
    <mesh
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={1e9}
      layers={OVERLAY_LAYERS}
    />
  );
};
