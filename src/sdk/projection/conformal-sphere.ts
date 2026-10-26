// ⚠️ Free of three.js: tile builders read it in workers.

/** WGS84's semi-major axis, metres. */
export const WGS84_A = 6378137;
/** WGS84's first eccentricity, squared: f (2 − f), f = 1 / 298.257223563. */
export const WGS84_E2 = (2 - 1 / 298.257223563) / 298.257223563;
const E = Math.sqrt(WGS84_E2);

/**
 * The Gauss conformal sphere matched to the WGS84 ellipsoid at one latitude: a sphere the
 * ellipsoid maps onto conformally (angles kept), at scale 1 at `latitude0` and growing only
 * with the square of the distance from it. Latitudes go to its conformal latitudes χ, and
 * longitudes are scaled by `n`. The sphere oblique stereographic projections are built on
 * (EPSG 9809, proj's `sterea`). See `documents/world.md`, step 6.
 *
 * @group Utils
 */
export type ConformalSphere = {
  /** the geodetic latitude it is matched at, radians */
  latitude0: number;
  /** its radius, metres: √(ρ₀ ν₀), the ellipsoid's mean radius of curvature there */
  radius: number;
  /** how much longitudes are scaled: Λ = n λ */
  n: number;
  /** ½ ln c, of the latitudes' mapping */
  halfLogC: number;
  /** the conformal latitude of `latitude0`, radians */
  chi0: number;
};

// atanh(sin φ) − e atanh(e sin φ): the isometric latitude of the ellipsoid.
const isometric = (sinPhi: number) =>
  Math.atanh(sinPhi) - E * Math.atanh(E * sinPhi);

/**
 * The {@link ConformalSphere} matched at `latitude0` (radians).
 *
 * @group Utils
 */
export function conformalSphere(latitude0: number): ConformalSphere {
  const sin0 = Math.sin(latitude0);
  const cos0 = Math.cos(latitude0);
  const w = 1 - WGS84_E2 * sin0 * sin0;
  // ρ₀ ν₀ = a² (1 − e²) / w².
  const radius = (WGS84_A * Math.sqrt(1 - WGS84_E2)) / w;
  const n = Math.sqrt(1 + (WGS84_E2 * cos0 ** 4) / (1 - WGS84_E2));
  // sin χ₀ before c: tanh(n ψ₀), and c so the sphere's latitude scale is 1 at φ₀.
  const sinChi1 = Math.tanh(n * isometric(sin0));
  const c = ((n + sin0) * (1 - sinChi1)) / ((n - sin0) * (1 + sinChi1));
  const halfLogC = 0.5 * Math.log(c);
  const chi0 = Math.asin(Math.tanh(halfLogC + n * isometric(sin0)));
  return { latitude0, radius, n, halfLogC, chi0 };
}

/**
 * The conformal latitude χ on `sphere` of geodetic latitude `latitude` (radians).
 *
 * @group Utils
 */
export function conformalLatitude(
  sphere: ConformalSphere,
  latitude: number,
): number {
  const sinPhi = Math.max(-1 + 1e-15, Math.min(1 - 1e-15, Math.sin(latitude)));
  return Math.asin(Math.tanh(sphere.halfLogC + sphere.n * isometric(sinPhi)));
}

/**
 * The geodetic latitude (radians) of conformal latitude `chi` on `sphere`: the inverse of
 * {@link conformalLatitude}, to the last bit in a few steps.
 *
 * @group Utils
 */
export function geodeticLatitude(sphere: ConformalSphere, chi: number): number {
  const sinChi = Math.max(-1 + 1e-15, Math.min(1 - 1e-15, Math.sin(chi)));
  const q = (Math.atanh(sinChi) - sphere.halfLogC) / sphere.n;
  let sinPhi = Math.tanh(q);
  for (let i = 0; i < 8; i++) {
    const next = Math.tanh(q + E * Math.atanh(E * sinPhi));
    if (Math.abs(next - sinPhi) < 1e-16) {
      sinPhi = next;
      break;
    }
    sinPhi = next;
  }
  return Math.asin(sinPhi);
}
