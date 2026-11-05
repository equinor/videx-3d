import { describe, expect, it } from 'vitest';
import {
  createWeatherSystemCentres,
  WEATHER_SYSTEM_COUNT,
  weatherSystemCentresAt,
  weatherSystemDrift,
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
    expect(createWeatherSystemCentres(3)).toEqual(
      createWeatherSystemCentres(3),
    );
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
    const systems = [0, 1, 2, 3].flatMap(seed =>
      createWeatherSystemCentres(seed),
    );
    const lows = systems.filter(s => s.pressure < 0);
    const highs = systems.filter(s => s.pressure > 0);
    expect(lows.length).toBeGreaterThan(systems.length * 0.3);
    expect(highs.length).toBeGreaterThan(systems.length * 0.3);
    const inBand = (min: number, max: number) => (s: { latitude: number }) =>
      Math.abs(s.latitude) >= min && Math.abs(s.latitude) <= max;
    expect(lows.filter(inBand(33, 75)).length / lows.length).toBeGreaterThan(
      0.6,
    );
    expect(highs.filter(inBand(18, 45)).length / highs.length).toBeGreaterThan(
      0.6,
    );
  });

  it('keeps them from stacking on one another', () => {
    const systems = createWeatherSystemCentres(1);
    let closest = Infinity;
    for (let i = 0; i < systems.length; i++)
      for (let j = i + 1; j < systems.length; j++) {
        const reach = systems[i].radius + systems[j].radius;
        closest = Math.min(
          closest,
          (angle(systems[i], systems[j]) * 6371) / reach,
        );
      }
    expect(closest).toBeGreaterThan(0.25);
  });
});

describe('weather systems over time', () => {
  const kmBetween = (
    a: { latitude: number; longitude: number },
    b: { latitude: number; longitude: number },
  ) => angle(a, b) * 6371;

  it('are as placed at time 0', () => {
    const placed = createWeatherSystemCentres(2);
    const now = weatherSystemCentresAt(2, 0);
    now.forEach((system, i) => {
      expect(kmBetween(system, placed[i])).toBeLessThan(30);
      expect(system.pressure).toBeCloseTo(placed[i].pressure, 6);
    });
  });

  it('are the same for the same seed and time', () => {
    expect(weatherSystemCentresAt(1, 123456)).toEqual(
      weatherSystemCentresAt(1, 123456),
    );
  });

  it('travel east in the storm tracks, west in the trades', () => {
    const before = weatherSystemCentresAt(0, 0);
    const after = weatherSystemCentresAt(0, 6 * 3600);
    const tracks = before
      .map((system, i) => ({
        latitude: Math.abs(system.latitude),
        moved: kmBetween(system, after[i]),
        east: ((after[i].longitude - system.longitude + 540) % 360) - 180,
        alive: Math.abs(after[i].pressure) >= 0.05,
      }))
      .filter(track => track.alive);
    const westerlies = tracks.filter(t => t.latitude > 38 && t.latitude < 58);
    const trades = tracks.filter(t => t.latitude < 12);
    expect(westerlies.length).toBeGreaterThan(0);
    expect(westerlies.every(t => t.east > 0)).toBe(true);
    expect(Math.min(...westerlies.map(t => t.moved))).toBeGreaterThan(150);
    expect(Math.max(...westerlies.map(t => t.moved))).toBeLessThan(400);
    expect(trades.every(t => t.east < 0)).toBe(true);
    expect(weatherSystemDrift(45)).toBeCloseTo(12);
    expect(weatherSystemDrift(0)).toBeCloseTo(-5);
  });

  it('move smoothly, and fade out before they go', () => {
    for (const t of [0, 2e5, 7e5, 3e6]) {
      const a = weatherSystemCentresAt(3, t);
      const b = weatherSystemCentresAt(3, t + 600);
      expect(b).toHaveLength(WEATHER_SYSTEM_COUNT);
      const steps = a.map((system, i) => ({
        jumped: kmBetween(system, b[i]) > 30,
        strongest: Math.max(Math.abs(system.pressure), Math.abs(b[i].pressure)),
        change: Math.abs(b[i].pressure - system.pressure),
      }));
      // A system that leaps (gives way to a new one) has faded out first.
      const leaps = steps.filter(step => step.jumped);
      expect(Math.max(0, ...leaps.map(step => step.strongest))).toBeLessThan(
        0.02,
      );
      const stays = steps.filter(step => !step.jumped);
      expect(Math.max(...stays.map(step => step.change))).toBeLessThan(0.05);
    }
  });
});
