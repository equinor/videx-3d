import { Vector3 } from 'three';
import { Vec3 } from '../../sdk';
import { AnnotationProps } from './types';

export * from './Annotations';
export * from './annotations-renderer';
export * from './annotations-state';
export * from './AnnotationsLayer';
export * from './types';

const position = new Vector3();

export const getAnnotationPosition = (annotation: AnnotationProps): Vec3 => {
  if (annotation.matrixWorld) {
    return position
      .set(...annotation.position)
      .applyMatrix4(annotation.matrixWorld)
      .toArray();
  }
  return annotation.position;
};
