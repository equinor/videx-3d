import { describe, expect, it } from 'vitest';
import {
  WEATHER_CLOCK_STALL,
  WeatherClock,
  WeatherClockSteps,
} from '../src/sdk/weather/weather-clock';

// A wall clock the test moves by hand (milliseconds).
function wall(start = 1000) {
  const state = { now: start };
  return { state, now: () => state.now };
}

describe('WeatherClock', () => {
  it('runs from its start at its time scale', () => {
    const { state, now } = wall();
    const clock = new WeatherClock({ time: 100, timeScale: 60 }, now);
    expect(clock.time).toBe(100);
    state.now += 50;
    expect(clock.time).toBeCloseTo(103);
    state.now += 50;
    expect(clock.time).toBeCloseTo(106);
  });

  it('holds while paused and runs on after', () => {
    const { state, now } = wall();
    const clock = new WeatherClock({ paused: true }, now);
    state.now += 80;
    expect(clock.time).toBe(0);
    clock.paused = false;
    state.now += 80;
    expect(clock.time).toBeCloseTo(0.08);
  });

  it('counts a stall as a short step', () => {
    const { state, now } = wall();
    const clock = new WeatherClock({ timeScale: 3600 }, now);
    state.now += 10000;
    expect(clock.time).toBeCloseTo(WEATHER_CLOCK_STALL * 3600);
  });

  it('jumps to a set time', () => {
    const { state, now } = wall();
    const clock = new WeatherClock({}, now);
    state.now += 50;
    clock.setTime(5000);
    expect(clock.jumps).toBe(1);
    expect(clock.time).toBe(5000);
  });
});

describe('WeatherClockSteps', () => {
  it('steps by what the clock ran, not its jumps', () => {
    const { state, now } = wall();
    const clock = new WeatherClock({ timeScale: 10 }, now);
    const steps = new WeatherClockSteps();
    expect(steps.step(clock)).toBe(0);
    state.now += 50;
    expect(steps.step(clock)).toBeCloseTo(0.5);
    clock.setTime(1e9);
    expect(steps.step(clock)).toBe(0);
    state.now += 50;
    expect(steps.step(clock)).toBeCloseTo(0.5);
  });
});

describe('WeatherClockSteps with another clock', () => {
  it('starts over for another clock', () => {
    const { state, now } = wall();
    const steps = new WeatherClockSteps();
    steps.step(new WeatherClock({ time: 10 }, now));
    state.now += 50;
    expect(steps.step(new WeatherClock({ time: 5000 }, now))).toBe(0);
  });
});
