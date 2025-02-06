import { ShaderMaterial } from 'three'
import vertexShader from './shaders/depth/vertex.glsl'
import fragmentShader from './shaders/depth/fragment.glsl'

export class DepthReadMaterial extends ShaderMaterial {
  constructor() {
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        cameraNear: { value: 0 },
        cameraFar: { value: 1 },
        depthTexture: { value: null },
        cameraWasPerspective: { value: null },
      },
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
    });
  }
}