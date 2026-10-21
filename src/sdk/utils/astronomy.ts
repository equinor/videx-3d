import type { SolarPosition } from './solar-position';

/** Where something stands on the sky, seen from a place on Earth (see {@link SolarPosition}). */
export type HorizontalPosition = SolarPosition;

/** A direction on the sky in the Earth's equatorial frame, of the date asked for. */
export type EquatorialPosition = {
  /** degrees, 0 to 360 */
  rightAscension: number;
  /** degrees north of the celestial equator */
  declination: number;
};

/** The moon as seen from a place on Earth. */
export type LunarPosition = HorizontalPosition &
  EquatorialPosition & {
    /** share of the disc lit, from 0 (new) to 1 (full) */
    illumination: number;
    /** degrees between it and the sun */
    elongation: number;
    /** from the observer, in km */
    distance: number;
  };

/** The planets seen with the naked eye. */
export type Planet = 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn';

/** The naked-eye {@link Planet}s, nearest the sun first. */
export const PLANETS: readonly Planet[] = [
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
];

/** A planet as seen from a place on Earth. */
export type PlanetPosition = HorizontalPosition &
  EquatorialPosition & {
    /** apparent visual magnitude: the lower, the brighter (Venus reaches about -4.6) */
    magnitude: number;
    /** degrees between it and the sun */
    elongation: number;
  };

type Vec3 = [number, number, number];

const RAD = Math.PI / 180;
const J2000 = 2451545;
const EARTH_RADIUS_KM = 6378.14;
const AU_KM = 149597870.7;
// General precession in longitude, degrees per Julian century.
const PRECESSION = 1.39697128;

const wrap360 = (degrees: number) => ((degrees % 360) + 360) % 360;
const centuries = (date: Date) => (julianDay(date) - J2000) / 36525;
// Obliquity of the ecliptic, degrees, `t` centuries from J2000.
const obliquity = (t: number) => 23.439291 - 0.0130042 * t;

/** The Julian day of a moment (UTC taken as the dynamical time: a minute off at most). */
export function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * The local mean sidereal time at `longitude` (degrees, east positive): the right
 * ascension on the meridian, in degrees.
 */
export function localSiderealTime(date: Date, longitude = 0): number {
  const d = julianDay(date) - J2000;
  const t = d / 36525;
  return wrap360(
    280.46061837 +
      360.98564736629 * d +
      0.000387933 * t * t -
      (t * t * t) / 38710000 +
      longitude,
  );
}

/**
 * Where a direction given by its `rightAscension` and `declination` (degrees, of the
 * date) stands on the sky at `siderealTime` (see {@link localSiderealTime}), seen from
 * `latitude`. Without refraction.
 */
export function equatorialToHorizontal(
  rightAscension: number,
  declination: number,
  siderealTime: number,
  latitude: number,
): HorizontalPosition {
  const h = (siderealTime - rightAscension) * RAD;
  const dec = declination * RAD;
  const lat = latitude * RAD;
  const sinEl =
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h);
  const azimuth = Math.atan2(
    -Math.cos(dec) * Math.sin(h),
    Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(h),
  );
  return {
    azimuth: wrap360(azimuth / RAD),
    elevation: Math.asin(Math.min(Math.max(sinEl, -1), 1)) / RAD,
  };
}

/**
 * A direction given for the equator and equinox of J2000 (star catalogues, degrees),
 * carried to those of `date`: the precession of the equinoxes, about 1.4° a century.
 */
export function precessFromJ2000(
  rightAscension: number,
  declination: number,
  date: Date,
): EquatorialPosition {
  const t = centuries(date);
  const eps0 = obliquity(0) * RAD;
  const ra = rightAscension * RAD;
  const dec = declination * RAD;
  const x = Math.cos(dec) * Math.cos(ra);
  const y = Math.cos(dec) * Math.sin(ra);
  const z = Math.sin(dec);
  // To the J2000 ecliptic, where the equinox only slides along it.
  const ecliptic: Vec3 = [
    x,
    Math.cos(eps0) * y + Math.sin(eps0) * z,
    -Math.sin(eps0) * y + Math.cos(eps0) * z,
  ];
  return toEquatorial(rotateZ(ecliptic, PRECESSION * t), t);
}

/**
 * The moon's geocentric ecliptic position of the date: the Astronomical Almanac's low
 * precision series, within about 0.3° in longitude, 0.2° in latitude.
 */
