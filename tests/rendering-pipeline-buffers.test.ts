import { DepthTexture, WebGLRenderTarget } from 'three';
import { SMAAEdgesShader } from 'three-stdlib';
import { describe, expect, it } from 'vitest';
import { PipelineBuffers } from '../src/rendering/pipeline-buffers';
import { smaaClampedEdgeTaps } from '../src/rendering/smaa-resolver';

describe('smaaClampedEdgeTaps', () => {
  it('clamps every colour tap of three-stdlib’s edge shader', () => {
    const edges = SMAAEdgesShader.fragmentShader;
    const { shader, taps } = smaaClampedEdgeTaps(edges);
    expect(taps).toBe(7);
    expect(shader).not.toMatch(/(?<!clamp\( )texture2D\( colorTex/);
  });
});

describe('PipelineBuffers', () => {
  const main = () => {
    const target = new WebGLRenderTarget(8, 4, { depthBuffer: true });
    target.depthTexture = new DepthTexture(8, 4);
    return target;
  };

  it('swaps between the main target and a spare sharing its depth', () => {
    const buffers = new PipelineBuffers(main());
    const spare = buffers.spare;
    expect(spare).not.toBe(buffers.main);
    expect(spare.depthTexture).toBe(buffers.main.depthTexture);
    expect([spare.width, spare.height]).toEqual([8, 4]);
    expect(buffers.swap()).toBe(spare);
    expect(buffers.spare).toBe(buffers.main);
    expect(buffers.swap()).toBe(buffers.main);
  });

  it('starts each frame on the main target', () => {
    const buffers = new PipelineBuffers(main());
    buffers.swap();
    buffers.reset();
    expect(buffers.current).toBe(buffers.main);
  });

  it('keeps the shared depth through a resize and a dispose', () => {
    const buffers = new PipelineBuffers(main());
    const spare = buffers.spare;
    // As three's renderer does: a target's depth texture goes with it.
    spare.addEventListener('dispose', () => spare.depthTexture?.dispose());
    let disposed = false;
    buffers.main.depthTexture!.addEventListener(
      'dispose',
      () => (disposed = true),
    );
    buffers.setSize(16, 8);
    expect([spare.width, spare.height]).toEqual([16, 8]);
    expect(spare.depthTexture).toBe(buffers.main.depthTexture);
    buffers.dispose();
    expect(disposed).toBe(false);
  });
});
