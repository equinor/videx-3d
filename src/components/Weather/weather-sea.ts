import type { WebGLRenderer } from 'three';
import type { SeaSpectrumInput } from '../../sdk/weather/sea-spectrum';
import {
  WATER_QUALITY,
  SeaState,
  type WaterQuality,
} from '../../sdk/weather/sea-state';
import type { WeatherClock } from '../../sdk/weather/weather-clock';
import {
  weatherSeaSwells,
  windToward,
  type WeatherState,
} from '../../sdk/weather/weather';
import { SeaWaveBake } from '../Water/sea-wave-bake';

type Sea = {
  state: SeaState;
  bake: SeaWaveBake | null;
  // The clock's time the state was last moved to; null until it first is.
  time: number | null;
  // What the tiles hold: the state's time and input when last baked, and which layers then.
  bakedTime: number;
  bakedRevision: number;
  baked: boolean[];
};

/**
 * The sea under a `Weather`: one `SeaState` for each quality asked for, the weather's
 * wind and swells its input, on the weather's clock, and its layers' tiles (`SeaWaveBake`).
 * Every sea under the weather that takes its wind and swells from it draws these, so all of
 * them are one sea, moved and baked once a frame however many draw it (`WaterMaterial.sea`).
 * In the default compass frame, as the weather's wind (`windToward`): X east, Z south.
 *
 * Its input is the weather's alone: a sea with a wind or swells of its own keeps a sea state
 * of its own.
 */
export class WeatherSea {
  private readonly seas = new Map<WaterQuality, Sea>();
  private input: SeaSpectrumInput | null = null;
  private inputKey = '';
  // Counts input changes, so a tile baked before one is baked again.
  private revision_ = 0;

  constructor(readonly clock: WeatherClock) {}

  /** whether the weather gives a wind: without one there is no sea to share */
  get active(): boolean {
    return this.input !== null;
  }

  /** counts changes to its input: what the seas drawing it work out from it is due again */
  get revision(): number {
    return this.revision_;
  }

  /** the weather's time, seconds: what the sea's phases follow */
  get time(): number {
    return this.clock.time;
  }

  /** Take the weather's wind and swells as the sea's input: eased toward as the clock runs. */
  setWeather(weather: WeatherState | null): void {
    const wind = weather?.wind;
    const input: SeaSpectrumInput | null = wind
      ? {
          windSpeed: wind.speed,
          windDirection: windToward(wind),
          swells: weather?.swell ? weatherSeaSwells(weather.swell) : [],
        }
      : null;
    const key = JSON.stringify(input);
    if (key === this.inputKey) return;
    this.inputKey = key;
    this.input = input;
    if (!input) return;
    this.revision_++;
    for (const sea of this.seas.values()) {
      sea.state.setInput(input);
      // Not drawn yet: as if the wind had blown so all along.
      if (sea.time === null) sea.state.settle();
    }
  }

  /** The sea state of `quality` (made as it is first asked for); null without a wind. */
  state(quality: WaterQuality): SeaState | null {
    return this.seaOf(quality)?.state ?? null;
  }

  /** The tiles of `quality`'s layers (made as they are first asked for); null without a wind. */
  bakeOf(quality: WaterQuality): SeaWaveBake | null {
    const sea = this.seaOf(quality);
    if (!sea) return null;
    sea.bake ??= new SeaWaveBake(
      sea.state.layers,
      WATER_QUALITY[quality].anisotropy,
    );
    return sea.bake;
  }

  /**
   * Move every sea state to the clock's time: run on by the step since (under an hour), else
   * set there. Once a time, however many ask.
   */
  advance(): void {
    const time = this.clock.time;
    for (const sea of this.seas.values()) {
      if (sea.time === time) continue;
      const dt = sea.time === null ? 0 : time - sea.time;
      if (sea.time !== null && dt > 0 && dt < 3600) sea.state.update(dt);
      else sea.state.time = time;
      sea.time = time;
    }
  }

  /**
   * Bake `quality`'s layers as they are now, those `drawn` says (default all), into its tiles:
   * a layer already baked at this time and input is left as it is, so the first sea to ask
   * bakes it, and a later one only the layers the first left out. Held still, nothing.
   */
  bake(
    renderer: WebGLRenderer,
    quality: WaterQuality,
    drawn?: (index: number) => boolean,
  ): void {
    const sea = this.seaOf(quality);
    const bake = this.bakeOf(quality);
    if (!sea || !bake) return;
    if (
      sea.bakedTime !== sea.state.time ||
      sea.bakedRevision !== this.revision_
    ) {
      sea.bakedTime = sea.state.time;
      sea.bakedRevision = this.revision_;
      sea.baked.fill(false);
    }
    const missing = (i: number) => !sea.baked[i] && (!drawn || drawn(i));
    if (!sea.state.layers.some((_, i) => missing(i))) return;
    bake.update(renderer, sea.state.layerTables(), missing);
    sea.state.layers.forEach((_, i) => {
      if (!drawn || drawn(i)) sea.baked[i] = true;
    });
  }

  /**
   * Let go of the tiles' GPU memory. The objects stay, and draw again if asked (three
   * uploads them anew): a remount under React's strict mode keeps what the seas hold.
   */
  dispose(): void {
    for (const sea of this.seas.values()) {
      sea.bake?.dispose();
      sea.bakedRevision = -1;
    }
  }

  private seaOf(quality: WaterQuality): Sea | null {
    if (!this.input) return null;
    let sea = this.seas.get(quality);
    if (!sea) {
      const spec = WATER_QUALITY[quality] ?? WATER_QUALITY.medium;
      // The seed an `WaterMaterial`'s own sea state has.
      const state = new SeaState(this.input, {
        layers: spec.layers,
        detail: spec.detail,
      });
      sea = {
        state,
        bake: null,
        time: null,
        bakedTime: Number.NaN,
        bakedRevision: -1,
        baked: state.layers.map(() => false),
      };
      this.seas.set(quality, sea);
    }
    return sea;
  }
}
