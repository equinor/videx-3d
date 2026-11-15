import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import type { WeatherState } from '../../sdk/weather/weather';
import { WeatherClock } from '../../sdk/weather/weather-clock';
import {
  WeatherClockContext,
  WeatherContext,
  WeatherSeaContext,
} from './weather-context';
import { WeatherSea } from './weather-sea';

/**
 * Weather props
 * @expand
 */
export type WeatherProps = {
  /**
   * the wind, the swells, the air and the cloud: local, its layers about one place, or global,
   * the weather systems (see {@link WeatherState}); `weatherPresetOf` makes a local one from a
   * sky's name, `weatherPreset` from a report's words. Kept as given: a new object is a new
   * weather
   */
  weather: WeatherState;
  /**
   * the weather's time, in seconds (any origin): where it moves its clouds and weather systems
   * to. Set, the clock jumps there and runs on from it; a new value is a new jump. Default: it
   * starts at 0
   */
  time?: number;
  /** weather seconds a second: 3600 runs an hour a second (the waves too). Default 1 */
  timeScale?: number;
  /** hold the weather where it is: the clouds and the waves stop. Default false */
  paused?: boolean;
  children?: ReactNode;
};

/**
 * The weather for everything inside it: the wind and swells raise the waves of an `Ocean`, a
 * `SceneryOcean` and a `ChunkStack`'s water — one sea for all of them that take both from it
 * (`WeatherSea`, `useWeatherSea`) — its air is a `Scenery`'s, its cloud (a local weather's
 * layers, a global one's weather systems) is what a `SceneryClouds`
 * draws, and its clock (`WeatherClock`, `useWeatherClock`) moves both: the clouds drift with
 * the wind and change, the weather systems travel, and the waves run at its pace. Each still
 * takes its own props first: the weather fills in only what they leave out. It draws nothing,
 * and needs no `Scenery`.
 *
 * @example
 * <Weather weather={weatherPreset('scattered', 'cumulus', { speed: 10, from: 240 })}>
 *   <Scenery>
 *     <SceneryOcean />
 *     <SceneryClouds />
 *   </Scenery>
 * </Weather>
 *
 * @group Components
 */
export const Weather = ({
  weather,
  time,
  timeScale = 1,
  paused = false,
  children,
}: WeatherProps) => {
  const [clock] = useState(() => new WeatherClock({ time, timeScale, paused }));
  const [sea] = useState(() => new WeatherSea(clock));
  // In render, before the seas under it read it in their layout effects (which run before
  // this component's): idempotent, it changes only with the wind and swells.
  sea.setWeather(weather);
  useEffect(() => () => sea.dispose(), [sea]);
  useLayoutEffect(() => {
    // Read once at the old pace, so a new pace starts from now.
    void clock.time;
    clock.timeScale = timeScale;
    clock.paused = paused;
  }, [clock, timeScale, paused]);
  useLayoutEffect(() => {
    if (time !== undefined) clock.setTime(time);
  }, [clock, time]);
  return (
    <WeatherClockContext.Provider value={clock}>
      <WeatherContext.Provider value={weather}>
        <WeatherSeaContext.Provider value={sea}>
          {children}
        </WeatherSeaContext.Provider>
      </WeatherContext.Provider>
    </WeatherClockContext.Provider>
  );
};
