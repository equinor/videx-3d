import type { WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { renderAside } from '../src/sdk/utils/render-aside';

// What renderAside touches of a renderer: drawing into the outer target's face 2, mip 1.
function standIn() {
  const bound = { target: 'outer' as unknown, face: 2, mip: 1 };
  const renderer = {
    autoClear: true,
    info: { autoReset: true },
    shadowMap: { autoUpdate: true },
    getRenderTarget: () => bound.target,
    getActiveCubeFace: () => bound.face,
    getActiveMipmapLevel: () => bound.mip,
    setRenderTarget(target: unknown, face = 0, mip = 0) {
      bound.target = target;
      bound.face = face;
      bound.mip = mip;
    },
  };
  const settings = () => [
    renderer.autoClear,
    renderer.info.autoReset,
    renderer.shadowMap.autoUpdate,
  ];
  return { renderer, bound, settings };
}

describe('renderAside', () => {
  it('draws with clearing, counter resets and shadow updates off, then puts all back', () => {
    const { renderer, bound, settings } = standIn();
    let during: boolean[] = [];
    const result = renderAside(renderer as unknown as WebGLRenderer, () => {
      during = settings();
      renderer.setRenderTarget('aside', 4, 3);
      return 7;
    });
    expect(result).toBe(7);
    expect(during).toEqual([false, false, false]);
    expect(bound).toEqual({ target: 'outer', face: 2, mip: 1 });
    expect(settings()).toEqual([true, true, true]);
  });

  it('puts all back when the draw throws', () => {
    const { renderer, bound, settings } = standIn();
    expect(() =>
      renderAside(renderer as unknown as WebGLRenderer, () => {
        renderer.setRenderTarget('aside', 4);
        throw new Error('context lost');
      }),
    ).toThrow('context lost');
    expect(bound).toEqual({ target: 'outer', face: 2, mip: 1 });
    expect(settings()).toEqual([true, true, true]);
  });
});
