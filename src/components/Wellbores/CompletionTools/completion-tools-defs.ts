import { PackedBufferGeometry } from '../../../sdk';

export const completionTools = 'completionTools';

export type CompletionToolsGeneratorResponse = PackedBufferGeometry;

export const completionToolsMaterialIndices: Record<string, number> = {
  'blank pipe': 0,
  tube: 1,
  packer: 2,
  gauge: 3,
  plug: 4,
  pbr: 5,
  'safety valve': 6,
  spm: 7,
  screen: 8,
  tracer: 9,
  unknown: 10,
};
