import { WebGLRenderer, WebGLRenderTarget } from 'three';

export abstract class Pass {
  writeToScreen: boolean = false;

  setSize?(width: number, height: number, pixelRatio: number): void;

  dispose?(): void;

  public abstract render(
    renderer: WebGLRenderer,
    buffer: WebGLRenderTarget,
  ): void;
}
