import { Color } from 'three';
import type { Vec3 } from '../types/common';

/**
 * How a body of water looks, one model for every sea the library draws (the `Ocean`, the
 * `Scenery`'s sea, a `ChunkStack`'s water): the colour of water too deep to see through, and how
 * far one sees through it. What lies in the water, the seabed and anything else, fades along
 * its path through it toward that colour, lit by the daylight left at its depth; red goes
 * first and blue last, as the colour has it, so shallows over sand come out lighter and
 * greener on their own. See documents/water.md.
 *
 * @group Weather
 */
export type WaterOptics = {
  /** the colour of water too deep to see through (CSS, sRGB). Default `#102c3a` */
  color?: string;
  /**
   * how far one sees through it, metres: what lies this far away in the water keeps 5 % of
   * its contrast. Default the preset's
   */
  clarity?: number;
};

/**
 * The water's looks by name: `realistic`, about the North Sea's (15 m); `clear`, to see the
 * seabed and what lies under the sea from above (750 m). Both the offshore North Sea's dark
 * slate blue-grey.
 *
 * @group Weather
 */
export type WaterOpticsPreset = 'realistic' | 'clear';

/** @group Weather */
export const WATER_OPTICS_PRESETS: Record<
  WaterOpticsPreset,
  Required<WaterOptics>
> = {
  realistic: { color: '#102c3a', clarity: 15 },
  clear: { color: '#102c3a', clarity: 750 },
};

/** The preset a water's optics left out are taken from. @group Weather */
export const DEFAULT_WATER_OPTICS: WaterOpticsPreset = 'realistic';

/**
 * The optical depth at which what lies in the water keeps 5 % of its contrast: ln 20, so the
 * mean extinction is this over the clarity.
 */
export const WATER_FADE = Math.log(20);

/**
 * What a water's look is given by, before {@link WaterOptics}: its deep colour, and the fog
 * density of its body (per metre: what lies `d` away keeps e^(−density·d)). ⚠️ Deprecated
 * props, still honoured.
 */
export type WaterOpticsLegacy = {
  deepColor?: string;
  bodyFogDensity?: number;
};

/**
 * A water's optics with nothing left out: `optics` (a preset's name, or its own colour and
 * clarity over the default preset's), else the deprecated `deepColor` and `bodyFogDensity`
 * where given, else the default preset.
 *
 * @group Weather
 */
export function waterOpticsOf(
  optics?: WaterOptics | WaterOpticsPreset | null,
  legacy: WaterOpticsLegacy = {},
): Required<WaterOptics> {
  if (typeof optics === 'string')
    return { ...(WATER_OPTICS_PRESETS[optics] ?? defaults()) };
  const base = defaults();
  const density = legacy.bodyFogDensity;
  return {
    color: optics?.color ?? legacy.deepColor ?? base.color,
    clarity:
      optics?.clarity ??
      (density !== undefined && density > 0
        ? WATER_FADE / density
        : base.clarity),
  };
}

const defaults = () => ({ ...WATER_OPTICS_PRESETS[DEFAULT_WATER_OPTICS] });

const scratch = new Color();

/** A water's colour in the working (linear) space, as the shaders take it. @group Weather */
export function waterColorOf(optics: Required<WaterOptics>): Vec3 {
  scratch.set(optics.color);
  return [scratch.r, scratch.g, scratch.b];
}

/**
 * A water's extinction per metre, per channel (linear red, green, blue): the mean
 * {@link WATER_FADE} over its clarity, shared out as its colour has it (−ln of each channel),
 * so the channel the water is darkest in goes first. Grey water takes them all alike.
 *
 * @group Weather
 */
export function waterExtinctionOf(optics: Required<WaterOptics>): Vec3 {
  const mean = WATER_FADE / Math.max(optics.clarity, 1e-3);
  const logs = waterColorOf(optics).map(c =>
    Math.log(Math.min(Math.max(c, 1e-3), 0.999)),
  );
  const average = (logs[0] + logs[1] + logs[2]) / 3;
  if (!(average < -1e-3)) return [mean, mean, mean];
  return logs.map(l => (mean * l) / average) as Vec3;
}

/**
 * How much of what lies `distance` metres away through the water shows, per channel:
 * e^(−extinction·distance).
 *
 * @group Weather
 */
export function waterTransmittance(extinction: Vec3, distance: number): Vec3 {
  const d = Math.max(distance, 0);
  return extinction.map(e => Math.exp(-e * d)) as Vec3;
}

/**
 * The daylight left `depth` metres under the surface, per channel: it falls at half the
 * extinction (the diffuse light's, about half the beam's in sea water). As `water-fog.glsl`'s
 * `waterFogDim`.
 *
 * @group Weather
 */
export function waterDaylight(extinction: Vec3, depth: number): Vec3 {
  return waterTransmittance(
    extinction.map(e => 0.5 * e) as Vec3,
    Math.max(depth, 0),
  );
}
