import {
  Camera,
  MeshBasicMaterial,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { FullscreenRenderer } from './fullscreen-renderer'

const fullscreenRenderer = new FullscreenRenderer()

export abstract class Pass {
  writeToScreen: boolean = false

  public abstract render(
    renderer: WebGLRenderer,
    buffer: WebGLRenderbuffer
  ): void
}

export class RenderPass extends Pass {
  private scene: Scene
  private camera: Camera

  constructor(scene: Scene, camera: Camera) {
    super()
    this.scene = scene
    this.camera = camera
  }

  render(renderer: WebGLRenderer, buffer: WebGLRenderTarget) {
    renderer.setRenderTarget(this.writeToScreen ? null : buffer)
    renderer.clear()
    renderer.render(this.scene, this.camera)
  }
}

export class OutputPass extends Pass {
  material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
    premultipliedAlpha: true,
  })

  constructor() {
    super()
    this.writeToScreen = true
  }

  render(renderer: WebGLRenderer, buffer: WebGLRenderTarget) {
    this.material.map = buffer.texture
    fullscreenRenderer.renderMaterial(
      renderer,
      this.writeToScreen ? null : buffer,
      this.material
    )
  }
}
