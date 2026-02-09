import { Vec3 } from '../types/common';

export function toFloat32Array(arrayOfVectors: Vec3[]) {
  const array = new Float32Array(arrayOfVectors.length * 3);

  for (let i = 0; i < arrayOfVectors.length; i++) {
    const j = i * 3;
    array[j + 0] = arrayOfVectors[i][0];
    array[j + 1] = arrayOfVectors[i][1];
    array[j + 2] = arrayOfVectors[i][2];
  }
  return array;
}
