import { Vector3 } from 'three';
import { Vec3 } from '../../sdk';
import { AnnotationProps } from './types';

export * from '../../rendering/passes/AnnotationsPass';
export * from './Annotations';
export * from './annotations-state';
export * from './AnnotationsLayer';
export * from './types';

const position = new Vector3();

export const getAnnotationPosition = (
  annotation: AnnotationProps,
  target?: Vec3,
): Vec3 => {
  if (annotation.matrixWorld) {
    position.set(...annotation.position).applyMatrix4(annotation.matrixWorld);
    if (target) {
      target[0] = position.x;
      target[1] = position.y;
      target[2] = position.z;
      return target;
    }
    return position.toArray();
  }
  return annotation.position;
};
