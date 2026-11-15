import { describe, expect, it } from 'vitest';
import {
  Color,
  CubeUVReflectionMapping,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Scene,
  Texture,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { OceanMaterial } from '../src/components/Ocean/ocean-material';
import {
  prefilteredEnvironment,
  SceneSky,
} from '../src/sdk/materials/scene-sky';

// Nothing here prefilters: a renderer is never touched.
const renderer = {} as WebGLRenderer;

const prefiltered = (height: number) => {
  const texture = new Texture();
  texture.mapping = CubeUVReflectionMapping;
  texture.image = { width: (3 * height) / 4, height };
  return texture;
};

const lit = (scene: Scene, position: Vector3, intensity: number) => {
  const light = new DirectionalLight(0xffffff, intensity);
  light.position.copy(position);
  scene.add(light);
  return light;
};

describe('SceneSky', () => {
  it('reflects what a Scenery publishes while it is claimed, else the scene', () => {
    const scene = new Scene();
    const own = prefiltered(1024);
    scene.environment = own;
    scene.environmentIntensity = 0.5;
    const sky = new SceneSky();
    expect(sky.resolve(renderer, scene, 0).environment).toBe(own);
    expect(sky.resolve(renderer, scene, 0).intensity).toBe(0.5);

    const owner = {};
    const published = sky.claim(owner);
    published.environment = prefiltered(512);
    expect(sky.resolve(renderer, scene, 0)).toBe(published);
    // Another's release leaves it.
    sky.release({});
    expect(sky.resolve(renderer, scene, 0)).toBe(published);
    sky.release(owner);
    expect(sky.resolve(renderer, scene, 0).environment).toBe(own);
  });

  it('takes the brightest visible directional light, toward it from its target', () => {
    const scene = new Scene();
    lit(scene, new Vector3(0, 0, 5), 1);
    const bright = lit(scene, new Vector3(3, 4, 0), 2);
    const sky = new SceneSky();
    const sun = sky.resolve(renderer, scene, 0).sun!;
    expect(sun.direction.distanceTo(new Vector3(0.6, 0.8, 0))).toBeLessThan(
      1e-6,
    );
    expect(sun.color.equals(new Color(2, 2, 2))).toBe(true);
    // Hidden, the other at once: not only at the next search.
    bright.visible = false;
    const other = sky.resolve(renderer, scene, 1).sun!;
    expect(other.direction.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-6);
    bright.visible = true;
    scene.clear();
    expect(sky.resolve(renderer, scene, 2).sun).toBeNull();
  });

  it('prefilters nothing before an environment has loaded', () => {
    const texture = new Texture();
    texture.mapping = EquirectangularReflectionMapping;
    expect(prefilteredEnvironment(renderer, texture)).toBeNull();
    expect(prefilteredEnvironment(renderer, new Texture())).toBeNull();
  });
});

describe('OceanMaterial sky', () => {
  it('glints with the scene sun unless given its own, and back to it on null', () => {
    const scene = new Scene();
    lit(scene, new Vector3(0, 1, 0), 3);
    const material = new OceanMaterial();
    material.updateSky(renderer, scene);
    expect(material.sunDirection.y).toBeCloseTo(1);
    expect(material.sunColor.r).toBeCloseTo(3);

    material.sunDirection = new Vector3(1, 0, 0);
    material.sunColor = '#ff0000';
    material.updateSky(renderer, scene);
    expect(material.sunDirection.x).toBeCloseTo(1);
    expect(material.sunColor.g).toBe(0);

    material.sunDirection = null;
    material.sunColor = null;
    material.updateSky(renderer, scene);
    expect(material.sunDirection.y).toBeCloseTo(1);
    expect(material.sunColor.g).toBeCloseTo(3);
    material.dispose();
  });

  it('compiles the environment in as it comes and goes, by its size', () => {
    const scene = new Scene();
    const material = new OceanMaterial();
    material.updateSky(renderer, scene);
    expect(material.defines.OCEAN_SKY_ENV).toBeUndefined();
    const version = material.version;

    // A 128 px cube prefiltered (the Scenery's): 512 tall, its finest mip 7.
    scene.environment = prefiltered(512);
    material.updateSky(renderer, scene);
    expect(material.defines.OCEAN_SKY_ENV).toBe('');
    expect(material.defines.CUBEUV_MAX_MIP).toBe('7.0');
    expect(material.defines.CUBEUV_TEXEL_HEIGHT).toBe(1 / 512);
    expect(material.version).toBeGreaterThan(version);

    // Another of the same size: no compile.
    const compiled = material.version;
    scene.environment = prefiltered(512);
    material.updateSky(renderer, scene);
    expect(material.version).toBe(compiled);

    scene.environment = null;
    material.updateSky(renderer, scene);
    expect(material.defines.OCEAN_SKY_ENV).toBeUndefined();
    expect(material.defines.CUBEUV_MAX_MIP).toBeUndefined();
    material.dispose();
  });
});
