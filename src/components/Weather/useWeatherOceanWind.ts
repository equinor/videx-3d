import { useMemo } from 'react';
import type { Vec2 } from '../../sdk/types/common';
import { windToward } from '../../sdk/weather/weather';
import { useWeather } from './weather-context';

/**
 * The wind a sea is drawn with: `windSpeed` and `windDirection` where given, the enclosing
 * `Weather`'s for what is left out (as `weatherOceanWind`, in the default compass frame:
 * world X/Z, or a `Scenery`'s wave plane, east and south). The direction is kept from render
 * to render while the weather's bearing holds.
 */
export function useWeatherOceanWind(
  windSpeed: number | undefined,
  windDirection: Vec2 | undefined,
): { windSpeed?: number; windDirection?: Vec2 } {
  const wind = useWeather()?.wind;
  const from = wind?.from;
  const toward = useMemo(
    () => (from === undefined ? undefined : windToward({ speed: 0, from })),
    [from],
  );
  return {
    windSpeed: windSpeed ?? wind?.speed,
    windDirection: windDirection ?? toward,
  };
}
