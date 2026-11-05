import type { ReactNode } from 'react';
import type { WeatherState } from '../../sdk/weather/weather';
import { WeatherContext } from './weather-context';

/**
 * Weather props
 * @expand
 */
export type WeatherProps = {
  /**
   * the wind and the cloud layers (see {@link WeatherState}); `weatherPreset` makes one from
   * a report's words. Kept as given: a new object is a new weather
   */
  weather: WeatherState;
  children?: ReactNode;
};

/**
 * The weather for everything inside it: the wind raises the waves of an `Ocean`, a
 * `SceneryOcean` and a `ChunkStack`'s water, and the cloud layers are what a
 * `SceneryCloudVolume` draws. Each still takes its own props first: the weather fills in
 * only what they leave out. It draws nothing, and needs no `Scenery`.
 *
 * @example
 * <Weather weather={weatherPreset('scattered', 'cumulus', { speed: 10, from: 240 })}>
 *   <Scenery>
 *     <SceneryOcean />
 *     <SceneryCloudVolume />
 *   </Scenery>
 * </Weather>
 *
 * @group Components
 */
export const Weather = ({ weather, children }: WeatherProps) => (
  <WeatherContext.Provider value={weather}>{children}</WeatherContext.Provider>
);
