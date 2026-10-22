const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/**
 * The bits of the IEEE half float nearest `value`, for a `HalfFloatType` texture filled
 * off the main thread. Beyond the half's range (±65504) it is infinite; NaN stays NaN.
 *
 * @group Utils
 */
export function toHalfFloatBits(value: number): number {
  f32[0] = value;
  const bits = u32[0];
  const sign = (bits >>> 16) & 0x8000;
  const exponent = ((bits >>> 23) & 0xff) - 112;
  const mantissa = bits & 0x7fffff;
  if (exponent >= 31) {
    return value !== value ? sign | 0x7e00 : sign | 0x7c00;
  }
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    return sign | ((((mantissa | 0x800000) >>> (1 - exponent)) + 0x1000) >>> 13);
  }
  // A rounding carry out of the mantissa steps the exponent, which is right.
  return sign | ((exponent << 10) + ((mantissa + 0x1000) >>> 13));
}