export function lunarEcliptic(date: Date): {
  /** degrees */
  longitude: number;
  /** degrees */
  latitude: number;
  /** from the Earth's centre, in km */
  distance: number;
} {
  const t = centuries(date);
  const s = (a: number, b: number) => Math.sin((a + b * t) * RAD);
  const c = (a: number, b: number) => Math.cos((a + b * t) * RAD);
  const longitude =
    218.32 +
    481267.881 * t +
    6.29 * s(135.0, 477198.87) -
    1.27 * s(259.3, -413335.36) +
    0.66 * s(235.7, 890534.22) +
    0.21 * s(269.9, 954397.74) -
    0.19 * s(357.5, 35999.05) -
    0.11 * s(186.5, 966404.03);
  const latitude =
    5.13 * s(93.3, 483202.02) +
    0.28 * s(228.2, 960400.89) -
    0.28 * s(318.3, 6003.15) -
    0.17 * s(217.6, -407332.21);
  const parallax =
    0.9508 +
    0.0518 * c(135.0, 477198.87) +
    0.0095 * c(259.3, -413335.36) +
    0.0078 * c(235.7, 890534.22) +
    0.0028 * c(269.9, 954397.74);
  return {
    longitude: wrap360(longitude),
    latitude,
    distance: EARTH_RADIUS_KM / Math.sin(parallax * RAD),
  };
}

/**
 * The moon at `date`, seen from `latitude` and `longitude` (degrees, north and east
 * positive): where it stands — from the observer, not the Earth's centre, which
 * moves it by up to a degree — and how much of it is lit.
 */
export function lunarPosition(
  date: Date,
  latitude: number,
  longitude: number,
): LunarPosition {
  const t = centuries(date);
  const moon = lunarEcliptic(date);
  const r = moon.distance / EARTH_RADIUS_KM;
  const ecliptic = scale(
    unitVector(moon.longitude * RAD, moon.latitude * RAD),
    r,
  );
  const geocentric = toEquatorialVector(ecliptic, t);

  const lst = localSiderealTime(date, longitude) * RAD;
  const lat = latitude * RAD;
  const topocentric: Vec3 = [
    geocentric[0] - Math.cos(lat) * Math.cos(lst),
    geocentric[1] - Math.cos(lat) * Math.sin(lst),
    geocentric[2] - Math.sin(lat),
  ];
  const { rightAscension, declination, length } = toAngles(topocentric);

  // The sun as the Earth sees it: opposite the Earth from the sun.
  const sun = rotateZ(scale(heliocentric(EARTH, t), -1), PRECESSION * t);
  const sunDistance = Math.hypot(...sun) * AU_KM;
  const cosElongation = dot(normalize(ecliptic), normalize(sun));
  const elongation = Math.acos(clamp(cosElongation)) / RAD;
  const phaseAngle = Math.atan2(
    sunDistance * Math.sin(elongation * RAD),
    moon.distance - sunDistance * cosElongation,
  );

  return {
    ...equatorialToHorizontal(rightAscension, declination, lst / RAD, latitude),
    rightAscension,
    declination,
    illumination: (1 + Math.cos(phaseAngle)) / 2,
    elongation,
    distance: length * EARTH_RADIUS_KM,
  };
}

/**
 * A naked-eye planet at `date`, seen from `latitude` and `longitude` (degrees, north
 * and east positive): where it stands, within a fraction of a degree, and how bright it
 * is. From JPL's Keplerian elements for 1800–2050 (Standish & Williams); further out,
 * it drifts.
 */
export function planetPosition(
  planet: Planet,
  date: Date,
  latitude: number,
  longitude: number,
): PlanetPosition {
  const t = centuries(date);
  const body = heliocentric(ELEMENTS[planet], t);
  const earth = heliocentric(EARTH, t);
  const geocentric: Vec3 = [
    body[0] - earth[0],
    body[1] - earth[1],
    body[2] - earth[2],
  ];
  const r = Math.hypot(...body);
  const delta = Math.hypot(...geocentric);
  const sunDistance = Math.hypot(...earth);
  const phaseAngle =
    Math.acos(
      clamp(
        (r * r + delta * delta - sunDistance * sunDistance) / (2 * r * delta),
      ),
    ) / RAD;
  const elongation =
    Math.acos(
      clamp(
        (sunDistance * sunDistance + delta * delta - r * r) /
          (2 * sunDistance * delta),
      ),
    ) / RAD;

  const { rightAscension, declination } = toAngles(
    toEquatorialVector(rotateZ(geocentric, PRECESSION * t), t),
  );
  return {
    ...equatorialToHorizontal(
      rightAscension,
      declination,
      localSiderealTime(date, longitude),
      latitude,
    ),
    rightAscension,
    declination,
    magnitude: MAGNITUDE[planet](5 * Math.log10(r * delta), phaseAngle),
    elongation,
  };
}

