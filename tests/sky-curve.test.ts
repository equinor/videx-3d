import {
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderLib,
  Vector4,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from 'three';
import { describe, expect, it } from 'vitest';
import { applySkyCurve } from '../src/components/Sky/sky-curve';
import type { SkyMaterial } from '../src/components/Sky/sky-material';

const sky = {
  uniforms: {
    uSkyCurvature: { value: 1 / 6371000 },
    uSkyFlat: { value: new Vector4(0, 0, 0, 10000) },
  },
} as unknown as SkyMaterial;

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

describe('applySkyCurve', () => {
  it('lowers each vertex after three projects it, before anything reads it', () => {
    const shader = compile(
      applySkyCurve(new MeshStandardMaterial(), sky),
      'standard',
    );
    const vertex = shader.vertexShader;
    expect(vertex).toContain('float skyCurveDrop(vec2 xz)');
    // The anchor stays, once, for whatever else patches after it.
    expect(vertex.split('#include <project_vertex>')).toHaveLength(2);
    const anchor = vertex.indexOf('#include <project_vertex>');
    const drop = vertex.indexOf('skyCurveDrop(skyCurveXZ)');
    expect(drop).toBeGreaterThan(anchor);
    expect(drop).toBeLessThan(vertex.indexOf('#include <logdepthbuf_vertex>'));
    expect(drop).toBeLessThan(vertex.indexOf('vViewPosition = - mvPosition'));
  });

  it("binds the sky's own uniforms", () => {
    const shader = compile(
      applySkyCurve(new MeshBasicMaterial(), sky),
      'basic',
    );
    expect(shader.uniforms.uSkyCurvature).toBe(sky.uniforms.uSkyCurvature);
    expect(shader.uniforms.uSkyFlat).toBe(sky.uniforms.uSkyFlat);
  });

  it('runs the hook the material held first', () => {
    const material = new MeshBasicMaterial();
    material.onBeforeCompile = shader => {
      shader.vertexShader = `// before\n${shader.vertexShader}`;
    };
    const shader = compile(applySkyCurve(material, sky), 'basic');
    expect(shader.vertexShader.startsWith('// before')).toBe(true);
    expect(shader.vertexShader).toContain('skyCurveDrop(skyCurveXZ)');
  });

  it('keys its program apart from the plain one, and by what it held', () => {
    const plain = new MeshBasicMaterial();
    const a = new MeshBasicMaterial();
    a.customProgramCacheKey = () => 'a';
    const b = new MeshBasicMaterial();
    b.customProgramCacheKey = () => 'b';
    applySkyCurve(a, sky);
    applySkyCurve(b, sky);
    expect(a.customProgramCacheKey()).toBe('a|sky-curve');
    expect(b.customProgramCacheKey()).toBe('b|sky-curve');
    expect(
      applySkyCurve(new MeshBasicMaterial(), sky).customProgramCacheKey(),
    ).not.toBe(plain.customProgramCacheKey());
  });
});
