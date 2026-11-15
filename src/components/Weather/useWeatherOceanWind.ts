import { useMemo } from 'react';
import type { Vec2 } from '../../sdk/types/common';
import type { SeaSwell } from '../../sdk/weather/sea-spectrum';
import { weatherSeaSwells, windToward } from '../../sdk/weather/weather';
import type { WeatherGusts } from '../../sdk/weather/wind-field';
import { useWeather } from './weather-context';

/**
 * The wind a sea is drawn with: `windSpeed`, `windDirection`, `gusts` and `swells` where
 * given, the enclosing `Weather`'s for what is left out (as `weatherOceanWind`, in the default
 * compass frame: world X/Z, or a `Scenery`'s wave plane, east and south). The direction and
 * the swells are kept from render to render while the weather's hold.
 */
export function useWeatherOceanWind(
  windSpeed: number | undefined,
  windDirection: Vec2 | undefined,
  gusts?: WeatherGusts,
  swells?: SeaSwell[],
): {
  windSpeed?: number;
  windDirection?: Vec2;
  gusts?: WeatherGusts;
  swells?: SeaSwell[];
} {
  const weather = useWeather();
  const wind = weather?.wind;
  const from = wind?.from;
  const toward = useMemo(
    () => (from === undefined ? undefined : windToward({ speed: 0, from })),
    [from],
  );
  const swellKey = weather?.swell ? JSON.stringify(weather.swell) : '';
  const weatherSwells = useMemo(
    () => (swellKey ? weatherSeaSwells(JSON.parse(swellKey)) : undefined),
    [swellKey],
  );
  return {
    windSpeed: windSpeed ?? wind?.speed,
    windDirection: windDirection ?? toward,
    gusts: gusts ?? wind?.gusts,
    swells: swells ?? weatherSwells,
  };
}
