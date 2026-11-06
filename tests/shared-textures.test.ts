import { DataTexture, ShaderMaterial, WebGLRenderer } from 'three';
import { describe, expect, test } from 'vitest';
import {
  drawsSharedTextures,
  shareTexture,
  watchSharedTextures,
} from '../src/common/shared-textures';

// A renderer as far as the shared textures see it: its canvas.
const rendererOn = (canvas: EventTarget) =>
  ({ domElement: canvas }) as unknown as WebGLRenderer;

const disposals = (texture: DataTexture) => {
  const counted = { count: 0 };
  texture.addEventListener('dispose', () => counted.count++);
  return counted;
};

describe('shared textures', () => {
  test('disposed once as a watched renderer loses its context', () => {
    const texture = shareTexture(new DataTexture(new Uint8Array(4), 1, 1));
    const disposed = disposals(texture);
    const canvas = new EventTarget();
    const renderer = rendererOn(canvas);
    watchSharedTextures(renderer);
    watchSharedTextures(renderer);
    expect(disposed.count).toBe(0);
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(disposed.count).toBe(1);
  });

  test('not as an unwatched one does', () => {
    const texture = shareTexture(new DataTexture(new Uint8Array(4), 1, 1));
    const disposed = disposals(texture);
    new EventTarget().dispatchEvent(new Event('webglcontextlost'));
    expect(disposed.count).toBe(0);
  });

  test('a material drawing with them watches its renderer', () => {
    const texture = shareTexture(new DataTexture(new Uint8Array(4), 1, 1));
    const disposed = disposals(texture);
    const material = drawsSharedTextures(new ShaderMaterial());
    const canvas = new EventTarget();
    const draw = material.onBeforeRender as (renderer: WebGLRenderer) => void;
    draw(rendererOn(canvas));
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(disposed.count).toBe(1);
  });
});
