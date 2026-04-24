import { Vec3 } from '../../../sdk';

export const casings = 'casings';

export type CasingSectionType = {
  type: string;
  radius: number;
  innerRadius: number;
  top: number;
  bottom: number;
  length: number;
  attributesBuffer: Float32Array;
  segments: number;
  boundingSphere: {
    center: Vec3;
    radius: number;
  };
};

export type CasingsGeneratorResponse = CasingSectionType[];
