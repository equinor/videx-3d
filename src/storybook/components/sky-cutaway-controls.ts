import type { ArgTypes } from '@storybook/react-vite';
import type { SkyCutaway } from '../../components/Sky/Sky';

/** A {@link SkyCutaway} as story args. */
export type SkyCutawayArgs = {
  cutaway: boolean;
  cutawayReach: number;
  cutawayExitTilt: number;
  cutawaySoftness: number;
  cutawayWave1Amplitude: number;
  cutawayWave1Frequency: number;
  cutawayWave1Phase: number;
  cutawayWave2Amplitude: number;
  cutawayWave2Frequency: number;
  cutawayWave2Phase: number;
  cutawayRimColor: string;
  cutawayRimWidth: number;
  cutawayShadowOpacity: number;
  cutawayShadowWidth: number;
  cutawayEase: number;
  cutawayZoomFollow: number;
  cutawayReference: number;
};

/** The Sky's own defaults, with the cutaway off. */
export const skyCutawayArgs: SkyCutawayArgs = {
  cutaway: false,
  cutawayReach: 0.5,
  cutawayExitTilt: 45,
  cutawaySoftness: 0.01,
  cutawayWave1Amplitude: 0.12,
  cutawayWave1Frequency: 1,
  cutawayWave1Phase: 0,
  cutawayWave2Amplitude: 0.04,
  cutawayWave2Frequency: 2.6,
  cutawayWave2Phase: 0.3,
  cutawayRimColor: '#ffffff',
  cutawayRimWidth: 3,
  cutawayShadowOpacity: 0.5,
  cutawayShadowWidth: 0.15,
  cutawayEase: 0,
  cutawayZoomFollow: 0.5,
  cutawayReference: 0,
};

/** A Sky's `cutaway` from {@link SkyCutawayArgs}. */
export const skyCutawayFromArgs = (args: SkyCutawayArgs): SkyCutaway | false =>
  args.cutaway && {
    reach: args.cutawayReach,
    exitTilt: args.cutawayExitTilt,
    softness: args.cutawaySoftness,
    waves: [
      {
        amplitude: args.cutawayWave1Amplitude,
        frequency: args.cutawayWave1Frequency,
        phase: args.cutawayWave1Phase,
      },
      {
        amplitude: args.cutawayWave2Amplitude,
        frequency: args.cutawayWave2Frequency,
        phase: args.cutawayWave2Phase,
      },
    ],
    rim: { color: args.cutawayRimColor, width: args.cutawayRimWidth },
    shadow: {
      opacity: args.cutawayShadowOpacity,
      width: args.cutawayShadowWidth,
    },
    ease: args.cutawayEase,
    zoomFollow: args.cutawayZoomFollow,
    reference: args.cutawayReference > 0 ? args.cutawayReference : undefined,
  };

const detail = (
  min: number,
  max: number,
  step: number,
  description: string,
) => ({
  control: { type: 'range' as const, min, max, step },
  description,
  if: { arg: 'cutaway' },
  table: { category: 'Cutaway' },
});

/** Controls for {@link SkyCutawayArgs}, under 'Cutaway'; `cutaway` itself shows while the `shownIf` arg is on. */
export const skyCutawayArgTypes = (
  shownIf?: string,
): ArgTypes<SkyCutawayArgs> => ({
  cutaway: {
    control: { type: 'boolean' },
    description:
      'Cut the sea\u2019s water and seabed in front of the view: everything nearer than a line across it, where the `cutawayReach` row meets the surface (or the seabed, with the camera in the water or the sea dry). Two waves bend the line, a rim marks it and a shadow falls inside it. The occupant and the data are never cut.',
    ...(shownIf ? { if: { arg: shownIf } } : {}),
    table: { category: 'Cutaway' },
  },
  cutawayReach: detail(
    0,
    1,
    0.01,
    'The frame row whose sight line sets the edge looking level: 0 the bottom, 1 the top. Tilting down raises it to the top, looking straight down.',
  ),
  cutawayExitTilt: detail(
    0,
    90,
    1,
    'The downward tilt, in degrees, from which the edge slides up out of the view, gone looking straight down.',
  ),
  cutawaySoftness: detail(
    0,
    0.3,
    0.005,
    'Width of the edge\u2019s fade, relative to the frame\u2019s half-width at the edge.',
  ),
  cutawayWave1Amplitude: detail(
    0,
    0.5,
    0.005,
    'How far the first wave swings the edge ahead and back, relative to the frame\u2019s half-width at the edge. Zoomed out it levels out as the cut shrinks in the frame.',
  ),
  cutawayWave1Frequency: detail(
    0,
    6,
    0.05,
    'The first wave\u2019s waves across the frame. 1 is one S.',
  ),
  cutawayWave1Phase: detail(
    0,
    1,
    0.01,
    'Where along the edge the first wave starts, in waves.',
  ),
  cutawayWave2Amplitude: detail(
    0,
    0.5,
    0.005,
    'How far the second wave swings the edge ahead and back.',
  ),
  cutawayWave2Frequency: detail(
    0,
    6,
    0.05,
    'The second wave\u2019s waves across the frame.',
  ),
  cutawayWave2Phase: detail(
    0,
    1,
    0.01,
    'Where along the edge the second wave starts, in waves.',
  ),
  cutawayRimColor: {
    control: { type: 'color' },
    description: 'Colour of the line along the edge.',
    if: { arg: 'cutaway' },
    table: { category: 'Cutaway' },
  },
  cutawayRimWidth: detail(
    0,
    12,
    0.5,
    'Width of the line along the edge, in pixels; 0 for none. Thins toward 1 as the cut shrinks in the frame. Drawn on the surface, so what stands above the sea hides it.',
  ),
  cutawayShadowOpacity: detail(
    0,
    1,
    0.01,
    'How dark the shadow just inside the edge is, over everything seen through the cut.',
  ),
  cutawayShadowWidth: detail(
    0,
    1,
    0.01,
    'How far into the cut the shadow reaches, relative to the frame\u2019s half-width at the edge.',
  ),
  cutawayEase: detail(
    0,
    1,
    0.01,
    'Seconds for the cut\u2019s size to settle after a zoom or tilt; 0 follows the camera exactly.',
  ),
  cutawayZoomFollow: detail(
    0,
    1,
    0.05,
    'How much of a zoom the cut\u2019s size follows on screen: 1 keeps it fixed in the frame, 0 fixed in the world. It has its frame size with the camera `cutawayReference` high over it.',
  ),
  cutawayReference: detail(
    0,
    50000,
    100,
    'The camera height, in metres, at which the cut has its frame size (see `cutawayZoomFollow`). 0 takes half the occupant\u2019s width.',
  ),
});
