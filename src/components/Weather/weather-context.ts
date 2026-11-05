import { createContext, useContext } from 'react';
import type { WeatherState } from '../../sdk/weather/weather';

export const WeatherContext = createContext<WeatherState | null>(null);

/**
 * The weather of the enclosing {@link Weather}, or `null` when there is none: what reads it
 * then keeps its own settings.
 *
 * @group Components
 */
export function useWeather() {
  return useContext(WeatherContext);
}
