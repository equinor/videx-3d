import { describe, expect, it, vi } from 'vitest';
import { WaterMaterial } from '../src/components/Water/water-material';
import { WeatherSea } from '../src/components/Weather/weather-sea';
import { WeatherClock } from '../src/sdk/weather/weather-clock';
import type { WeatherState } from '../src/sdk/weather/weather';

// A clock that stands still unless set: the tests move it.
const clockAt = (time = 0) => new WeatherClock({ time, paused: true });

const WEATHER: WeatherState = { wind: { speed: 10, from: 270 } };

describe('WeatherSea', () => {
  it("holds one sea state a quality, from the weather's wind, and none without one", () => {
    const sea = new WeatherSea(clockAt());
    sea.setWeather({});
    expect(sea.active).toBe(false);
    expect(sea.state('medium')).toBeNull();

    sea.setWeather(WEATHER);
    expect(sea.active).toBe(true);
    const medium = sea.state('medium');
    expect(medium).not.toBeNull();
    expect(sea.state('medium')).toBe(medium);
    expect(sea.state('low')).not.toBe(medium);
  });

  it('takes a new input only as the wind or swells change', () => {
    const sea = new WeatherSea(clockAt());
    sea.setWeather(WEATHER);
    const revision = sea.revision;
    // A new object with the same values, and the clouds the sea does not read.
    sea.setWeather({ ...WEATHER, clouds: [] });
    expect(sea.revision).toBe(revision);

    const calm = sea.state('medium')!.stats().targetHeight;
    sea.setWeather({
      ...WEATHER,
      swell: [{ height: 3, period: 14, from: 200 }],
    });
    expect(sea.revision).toBe(revision + 1);
    expect(sea.state('medium')!.stats().targetHeight).toBeGreaterThan(calm);
  });

  it('runs every sea state on the clock once a time, however many ask, and jumps as one', () => {
    const clock = clockAt(100);
    const sea = new WeatherSea(clock);
    sea.setWeather(WEATHER);
    const state = sea.state('medium')!;
    const update = vi.spyOn(state, 'update');

    sea.advance();
    expect(state.time).toBe(100);
    expect(update).not.toHaveBeenCalled();

    clock.setTime(100.5);
    sea.advance();
    sea.advance();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(0.5);
    expect(state.time).toBeCloseTo(100.5, 9);

    // Back, or on by hours: set there, not run.
    clock.setTime(5);
    sea.advance();
    expect(update).toHaveBeenCalledTimes(1);
    expect(state.time).toBe(5);
  });
});

describe("WaterMaterial on the weather's sea", () => {
  it("draws the weather's sea state while given one, and its own again after", () => {
    const clock = clockAt(42);
    const sea = new WeatherSea(clock);
    sea.setWeather(WEATHER);
    const a = new WaterMaterial();
    const b = new WaterMaterial();
    const own = a.seaState;

    a.sea = sea;
    b.sea = sea;
    expect(a.seaState).toBe(sea.state('medium'));
    expect(b.seaState).toBe(a.seaState);
    // One sea, so floating objects on either ride the same waves.
    a.step(0.016);
    b.step(0.016);
    // The waves on the weather's clock; the material's own time small, for the shaders.
    expect(a.seaState.time).toBe(42);
    expect(a.time).toBeCloseTo(0.016, 9);
    expect(a.seaState.heightAt(30, -70)).toBe(b.seaState.heightAt(30, -70));

    a.sea = null;
    expect(a.seaState).toBe(own);
    a.dispose();
    b.dispose();
    sea.dispose();
  });

  it('keeps its own sea state under a weather without a wind', () => {
    const sea = new WeatherSea(clockAt());
    sea.setWeather({});
    const m = new WaterMaterial();
    const own = m.seaState;
    m.sea = sea;
    expect(m.seaState).toBe(own);
    m.step(0.5);
    expect(m.time).toBeCloseTo(0.5, 9);
    m.dispose();
  });
});
