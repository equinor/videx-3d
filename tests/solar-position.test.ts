import { describe, expect, it } from 'vitest';
import { solarPosition } from '../src/sdk/utils/solar-position';

describe('solarPosition', () => {
  it('stands 90° minus the latitude high, due south, at the March equinox noon', () => {
    // 12:07 UTC is solar noon at Greenwich on 20 March 2024 (equation of time -7.5 min).
    const { azimuth, elevation } = solarPosition(
      new Date(Date.UTC(2024, 2, 20, 12, 7)),
      60,
      0,
    );
    expect(elevation).toBeCloseTo(30, 0);
    expect(Math.abs(azimuth - 180)).toBeLessThan(1);
  });

  it('reaches 90° minus latitude plus the tilt at the June solstice noon', () => {
    const { elevation } = solarPosition(
      new Date(Date.UTC(2024, 5, 20, 12, 2)),
      60,
      0,
    );
    expect(Math.abs(elevation - 53.44)).toBeLessThan(0.5);
  });

  it('follows the longitude: solar noon an hour earlier 15° east', () => {
    // Within the declination's own drift over that hour.
    const west = solarPosition(new Date(Date.UTC(2024, 8, 1, 12, 0)), 50, 0);
    const east = solarPosition(new Date(Date.UTC(2024, 8, 1, 11, 0)), 50, 15);
    expect(east.elevation).toBeCloseTo(west.elevation, 1);
    expect(east.azimuth).toBeCloseTo(west.azimuth, 1);
  });

  it('stands to the north at noon in the southern hemisphere, in December', () => {
    // Cape Town, 21 December: the sun is 10.5° from the zenith, on the north side.
    const { azimuth, elevation } = solarPosition(
      new Date(Date.UTC(2024, 11, 21, 10, 46)),
      -33.92,
      18.42,
    );
    expect(Math.abs(elevation - 79.5)).toBeLessThan(0.7);
    expect(Math.min(azimuth, 360 - azimuth)).toBeLessThan(5);
  });

  it('rises in the east at the equator on the equinox, and sets in the west', () => {
    const rise = solarPosition(new Date(Date.UTC(2024, 2, 20, 6, 7)), 0, 0);
    const set = solarPosition(new Date(Date.UTC(2024, 2, 20, 18, 7)), 0, 0);
    expect(Math.abs(rise.elevation)).toBeLessThan(1);
    expect(Math.abs(rise.azimuth - 90)).toBeLessThan(1);
    expect(Math.abs(set.elevation)).toBeLessThan(1);
    expect(Math.abs(set.azimuth - 270)).toBeLessThan(1);
  });

  it('is below the horizon at midnight', () => {
    const { elevation } = solarPosition(
      new Date(Date.UTC(2024, 0, 15, 0, 0)),
      58.4,
      1.9,
    );
    expect(elevation).toBeLessThan(-40);
  });
});
