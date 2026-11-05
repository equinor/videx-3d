import { useCallback, useState } from 'react';
import { WeatherClockSteps } from '../../sdk/weather/weather-clock';
import { useWeatherClock } from './weather-context';

/**
 * Each frame's step of time for what keeps its own (the waves): the seconds the enclosing
 * `Weather`'s clock has run since the last call (its pace and pauses, not its jumps:
 * `WeatherClockSteps`), or the frame's own `delta` without a `Weather`. Call it once a frame.
 */
export function useWeatherStep(): (delta: number) => number {
  const clock = useWeatherClock();
  // One counter for the life of what calls it: a new clock is a jump (WeatherClockSteps).
  const [steps] = useState(() => new WeatherClockSteps());
  return useCallback(
    (delta: number) => (clock ? steps.step(clock) : delta),
    [clock, steps],
  );
}
