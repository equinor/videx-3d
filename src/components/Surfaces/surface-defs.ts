import { PackedBufferGeometry } from '../../sdk';

export const surfaceGeometry = 'surfaceGeometry';
export const surfaceTextures = 'surfaceTextures';

export type SurfaceGeometryResponse = PackedBufferGeometry;
export type SurfaceTexturesResponse = {
  elevationImageBuffer: Float32Array;
};
