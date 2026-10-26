import {
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderLib,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from 'three';
import { describe, expect, it } from 'vitest';
import { applyGlobe } from '../src/sdk/materials/apply-globe';
import { Globe } from '../src/sdk/projection/globe';

const globe = new Globe();
globe.setDisc([-5000, -5000, 5000, 5000]);

const compile = (
  material: MeshStandardMaterial | MeshBasicMaterial,
  lib: 'standard' | 'basic',
) => {
  const shader = {
    vertexShader: ShaderLib[lib].vertexShader,
    fragmentShader: ShaderLib[lib].fragmentShader,
    uniforms: {},
  } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader;
};

describe('applyGlobe', () => {
  it('places each vertex after three projects it, before anything reads it', () => {
    const shader = compile(
      applyGlobe(new MeshStandardMaterial(), globe),
      'standard',
    );
    const vertex = shader.vertexShader;
    expect(vertex).toContain('vec3 globePlace(vec2 xz, float height)');
    // The anchor stays, once, for whatever else patches after it.
    expect(vertex.split('#include <project_vertex>')).toHaveLength(2);
    const anchor = vertex.indexOf('#include <project_vertex>');
    const placed = vertex.indexOf('globePlace(globeWorld.xz');
    expect(placed).toBeGreaterThan(anchor);
    expect(placed).toBeLessThan(
      vertex.indexOf('#include <logdepthbuf_vertex>'),
    );
    expect(placed).toBeLessThan(vertex.indexOf('vViewPosition = - mvPosition'));
  });

  it("binds the globe's own uniforms", () => {
    const shader = compile(applyGlobe(new MeshBasicMaterial(), globe), 'basic');
    expect(shader.uniforms.uGlobe).toBe(globe.uniforms.uGlobe);
    expect(shader.uniforms.uGlobeDisc).toBe(globe.uniforms.uGlobeDisc);
    expect(shader.uniforms.uGlobeUp).toBe(globe.uniforms.uGlobeUp);
  });

  it('runs the hook the material held first', () => {
    const material = new MeshBasicMaterial();
    material.onBeforeCompile = shader => {
      shader.vertexShader = `// before\n${shader.vertexShader}`;
    };
    const shader = compile(applyGlobe(material, globe), 'basic');
    expect(shader.vertexShader.startsWith('// before')).toBe(true);
    expect(shader.vertexShader).toContain('globePlace(globeWorld.xz');
  });

  it('keys its program apart from the plain one, and by what it held', () => {
    const plain = new MeshBasicMaterial();
    const a = new MeshBasicMaterial();
    a.customProgramCacheKey = () => 'a';
    const b = new MeshBasicMaterial();
    b.customProgramCacheKey = () => 'b';
    applyGlobe(a, globe);
    applyGlobe(b, globe);
    expect(a.customProgramCacheKey()).toBe('a|globe');
    expect(b.customProgramCacheKey()).toBe('b|globe');
    expect(
      applyGlobe(new MeshBasicMaterial(), globe).customProgramCacheKey(),
    ).not.toBe(plain.customProgramCacheKey());
  });
});
