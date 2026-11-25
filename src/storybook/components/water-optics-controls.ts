import type { InputType } from 'storybook/internal/csf';
import {
  WATER_OPTICS_PRESETS,
  type WaterOptics,
  type WaterOpticsPreset,
} from '../../sdk/weather/water-optics';

/** A preset's colour and clarity, as a story's args start from them. */
export const waterOpticsArgsOf = (preset: WaterOpticsPreset = 'realistic') => ({
  color: WATER_OPTICS_PRESETS[preset].color,
  clarity: WATER_OPTICS_PRESETS[preset].clarity,
});

/** A water's look (`optics`) from a story's colour and clarity args. */
export const waterOpticsFromArgs = (
  color: string,
  clarity: number,
): Required<WaterOptics> => ({ color, clarity });

/**
 * The control for a water's colour (`optics.color`) in `category`: one colour for every part
 * of it, the surface, the view in it, and a `ZoneStack`'s walls and tint.
 */
export const waterColorArgType = (category: string): InputType => ({
  control: { type: 'color' },
  description:
    'The colour of water too deep to see through (`optics.color`): the sea\u2019s own tone, the view in it, and the walls\u2019 and the tint\u2019s. What lies in the water fades toward it along its path through it, the channel it is darkest in first, so it sets how the water turns with depth too. Both presets\u2019 is `#102c3a`, the offshore North Sea\u2019s.',
  table: { category },
});

/** The control for how far one sees through a water (`optics.clarity`) in `category`. */
export const waterClarityArgType = (category: string): InputType => ({
  control: { type: 'range', min: 1, max: 1000, step: 1 },
  description:
    'How far one sees through the water, in metres (`optics.clarity`): what lies this far away in it keeps 5\u00a0% of its contrast. The presets: `realistic` 15 (the North Sea\u2019s), `clear` 750 (to see the seabed and what lies under the sea).',
  table: { category },
});
