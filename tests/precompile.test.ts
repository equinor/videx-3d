import {
  BufferGeometry,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three';
import { describe, expect, test } from 'vitest';
import { attachOitVariants } from '../src/rendering/oit-material';
import { OITRenderPass } from '../src/rendering/passes/OITRenderPass';
import {
  oitVariantPasses,
  precompile,
  setPipelinePasses,
} from '../src/rendering/precompile';

type Compiled = {
  material: Material;
  offscreen: boolean;
  transparent: boolean;
};

/** A renderer that records what `compile` saw, with programs ready when `ready()` says. */
function mockRenderer(ready: () => boolean = () => true) {
  let target: unknown = null;
  const compiled: Compiled[] = [];
  const programs = new Map<Material, { isReady(): boolean }>();
  const renderer = {
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: (next: unknown) => {
      target = next;
    },
    compile: (root: Object3D) => {
      const materials = new Set<Material>();
      root.traverse(object => {
        const material = (object as Mesh).material;
        if (!material) return;
        for (const m of [material].flat()) {
          materials.add(m);
          compiled.push({
            material: m,
            offscreen: target !== null,
            transparent: m.transparent,
          });
          programs.set(m, { isReady: ready });
        }
      });
      return materials;
    },
    properties: { get: (m: Material) => ({ currentProgram: programs.get(m) }) },
  };
  return {
    renderer: renderer as unknown as WebGLRenderer,
    compiled,
    target: () => target,
  };
}

function oitMaterial(opacity: number) {
  const material = new ShaderMaterial({ transparent: true });
  material.opacity = opacity;
  return attachOitVariants(material);
}

const camera = new PerspectiveCamera();

describe('precompile', () => {
  test('without a pipeline: the materials as they are, for the canvas', () => {
    const { renderer, compiled, target } = mockRenderer();
    const scene = new Scene();
    const material = new MeshBasicMaterial();
    const root = new Group().add(new Mesh(new BufferGeometry(), material));

    expect(precompile(renderer, root, camera, scene)).toBeNull();
    expect(compiled.map(c => c.material)).toEqual([material]);
    expect(compiled[0].offscreen).toBe(false);
    expect(target()).toBeNull();
  });

  test('offscreen: compiled with a render target bound, then the old one back', () => {
    const { renderer, compiled, target } = mockRenderer();
    const scene = new Scene();
    const root = new Group().add(
      new Mesh(new BufferGeometry(), new MeshBasicMaterial()),
    );
    precompile(renderer, root, camera, scene, 'offscreen');
    expect(compiled[0].offscreen).toBe(true);
    expect(target()).toBeNull();
  });

  test('through an OIT pipeline: a transparent material as the variants it draws with', () => {
    const { renderer, compiled } = mockRenderer();
    const scene = new Scene();
    const pass = new OITRenderPass(scene, camera);
    setPipelinePasses(scene, [pass]);
    const see = oitMaterial(0.5);
    const solid = new MeshBasicMaterial();
    const mesh = new Mesh(new BufferGeometry(), see);
    const root = new Group().add(mesh, new Mesh(new BufferGeometry(), solid));

    precompile(renderer, root, camera, scene);
    const variants = see.getOitVariants();
    const drawn = new Set(compiled.map(c => c.material));
    expect(drawn.has(see)).toBe(false);
    for (const p of oitVariantPasses(pass))
      expect(drawn.has(variants[p])).toBe(true);
    expect(drawn.has(variants.occlusion)).toBe(false);
    expect(drawn.has(solid)).toBe(true);
    expect(compiled.every(c => c.offscreen)).toBe(true);
    expect(mesh.material).toBe(see);
    setPipelinePasses(scene, null);
  });

  test('through an OIT pipeline: a transparent material at full opacity as forced opaque', () => {
    const { renderer, compiled } = mockRenderer();
    const scene = new Scene();
    setPipelinePasses(scene, [new OITRenderPass(scene, camera)]);
    const material = oitMaterial(1);
    const root = new Group().add(new Mesh(new BufferGeometry(), material));

    precompile(renderer, root, camera, scene);
    expect(compiled).toEqual([
      { material, offscreen: true, transparent: false },
    ]);
    expect(material.transparent).toBe(true);
    setPipelinePasses(scene, null);
  });

  test('resolves once every program reports ready', async () => {
    let ready = false;
    const { renderer } = mockRenderer(() => ready);
    const scene = new Scene();
    const root = new Group().add(
      new Mesh(new BufferGeometry(), new MeshBasicMaterial()),
    );
    const pending = precompile(renderer, root, camera, scene);
    expect(pending).toBeInstanceOf(Promise);
    let resolved = false;
    pending?.then(() => (resolved = true));
    await new Promise(r => setTimeout(r, 30));
    expect(resolved).toBe(false);
    ready = true;
    await pending;
    expect(resolved).toBe(true);
  });
});

describe('oitVariantPasses', () => {
  const pass = () => new OITRenderPass(new Scene(), camera);

  test('min depth, tail and front by default', () => {
    expect(oitVariantPasses(pass())).toEqual(['depthMin', 'accum', 'front']);
  });

  test('no front pass when it is merged into the tail, nor any with skipFront', () => {
    const merged = pass();
    merged.mergeFront = true;
    expect(oitVariantPasses(merged)).toEqual(['depthMin', 'accum']);
    const skipped = pass();
    skipped.skipFront = true;
    expect(oitVariantPasses(skipped)).toEqual(['accum']);
  });

  test('the occlusion stamp when it is on', () => {
    const stamped = pass();
    stamped.occlusionDepthStamp = true;
    expect(oitVariantPasses(stamped)).toContain('occlusion');
  });
});
