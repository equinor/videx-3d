import { describe, expect, it } from 'vitest';
import {
  equatorialToHorizontal,
  localSiderealTime,
  lunarEcliptic,
  lunarPosition,
  planetPosition,
  precessFromJ2000,
} from '../src/sdk/utils/astronomy';

const utc = (iso: string) => new Date(iso);
// Smallest difference between two angles, in degrees.
const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('localSiderealTime', () => {
  it('is 280.46° at Greenwich at J2000.0', () => {
    expect(localSiderealTime(utc('2000-01-01T12:00:00Z'))).toBeCloseTo(
      280.46061837,
      6,
    );
  });

  it("matches Meeus' example 12.a: 13h10m46.3668s on 1987-04-10 at 0h UT", () => {
    const expected = (13 + 10 / 60 + 46.3668 / 3600) * 15;
    expect(
      angle(localSiderealTime(utc('1987-04-10T00:00:00Z')), expected),
    ).toBeLessThan(0.0005);
  });

  it('runs 15° ahead per 15° of longitude east', () => {
    const date = utc('2024-09-10T20:00:00Z');
    expect(
      angle(localSiderealTime(date, 15), localSiderealTime(date) + 15),
    ).toBeLessThan(1e-9);
  });
});

describe('equatorialToHorizontal', () => {
  it("matches Meeus' example 13.b: Venus over Washington, 1987-04-10 19:21 UT", () => {
    const longitude = -(77 + 3 / 60 + 56 / 3600);
    const latitude = 38 + 55 / 60 + 17 / 3600;
    const { azimuth, elevation } = equatorialToHorizontal(
      347.3193375,
      -6.719892,
      localSiderealTime(utc('1987-04-10T19:21:00Z'), longitude),
      latitude,
    );
    expect(Math.abs(elevation - 15.1249)).toBeLessThan(0.01);
    // Meeus counts azimuth from the south: 68.0337° west of south.
    expect(angle(azimuth, 68.0337 + 180)).toBeLessThan(0.01);
  });

  it('puts Polaris about as high as the latitude, due north', () => {
    const date = utc('2024-09-10T20:00:00Z');
    const { rightAscension, declination } = precessFromJ2000(
      37.9546,
      89.2641,
      date,
    );
    for (const latitude of [30, 58.4, 70]) {
      const { azimuth, elevation } = equatorialToHorizontal(
        rightAscension,
        declination,
        localSiderealTime(date, 1.9),
        latitude,
      );
      expect(Math.abs(elevation - latitude)).toBeLessThan(1);
      expect(angle(azimuth, 0)).toBeLessThan(2);
    }
  });
});

describe('lunarEcliptic', () => {
  it("matches Meeus' example 47.a within the series' accuracy", () => {
    const moon = lunarEcliptic(utc('1992-04-12T00:00:00Z'));
    expect(angle(moon.longitude, 133.162655)).toBeLessThan(0.3);
    expect(Math.abs(moon.latitude - -3.229126)).toBeLessThan(0.2);
    expect(Math.abs(moon.distance - 368409.7)).toBeLessThan(2000);
  });
});

describe('lunarPosition', () => {
  it('is full, new and half lit at the 2024 dates', () => {
    const lit = (iso: string) =>
      lunarPosition(utc(iso), 58.4, 1.9).illumination;
    expect(lit('2024-09-18T02:34:00Z')).toBeGreaterThan(0.99);
    expect(lit('2024-10-02T18:49:00Z')).toBeLessThan(0.01);
    expect(Math.abs(lit('2024-10-10T18:55:00Z') - 0.5)).toBeLessThan(0.03);
  });

  it("is lower seen from the surface than from the Earth's centre, by its parallax", () => {
    // Over the equator, the moon near the meridian: the topocentric shift is mostly in
    // declination, up to about a degree.
    const date = utc('2024-09-18T02:34:00Z');
    const geocentric = lunarEcliptic(date);
    const seen = lunarPosition(date, 0, 0);
    expect(seen.distance).toBeLessThan(geocentric.distance);
    expect(seen.distance).toBeGreaterThan(geocentric.distance - 6400);
  });
});

describe('planetPosition', () => {
  it("matches Meeus' example 33.a: Venus on 1992-12-20", () => {
    const venus = planetPosition('venus', utc('1992-12-20T00:00:00Z'), 0, 0);
    expect(angle(venus.rightAscension, 316.172725)).toBeLessThan(0.1);
    expect(Math.abs(venus.declination - -18.888011)).toBeLessThan(0.1);
  });

  it('puts Venus and Mercury at their greatest elongations', () => {
    const venus = planetPosition('venus', utc('2025-01-10T00:00:00Z'), 0, 0);
    expect(Math.abs(venus.elongation - 47.2)).toBeLessThan(0.3);
    expect(venus.magnitude).toBeGreaterThan(-4.8);
    expect(venus.magnitude).toBeLessThan(-4.1);
    const mercury = planetPosition(
      'mercury',
      utc('2025-03-08T00:00:00Z'),
      0,
      0,
    );
    expect(Math.abs(mercury.elongation - 18.2)).toBeLessThan(0.5);
  });

  it('puts Mars, Jupiter and Saturn opposite the sun at their oppositions', () => {
    const mars = planetPosition('mars', utc('2025-01-16T00:00:00Z'), 0, 0);
    const jupiter = planetPosition(
      'jupiter',
      utc('2024-12-07T00:00:00Z'),
      0,
      0,
    );
    const saturn = planetPosition('saturn', utc('2024-09-08T00:00:00Z'), 0, 0);
    expect(mars.elongation).toBeGreaterThan(175);
    expect(jupiter.elongation).toBeGreaterThan(178);
    expect(saturn.elongation).toBeGreaterThan(175);
    expect(Math.abs(mars.magnitude - -1.4)).toBeLessThan(0.3);
    expect(Math.abs(jupiter.magnitude - -2.8)).toBeLessThan(0.2);
  });
});
