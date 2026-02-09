import {
  BufferGeometry,
  Camera,
  Float32BufferAttribute,
  Material,
  Mesh,
  OrthographicCamera,
  RawShaderMaterial,
  Texture,
  Uniform,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import fragmentShader from './shaders/copy-frag.glsl';
import vertexShader from './shaders/copy-vert.glsl';

export class FullscreenRenderer {
  camera: Camera;
  mesh: Mesh;
  copyMaterial: RawShaderMaterial;

  constructor() {
    const _camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const _geometry = new BufferGeometry();

    _geometry.setAttribute(
      'position',
      new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3),
    );
    _geometry.setAttribute(
      'uv',
      new Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2),
    );

    const _copyMaterial = new RawShaderMaterial({
      uniforms: {
        opacity: new Uniform(1),
        source: new Uniform<Texture | null>(null),
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.camera = _camera;
    this.mesh = new Mesh(_geometry, _copyMaterial);
    this.copyMaterial = _copyMaterial;
  }

  renderMaterial(
    renderer: WebGLRenderer,
    buffer: WebGLRenderTarget | null,
    material: Material,
  ) {
    this.mesh.material = material;

    renderer.setRenderTarget(buffer);
    renderer.render(this.mesh, this.camera);
  }

  renderTexture(
    renderer: WebGLRenderer,
    buffer: WebGLRenderTarget | null,
    texture: Texture,
    opacity: number = 1,
  ) {
    this.copyMaterial.uniforms.source.value = texture;
    this.copyMaterial.uniforms.opacity.value = opacity;
    this.renderMaterial(renderer, buffer, this.copyMaterial);
  }
}
