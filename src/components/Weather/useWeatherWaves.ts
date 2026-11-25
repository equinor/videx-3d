import { useLayoutEffect } from 'react';
import type { SeaSwell } from '../../sdk/weather/sea-spectrum';
import type { Vec2 } from '../../sdk/types/common';
import type { WaterMaterial } from '../Water/water-material';
import type { WaterWaveTuning } from '../Water/water-material';
import { useWeatherSea } from './weather-context';
import type { WeatherSea } from './weather-sea';

/**
 * What of a sea's own props makes its waves its own: given any, it keeps a sea state of its
 * own (the weather filling in what it leaves out); given none, it draws the weather's.
 */
export type WaterWaveProps = {
  windSpeed?: number;
  windDirection?: Vec2;
  swells?: SeaSwell[];
  amplitude?: number;
  waveTuning?: WaterWaveTuning;
};

/**
 * Hand `material` the enclosing `Weather`'s sea (`WaterMaterial.sea`) while the sea's own
 * props (`own`, as given, before the weather fills them in) leave its waves to the weather:
 * no wind, swells or wave height of its own, nor wave tuning that changes the sea state. All
 * the seas under a weather that do draw one sea, on its clock. Returns the sea handed, or null.
 */
export function useWeatherWaves(
  material: WaterMaterial | null,
  own: WaterWaveProps,
): WeatherSea | null {
  const sea = useWeatherSea();
  const takes =
    !!sea &&
    own.windSpeed === undefined &&
    own.windDirection === undefined &&
    own.swells === undefined &&
    (own.amplitude === undefined || own.amplitude === 1) &&
    // 1 is the spectrum's own (`SeaSpectrumInput.spreadFloor`).
    (own.waveTuning?.spreadFloor ?? 1) === 1 &&
    own.waveTuning?.tail === undefined;
  useLayoutEffect(() => {
    if (!material) return;
    material.sea = takes ? sea : null;
    return () => {
      material.sea = null;
    };
  }, [material, sea, takes]);
  return takes ? sea : null;
}
