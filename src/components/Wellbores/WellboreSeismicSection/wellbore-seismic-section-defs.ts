import { PackedBufferGeometry } from '../../../sdk';

export const wellboreSeismicSection = 'wellboreSeismicSection';

export type WellboreSeismicSectionGeneratorResponse = {
  geometry: PackedBufferGeometry;
  data: {
    array: Float32Array;
    width: number;
    height: number;
    min: number;
    max: number;
  };
};
