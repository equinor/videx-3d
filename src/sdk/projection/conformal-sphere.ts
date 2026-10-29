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
 * Where a globe's conformal sphere is matched (`Globe.conformalOrigin`): the sphere, and the
 * longitude of the disc's centre (radians). Plain numbers: it can be sent to a worker.
 *
 * @group Utils
 */
export type ConformalOrigin = {
  sphere: ConformalSphere;
  longitude0: number;
};

// An angle in (−π, π].
const wrapAngle = (angle: number) =>
  angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));

/**
 * The conformal sphere's longitude of one `delta` from the disc's centre's (radians): n Δλ
 * near it, where the sphere is conformal, but Δλ again on the far side of the Earth, so the
 * sphere closes without a seam (n Δλ would overlap itself there, by (n − 1) · 360°).
 *
 * @group Utils
 */
export function sphereLongitude(n: number, delta: number): number {
  return delta + (n - 1) * Math.sin(delta);
}

/**
 * Where `latitude` and `longitude` (WGS84, degrees) lie on the conformal sphere of `origin`,
 * from the disc's centre: its latitude there less the centre's (`out[0]`), and its
 * longitude from the centre's (`out[1]`), radians — `Globe.sphereOffset`, without a globe.
 *
 * @group Utils
 */
export function conformalOffset(
  origin: ConformalOrigin,
  latitude: number,
  longitude: number,
  out: [number, number] = [0, 0],
): [number, number] {
  const { sphere, longitude0 } = origin;
  out[0] = conformalLatitude(sphere, (latitude * Math.PI) / 180) - sphere.chi0;
  out[1] = sphereLongitude(
    sphere.n,
    wrapAngle((longitude * Math.PI) / 180 - longitude0),
  );
  return out;
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
