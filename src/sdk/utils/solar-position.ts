/** Where the sun stands, seen from a place on Earth. */
export type SolarPosition = {
  /** compass bearing in degrees: 0 north, 90 east */
  azimuth: number;
  /** degrees above the horizon; negative below it */
  elevation: number;
};

const RAD = Math.PI / 180;

/**
 * The sun's position at `date`, seen from `latitude` and `longitude` (degrees, north
 * and east positive). NOAA's general solar position approximation: within about half a
 * degree, without atmospheric refraction.
 */
export function solarPosition(
  date: Date,
  latitude: number,
  longitude: number,
): SolarPosition {
  const year = date.getUTCFullYear();
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const dayOfYear =
    (Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) -
      Date.UTC(year, 0, 1)) /
      86400000 +
    1;
  const minutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60000;

  // The fractional year, in radians.
  const g =
    ((2 * Math.PI) / (leap ? 366 : 365)) *
    (dayOfYear - 1 + (minutes / 60 - 12) / 24);
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const declination =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);

  const solarMinutes = minutes + equationOfTime + 4 * longitude;
  const hourAngle = (solarMinutes / 4 - 180) * RAD;
  const lat = latitude * RAD;

  const cosZenith =
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = 90 - Math.acos(Math.min(Math.max(cosZenith, -1), 1)) / RAD;
  const azimuth =
    Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(lat) -
        Math.tan(declination) * Math.cos(lat),
    ) /
      RAD +
    180;

  return { azimuth: ((azimuth % 360) + 360) % 360, elevation };
}
