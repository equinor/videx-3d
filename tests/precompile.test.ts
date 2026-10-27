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
  createPrecompileCount,
  oitVariantPasses,
  precompile,
  PRECOMPILE_PRIORITY,
  PRECOMPILE_SLOTS,
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

describe('the precompile queue', () => {
  const meshes = (count: number) =>
    Array.from(
      { length: count },
      () => new Mesh(new BufferGeometry(), new MeshBasicMaterial()),
    );

  test(`keeps ${PRECOMPILE_SLOTS} programs compiling at once`, async () => {
    let ready = false;
    const { renderer, compiled } = mockRenderer(() => ready);
    const scene = new Scene();
    const root = new Group().add(...meshes(PRECOMPILE_SLOTS + 2));

    const pending = precompile(renderer, root, camera, scene);
    expect(compiled).toHaveLength(PRECOMPILE_SLOTS);
    ready = true;
    await pending;
    expect(compiled).toHaveLength(PRECOMPILE_SLOTS + 2);
  });

  test('starts the higher priority first, then in the order asked for', async () => {
    let ready = false;
    const { renderer, compiled } = mockRenderer(() => ready);
    const scene = new Scene();
    const blockers = new Group().add(...meshes(PRECOMPILE_SLOTS));
    const [late] = meshes(1);
    const [early] = meshes(1);
    const [first] = meshes(1);

    const waits = [
      precompile(renderer, blockers, camera, scene),
      precompile(renderer, late, camera, scene, 'scene', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      precompile(renderer, early, camera, scene),
      precompile(renderer, first, camera, scene, 'scene', {
        priority: PRECOMPILE_PRIORITY.first,
      }),
    ];
    ready = true;
    await Promise.all(waits);
    expect(compiled.slice(PRECOMPILE_SLOTS).map(c => c.material)).toEqual([
      first.material,
      early.material,
      late.material,
    ]);
  });

  test('drops an object whose material is disposed of before its turn', async () => {
    let ready = false;
    const { renderer, compiled } = mockRenderer(() => ready);
    const scene = new Scene();
    const blockers = new Group().add(...meshes(PRECOMPILE_SLOTS));
    const [gone] = meshes(1);

    const waits = [
      precompile(renderer, blockers, camera, scene),
      precompile(renderer, gone, camera, scene),
    ];
    gone.material.dispose();
    ready = true;
    await Promise.all(waits);
    expect(compiled.map(c => c.material)).not.toContain(gone.material);
  });

  test('tells its progress once queued, then as each object is ready', async () => {
    let ready = false;
    const { renderer } = mockRenderer(() => ready);
    const scene = new Scene();
    const told: [number, number][] = [];
    const pending = precompile(
      renderer,
      new Group().add(...meshes(2)),
      camera,
      scene,
      'scene',
      { onProgress: (done, total) => told.push([done, total]) },
    );
    expect(told).toEqual([[0, 2]]);
    ready = true;
    await pending;
    expect(told).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);

    const none: [number, number][] = [];
    precompile(renderer, new Group(), camera, scene, 'scene', {
      onProgress: (done, total) => none.push([done, total]),
    });
    expect(none).toEqual([[0, 0]]);
  });

  test('counts several calls as one until all are done', () => {
    let changes = 0;
    const count = createPrecompileCount(() => changes++);
    const a = count.track();
    const b = count.track();
    a(1, 2);
    b(0, 3);
    expect(count.count()).toEqual({ done: 1, total: 5 });
    expect(changes).toBe(2);
    a(2, 2);
    b(3, 3);
    expect(count.count()).toEqual({ done: 5, total: 5 });
    count.track()(0, 1);
    expect(count.count()).toEqual({ done: 0, total: 1 });
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
