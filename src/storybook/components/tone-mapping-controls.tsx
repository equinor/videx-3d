import { useThree } from '@react-three/fiber';
import type { ArgTypes } from '@storybook/react-vite';
import { useEffect } from 'react';
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  ToneMapping,
} from 'three';

export type ToneMappingName = 'none' | 'aces' | 'agx' | 'neutral';

const TONE_MAPPING: Record<ToneMappingName, ToneMapping> = {
  none: NoToneMapping,
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
};

/** The renderer's tone mapping as story args. */
export type ToneMappingArgs = {
  toneMapping: ToneMappingName;
  exposure: number;
};

export const toneMappingArgs: ToneMappingArgs = {
  toneMapping: 'none',
  exposure: 1,
};

export const toneMappingArgTypes = (
  category = 'Tone mapping',
): ArgTypes<ToneMappingArgs> => ({
  toneMapping: {
    options: Object.keys(TONE_MAPPING),
    control: { type: 'radio' },
    description:
      'The renderer\u2019s tone mapping, which an `OutputPass` applies too. Changing it recompiles every material.',
    table: { category },
  },
  exposure: {
    control: { type: 'range', min: 0.05, max: 3, step: 0.05 },
    description: 'The renderer\u2019s tone mapping exposure.',
    table: { category },
  },
});

/**
 * Sets the renderer's tone mapping from {@link ToneMappingArgs}. An arg left out takes its
 * default: Storybook leaves out of a story's args any whose `if` fails, and an undefined
 * exposure makes an `OutputPass` draw every pixel black.
 */
export const RendererToneMapping = ({
  toneMapping = toneMappingArgs.toneMapping,
  exposure = toneMappingArgs.exposure,
}: Partial<ToneMappingArgs>) => {
  const gl = useThree(state => state.gl);
  useEffect(() => {
    gl.toneMapping = TONE_MAPPING[toneMapping];
    gl.toneMappingExposure = exposure;
  }, [gl, toneMapping, exposure]);
  return null;
};
