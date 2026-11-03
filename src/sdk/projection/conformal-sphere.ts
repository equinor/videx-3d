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

// The isometric latitude ψ of the ellipsoid at geodetic latitude φ: atanh(sin φ) − e atanh(e sin φ),
// its first term as asinh(tan φ), which keeps its digits near a pole where 1 − sin φ cancels.
const isometric = (phi: number) =>
  Math.asinh(Math.tan(phi)) - E * Math.atanh(E * Math.sin(phi));

// The latitude whose isometric latitude on a sphere is `y`: asin(tanh y), as atan(sinh y), which
// keeps its digits near a pole (to nanometres there, where asin(tanh y) keeps 10 cm).
const fromIsometric = (y: number) => Math.atan(Math.sinh(y));

/**
 * The {@link ConformalSphere} matched at `latitude0` (radians), a pole included.
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
  // c, so the sphere's latitude scale is 1 at φ₀: (n + sin φ₀)(1 − tanh nψ₀) / ((n − sin φ₀)(1 +
  // tanh nψ₀)), that is (n + sin φ₀) / (n − sin φ₀) · e^(−2nψ₀). Toward a pole n − |sin φ₀| goes
  // to 0: as (n − 1) + (1 − |sin φ₀|), neither cancelling.
  const psi0 = isometric(latitude0);
  const near =
    (WGS84_E2 * cos0 ** 4) / ((1 - WGS84_E2) * (n + 1)) +
    (cos0 * cos0) / (1 + Math.abs(sin0));
  const far = n + Math.abs(sin0);
  // At a pole itself, should cos φ₀ come out 0: the limit, n = 1 and ½ ln c = ±e atanh e (its
  // sign the hemisphere's, as c at −φ₀ is 1 / c at φ₀).
  if (!(near > 0))
    return {
      latitude0,
      radius,
      n: 1,
      halfLogC: Math.sign(sin0) * E * Math.atanh(E),
      chi0: Math.sign(sin0) * (Math.PI / 2),
    };
  const half = 0.5 * Math.log(sin0 >= 0 ? far / near : near / far);
  return {
    latitude0,
    radius,
    n,
    halfLogC: half - n * psi0,
    chi0: fromIsometric(half),
  };
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
  return fromIsometric(sphere.halfLogC + sphere.n * isometric(latitude));
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
  // Past a pole, back over it (as sin χ would read it).
  if (chi > Math.PI / 2) chi = Math.PI - chi;
  else if (chi < -Math.PI / 2) chi = -Math.PI - chi;
  // ψ, the isometric latitude: (asinh(tan χ) − ½ ln c) / n; then φ with ψ + e atanh(e sin φ)
  // its sphere's, by fixed point (e² is small), each in the form that keeps its digits near a pole.
  const q = (Math.asinh(Math.tan(chi)) - sphere.halfLogC) / sphere.n;
  let phi = fromIsometric(q);
  for (let i = 0; i < 8; i++) {
    const next = fromIsometric(q + E * Math.atanh(E * Math.sin(phi)));
    if (Math.abs(next - phi) < 1e-16) {
      phi = next;
      break;
    }
    phi = next;
  }
  return phi;
}
