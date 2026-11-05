import { describe, expect, it } from 'vitest';
import {
  createWeatherSystemCentres,
  WEATHER_SYSTEM_COUNT,
} from '../src/sdk/weather/weather-systems';

const DEG = Math.PI / 180;
const angle = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) =>
  Math.acos(
    Math.min(
      Math.max(
        Math.sin(a.latitude * DEG) * Math.sin(b.latitude * DEG) +
          Math.cos(a.latitude * DEG) *
            Math.cos(b.latitude * DEG) *
            Math.cos((a.longitude - b.longitude) * DEG),
        -1,
      ),
      1,
    ),
  );

describe('weather system centres', () => {
  it('are the same for the same seed, and others for another', () => {
    expect(createWeatherSystemCentres(3)).toEqual(createWeatherSystemCentres(3));
    expect(createWeatherSystemCentres(4)).not.toEqual(
      createWeatherSystemCentres(3),
    );
  });

  it('places as many as asked, on the Earth', () => {
    const systems = createWeatherSystemCentres(0);
    expect(systems).toHaveLength(WEATHER_SYSTEM_COUNT);
    for (const s of systems) {
      expect(Math.abs(s.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(s.longitude)).toBeLessThanOrEqual(180);
      expect(s.radius).toBeGreaterThan(0);
    }
  });

  it('puts lows in the storm tracks and highs over the subtropics, mostly', () => {
    const systems = [0, 1, 2, 3].flatMap(seed => createWeatherSystemCentres(seed));
    const lows = systems.filter(s => s.pressure < 0);
    const highs = systems.filter(s => s.pressure > 0);
    expect(lows.length).toBeGreaterThan(systems.length * 0.3);
    expect(highs.length).toBeGreaterThan(systems.length * 0.3);
    const inBand = (min: number, max: number) => (s: { latitude: number }) =>
      Math.abs(s.latitude) >= min && Math.abs(s.latitude) <= max;
    expect(lows.filter(inBand(33, 75)).length / lows.length).toBeGreaterThan(0.6);
    expect(
      highs.filter(inBand(18, 45)).length / highs.length,
    ).toBeGreaterThan(0.6);
  });

  it('keeps them from stacking on one another', () => {
    const systems = createWeatherSystemCentres(1);
    let closest = Infinity;
    for (let i = 0; i < systems.length; i++)
      for (let j = i + 1; j < systems.length; j++) {
        const reach = systems[i].radius + systems[j].radius;
        closest = Math.min(closest, (angle(systems[i], systems[j]) * 6371) / reach);
      }
    expect(closest).toBeGreaterThan(0.25);
  });
});
