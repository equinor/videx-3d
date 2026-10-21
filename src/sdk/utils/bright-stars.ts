import { BRIGHT_STAR_COUNT, BRIGHT_STAR_DATA } from './bright-stars-data';

/**
 * The stars to magnitude 5 of the Yale Bright Star Catalogue, 5th revised edition
 * (Hoffleit & Warren 1991, CDS V/50), brightest first. Positions are for the J2000
 * equator and equinox (see `precessFromJ2000`), within about 20 arcseconds.
 */
export type BrightStars = {
  count: number;
  /** degrees */
  rightAscension: Float32Array;
  /** degrees */
  declination: Float32Array;
  /** visual magnitude, within 0.02 */
  magnitude: Float32Array;
  /** B-V colour index: about -0.3 for a blue-white star, 0.65 for the sun, 1.5 for a red one */
  colorIndex: Float32Array;
};

let decoded: BrightStars | null = null;

/** The {@link BrightStars}, unpacked once on first use. */
export function brightStars(): BrightStars {
  if (decoded) return decoded;
  const bytes = Uint8Array.from(atob(BRIGHT_STAR_DATA), c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const count = BRIGHT_STAR_COUNT;
  const stars: BrightStars = {
    count,
    rightAscension: new Float32Array(count),
    declination: new Float32Array(count),
    magnitude: new Float32Array(count),
    colorIndex: new Float32Array(count),
  };
  for (let i = 0; i < count; i++) {
    const at = i * 6;
    stars.rightAscension[i] = (view.getUint16(at, true) / 65536) * 360;
    stars.declination[i] = (view.getInt16(at + 2, true) / 32767) * 90;
    stars.magnitude[i] = view.getUint8(at + 4) / 30 - 2;
    stars.colorIndex[i] = view.getInt8(at + 5) / 60;
  }
  decoded = stars;
  return stars;
}
