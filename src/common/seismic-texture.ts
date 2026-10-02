import {
  DataTexture,
  FloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
} from 'three';

/**
 * A mipmapped single-channel texture of seismic values, divided by `amplitude` so they fit
 * half-float storage.
 *
 * ⭐ Mipmapped because a trace swings sign every few samples: without it a distant view picks one
 * sample per pixel and shimmers. Stored as R16F because WebGL2 can always filter half floats,
 * which mipmapping needs, while 32-bit float filtering is an extension.
 *
 * @param values row-major, `width * height` of them; copied, not modified
 * @param amplitude what to divide by — normally the largest absolute value, so they span -1..1
 */
export function createSeismicTexture(
  values: ArrayLike<number>,
  width: number,
  height: number,
  amplitude: number,
): DataTexture {
  const scale = amplitude > 0 ? 1 / amplitude : 1;
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = values[i] * scale;
  const texture = new DataTexture(data, width, height, RedFormat, FloatType);
  // Uploaded as 32-bit floats and converted by the driver.
  texture.internalFormat = 'R16F';
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
