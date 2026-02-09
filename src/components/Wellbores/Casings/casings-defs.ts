import { PackedBufferGeometry } from '../../../sdk';

export const casings = 'casings';

export type CasingsGeneratorResponse = { geometry: PackedBufferGeometry };

export const casingsMaterialIndices: Record<string, number> = {
  Shoe: 0,
  Casing: 1,
  Generic: 2,
};
