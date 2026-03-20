import { BufferAttribute, BufferGeometry } from 'three';
import { Vec2 } from '../types/common';
import { simplifyCurve2D } from '../utils/trajectory';
import { distanceVec2 } from '../utils/vector-operations';

export function createFenceGeometry(positions: Vec2[], y0: number, y1: number) {
  const simplifiedPositions = simplifyCurve2D(positions);

  const lengths = new Array(simplifiedPositions.length);

  let prev: number | null = null;

  for (let i = 0; i < simplifiedPositions.length; i++) {
    if (prev !== null) {
      lengths[i] =
        lengths[prev] +
        distanceVec2(simplifiedPositions[prev], simplifiedPositions[i]);
    } else {
      lengths[i] = 0;
    }
    prev = i;
  }

  const totalLength = lengths[lengths.length - 1];

  const geometry = new BufferGeometry();
  const positionArray = new Float32Array(simplifiedPositions.length * 2 * 3);
  const indexArray = new Uint32Array((simplifiedPositions.length - 1) * 6);
  const uvArray = new Float32Array(simplifiedPositions.length * 2 * 2);

  for (let i = 0; i < simplifiedPositions.length; i++) {
    // vertices
    const j = i * 6;
    positionArray[j] = simplifiedPositions[i][0];
    positionArray[j + 1] = y0;
    positionArray[j + 2] = simplifiedPositions[i][1];
    positionArray[j + 3] = simplifiedPositions[i][0];
    positionArray[j + 4] = y1;
    positionArray[j + 5] = simplifiedPositions[i][1];

    // uvs
    const k = i * 4;
    uvArray[k] = lengths[i] / totalLength;
    uvArray[k + 1] = 1;

    uvArray[k + 2] = lengths[i] / totalLength;
    uvArray[k + 3] = 0;

    // indices
    const l = i * 2;
    if (i < simplifiedPositions.length - 1) {
      indexArray[j] = l;
      indexArray[j + 1] = l + 1;
      indexArray[j + 2] = l + 2;

      indexArray[j + 3] = l + 2;
      indexArray[j + 4] = l + 1;
      indexArray[j + 5] = l + 3;
    }
  }

  geometry.setAttribute('position', new BufferAttribute(positionArray, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvArray, 2));
  geometry.setIndex(new BufferAttribute(indexArray, 1));

  geometry.computeVertexNormals();

  return geometry;
}