// a (au), e, I, L, long. perihelion, long. node (degrees), then their rates per
// century: JPL "Approximate Positions of the Planets", Table 1 (1800-2050).
type Elements = readonly number[];
const ELEMENTS: Record<Planet, Elements> = {
  mercury: [
    0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593,
    0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689,
    -0.12534081,
  ],
  venus: [
    0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255,
    0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418,
  ],
  mars: [
    1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
    0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088,
    -0.29257343,
  ],
  jupiter: [
    5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
    -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668,
    0.20469106,
  ],
  saturn: [
    9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
    -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216,
    -0.28867794,
  ],
};
// The Earth-Moon barycentre stands in for the Earth.
const EARTH: Elements = [
  1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0,
  0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0,
];

// Visual magnitude from 5 log10(r Δ) and the phase angle i (degrees): the
// Explanatory Supplement's (1992); Saturn's rings left out (up to half a magnitude).
const MAGNITUDE: Record<Planet, (distance: number, i: number) => number> = {
  mercury: (d, i) =>
    -0.42 + d + 0.038 * i - 0.000273 * i * i + 0.000002 * i * i * i,
  venus: (d, i) =>
    -4.4 + d + 0.0009 * i + 0.000239 * i * i - 0.00000065 * i * i * i,
  mars: (d, i) => -1.52 + d + 0.016 * i,
  jupiter: (d, i) => -9.4 + d + 0.005 * i,
  saturn: d => -8.88 + d,
};

// Heliocentric position on the J2000 ecliptic, in au.
function heliocentric(elements: Elements, t: number): Vec3 {
  const [a, e, inc, l, peri, node] = elements
    .slice(0, 6)
    .map((value, k) => value + elements[k + 6] * t);
  const omega = (peri - node) * RAD;
  const m = wrap360(l - peri + 180) - 180;
  const eccentric = solveKepler(m, e) * RAD;
  const x = a * (Math.cos(eccentric) - e);
  const y = a * Math.sqrt(1 - e * e) * Math.sin(eccentric);
  const cw = Math.cos(omega);
  const sw = Math.sin(omega);
  const cn = Math.cos(node * RAD);
  const sn = Math.sin(node * RAD);
  const ci = Math.cos(inc * RAD);
  const si = Math.sin(inc * RAD);
  return [
    (cw * cn - sw * sn * ci) * x + (-sw * cn - cw * sn * ci) * y,
    (cw * sn + sw * cn * ci) * x + (-sw * sn + cw * cn * ci) * y,
    sw * si * x + cw * si * y,
  ];
}

// Eccentric anomaly (degrees) from the mean anomaly (degrees), JPL's iteration.
function solveKepler(m: number, e: number): number {
  const eDeg = e / RAD;
  let eccentric = m + eDeg * Math.sin(m * RAD);
  for (let k = 0; k < 20; k++) {
    const dm = m - (eccentric - eDeg * Math.sin(eccentric * RAD));
    const de = dm / (1 - e * Math.cos(eccentric * RAD));
    eccentric += de;
    if (Math.abs(de) <= 1e-7) break;
  }
  return eccentric;
}

// Ecliptic of the date -> equatorial of the date.
function toEquatorialVector(v: Vec3, t: number): Vec3 {
  const eps = obliquity(t) * RAD;
  return [
    v[0],
    Math.cos(eps) * v[1] - Math.sin(eps) * v[2],
    Math.sin(eps) * v[1] + Math.cos(eps) * v[2],
  ];
}

function toEquatorial(v: Vec3, t: number): EquatorialPosition {
  const { rightAscension, declination } = toAngles(toEquatorialVector(v, t));
  return { rightAscension, declination };
}

function toAngles(v: Vec3) {
  const length = Math.hypot(...v);
  return {
    rightAscension: wrap360(Math.atan2(v[1], v[0]) / RAD),
    declination: Math.asin(clamp(v[2] / length)) / RAD,
    length,
  };
}

function rotateZ(v: Vec3, degrees: number): Vec3 {
  const c = Math.cos(degrees * RAD);
  const s = Math.sin(degrees * RAD);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

const unitVector = (lon: number, lat: number): Vec3 => [
  Math.cos(lat) * Math.cos(lon),
  Math.cos(lat) * Math.sin(lon),
  Math.sin(lat),
];
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const normalize = (v: Vec3) => scale(v, 1 / Math.hypot(...v));
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (x: number) => Math.min(Math.max(x, -1), 1);
