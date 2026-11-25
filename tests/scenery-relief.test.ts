import {
  DepthTexture,
  FloatType,
  UnsignedIntType,
  type TextureDataType,
  type WebGLRenderer,
} from 'three';
import { describe, expect, it } from 'vitest';
import { sceneryReliefFarStep } from '../src/components/Scenery/scenery-relief';

// A renderer drawing into a target with a depth texture of `type` (none: the canvas).
function drawingInto(type: TextureDataType | null, reversed: boolean) {
  const target =
    type === null ? null : { depthTexture: new DepthTexture(1, 1, type) };
  return {
    getRenderTarget: () => target,
    state: { buffers: { depth: { getReversed: () => reversed } } },
  } as unknown as WebGLRenderer;
}

// The window depth of the point `distance` away, reversed, for a perspective camera.
const reversedDepth = (near: number, far: number, distance: number) =>
  (near * (far - distance)) / (distance * (far - near));

describe('sceneryReliefFarStep', () => {
  it('is one 24-bit step in a fixed-point buffer, reversed too: finer rounds to the far plane', () => {
    for (const reversed of [false, true]) {
      for (const type of [null, UnsignedIntType]) {
        const step = sceneryReliefFarStep(drawingInto(type, reversed));
        expect(Math.round(step * (2 ** 24 - 1))).toBe(1);
      }
    }
  });

  it('is an fp32 step under 1 in a float buffer', () => {
    const step = sceneryReliefFarStep(drawingInto(FloatType, false));
    expect(Math.fround(1 - step)).toBeLessThan(1);
  });

  it('stays behind what lies just short of the far plane in a reversed float buffer', () => {
    const step = sceneryReliefFarStep(drawingInto(FloatType, true));
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(reversedDepth(0.1, 3e6, 0.999 * 3e6));
  });
});
