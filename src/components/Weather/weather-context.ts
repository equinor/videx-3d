import { createContext, useContext } from 'react';
import type { WeatherState } from '../../sdk/weather/weather';
import type { WeatherClock } from '../../sdk/weather/weather-clock';
import type { WeatherSea } from './weather-sea';

export const WeatherContext = createContext<WeatherState | null>(null);
export const WeatherClockContext = createContext<WeatherClock | null>(null);
export const WeatherSeaContext = createContext<WeatherSea | null>(null);

/**
 * The weather of the enclosing {@link Weather}, or `null` when there is none: what reads it
 * then keeps its own settings.
 *
 * @group Components
 */
export function useWeather() {
  return useContext(WeatherContext);
}

/**
 * The clock of the enclosing {@link Weather} (the same object for its life: read its `time`
 * each frame), or `null` when there is none: what reads it then keeps its own time.
 *
 * @group Components
 */
export function useWeatherClock() {
  return useContext(WeatherClockContext);
}

/**
 * The sea of the enclosing {@link Weather} (`WeatherSea`), or `null` when there is none: one
 * sea state for every sea under it that takes its wind and swells from the weather.
 *
 * @group Components
 */
export function useWeatherSea() {
  return useContext(WeatherSeaContext);
}
