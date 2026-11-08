import {
  Camera,
  CubeTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoBlending,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Texture,
  Uniform,
  UnsignedByteType,
  Vector4,
  WebGLCubeRenderTarget,
  WebGLRenderer,
} from 'three';
import {
  WEATHER_SYSTEM_COUNT,
  weatherSystemCentresAt,
  WeatherSystemCentre,
} from '../../sdk/weather/weather-systems';
import { createSceneryGeometry } from './scenery-material';
import flowShader from './shaders/cloud-map-flow.glsl';
import fragmentShader from './shaders/cloud-map.glsl';

/** Texels along a side of each of the cloud map's faces: some 10 km to a texel. */
export const CLOUD_MAP_SIZE = 1024;
/**
 * Texels along a side of each of the type map's faces (`CloudMap.types`): some 20 km to a
 * texel. The types change over the weather systems' breadth, not their edges'.
 */
export const CLOUD_TYPE_MAP_SIZE = 512;
// Texels along a side of each of the wind's faces (cloud-map-flow.glsl): some 80 km to a texel.
const FLOW_SIZE = 128;
// Rows of a face of the cloud map drawn at a time (bakeCloudMap): some 1–2 ms of a mid-range
// GPU's time. The wind's faces are drawn whole, one a strip, first.
const STRIP_ROWS = 32;
const STRIPS = 6 + 6 * (CLOUD_MAP_SIZE / STRIP_ROWS);
const DEG = Math.PI / 180;
const EARTH_KM = 6371;

const vertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * The 3D clouds' weather far off (`cloud-map.glsl`): a cube map over the whole Earth, in the
 * frame fixed to it, of the share of the ground the weather systems lay low cloud over (r) and
 * how thick it is (g), and cloud at the middle level (b) and the high (a), traced back along
 * their wind (`cloud-map-flow.glsl`, its own smaller cube map), and lifted and dried by the
 * ground they cross (`terrain`, a `CloudTerrain`'s Earth map). Drawn on the GPU a strip at a
 * time ({@link bakeCloudMap}), once per renderer, seed and terrain, and shared by everything
 * drawing with them.
 */
export type CloudMap = {
  readonly target: WebGLCubeRenderTarget;
  readonly texture: CubeTexture;
  /**
   * the same weather's types (`cloud-map.glsl`, `CLOUD_MAP_TYPES`): where each level's cloud
   * lies along its chain of types, low (r, over 2), middle (g) and high (b), at
   * {@link CLOUD_TYPE_MAP_SIZE}
   */
  readonly typesTarget: WebGLCubeRenderTarget;
  readonly types: CubeTexture;
  /** the weather systems' wind (xyz, fixed on the Earth) and pressure (w) */
  readonly flow: WebGLCubeRenderTarget;
  readonly seed: number;
  /** the weather's time it is drawn at (seconds): the systems as they are then (`weatherSystemCentresAt`) */
  readonly time: number;
  /** the ground's height and slopes over the Earth (`CloudTerrain`), null for none */
  readonly terrain: Texture | null;
  /** its seed, its terrain's and its time: what it is shared by */
  readonly key: string;
  /** its seed and its terrain's: maps of the same weather at other times share it */
  readonly base: string;
  /** the weather systems it is drawn about */
  readonly systems: readonly WeatherSystemCentre[];
  /** what draws it: compile them first (`precompile`), then {@link bakeCloudMap} */
  readonly generators: readonly Mesh[];
  /** strips drawn so far */
  strips: number;
  /** whether all of it is drawn, with its mipmaps */
  readonly ready: boolean;
};

/** What a cloud map is drawn over: a `CloudTerrain`'s Earth map, and which drawing of it. */
export type CloudMapTerrain = { texture: Texture; version: number };

/** The key the cloud maps for `seed` over `terrain` share, at any time. */
export const cloudMapKey = (seed: number, terrain: CloudMapTerrain | null) =>
  terrain ? `${seed}:${terrain.texture.uuid}:${terrain.version}` : `${seed}`;

/** The strips a cloud map is drawn in (`bakeCloudMap`): the wind's six faces, then the cloud's. */
export const CLOUD_MAP_STRIPS = STRIPS;

type Shared = {
  flowGenerator: Mesh;
  generator: Mesh;
  typesGenerator: Mesh;
  maps: Map<string, CloudMap & { users: number }>;
};

const shared = new WeakMap<WebGLRenderer, Shared>();

function createMap(
  seed: number,
  terrain: CloudMapTerrain | null,
  time: number,
  own: Shared,
) {
  const target = new WebGLCubeRenderTarget(CLOUD_MAP_SIZE, {
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
  });
  const typesTarget = new WebGLCubeRenderTarget(CLOUD_TYPE_MAP_SIZE, {
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
  });
  const flow = new WebGLCubeRenderTarget(FLOW_SIZE, {
    format: RGBAFormat,
    type: HalfFloatType,
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  return {
    target,
    texture: target.texture,
    typesTarget,
    types: typesTarget.texture,
    flow,
    seed,
    time,
    terrain: terrain?.texture ?? null,
    key: `${cloudMapKey(seed, terrain)}@${time}`,
    base: cloudMapKey(seed, terrain),
    systems: weatherSystemCentresAt(seed, time),
    generators: [own.flowGenerator, own.generator, own.typesGenerator],
    strips: 0,
    get ready() {
      return this.strips >= STRIPS;
    },
    users: 0,
  };
}

const createGenerator = (
  name: string,
  shader: string,
  uniforms: Record<string, Uniform>,
  defines: Record<string, number> = {},
) => {
  const material = new ShaderMaterial({
    name,
    vertexShader,
    fragmentShader: shader,
    defines,
    uniforms: {
      uMapFace: new Uniform(0),
      uMapSize: new Uniform(1),
      uMapSeed: new Uniform(0),
      ...uniforms,
    },
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  });
  const mesh = new Mesh(createSceneryGeometry(), material);
  mesh.frustumCulled = false;
  return mesh;
};

/**
 * `renderer`'s cloud map for `seed` over `terrain` at the weather's `time`, made (not drawn yet)
 * the first time: let go with {@link releaseCloudMap}.
 */
export function acquireCloudMap(
  renderer: WebGLRenderer,
  seed: number,
  terrain: CloudMapTerrain | null = null,
  time = 0,
): CloudMap {
  let own = shared.get(renderer);
  if (!own) {
    own = {
      flowGenerator: createGenerator(
        'scenery-cloud-map-flow',
        flowShader,
        {
          uMapSystems: new Uniform(
            Array.from({ length: WEATHER_SYSTEM_COUNT }, () => new Vector4()),
          ),
          uMapSystemCount: new Uniform(0),
        },
        { MAP_SYSTEMS: WEATHER_SYSTEM_COUNT },
      ),
      generator: createGenerator('scenery-cloud-map', fragmentShader, {
        uMapFlow: new Uniform<CubeTexture | null>(null),
        uMapTerrain: new Uniform<Texture | null>(null),
        uMapTerrainOn: new Uniform(0),
      }),
      typesGenerator: createGenerator(
        'scenery-cloud-map-types',
        fragmentShader,
        {
          uMapFlow: new Uniform<CubeTexture | null>(null),
          uMapTerrain: new Uniform<Texture | null>(null),
          uMapTerrainOn: new Uniform(0),
        },
        { CLOUD_MAP_TYPES: 1 },
      ),
      maps: new Map(),
    };
    shared.set(renderer, own);
  }
  const key = `${cloudMapKey(seed, terrain)}@${time}`;
  let map = own.maps.get(key);
  if (!map) {
    map = createMap(seed, terrain, time, own);
    own.maps.set(key, map);
  }
  map.users++;
  return map;
}

/** Let go of `map`: disposed of once nothing else holds it, and the generators with the last. */
export function releaseCloudMap(renderer: WebGLRenderer, map: CloudMap) {
  const own = shared.get(renderer);
  const held = own?.maps.get(map.key);
  if (!own || !held || --held.users > 0) return;
  own.maps.delete(map.key);
  held.target.dispose();
  held.typesTarget.dispose();
  held.flow.dispose();
  if (own.maps.size > 0) return;
  shared.delete(renderer);
  for (const generator of [
    own.flowGenerator,
    own.generator,
    own.typesGenerator,
  ]) {
    generator.geometry.dispose();
    (generator.material as ShaderMaterial).dispose();
  }
}

// The systems as the wind's pass takes them: each one's centre (unit, fixed on the Earth) times
// its radius (radians), and its pressure.
function setSystems(
  uniforms: ShaderMaterial['uniforms'],
  systems: readonly WeatherSystemCentre[],
) {
  const values = uniforms.uMapSystems.value as Vector4[];
  const count = Math.min(systems.length, values.length);
  for (let i = 0; i < count; i++) {
    const { latitude, longitude, pressure, radius } = systems[i];
    const r = radius / EARTH_KM;
    values[i].set(
      Math.cos(latitude * DEG) * Math.cos(longitude * DEG) * r,
      Math.cos(latitude * DEG) * Math.sin(longitude * DEG) * r,
      Math.sin(latitude * DEG) * r,
      pressure,
    );
  }
  uniforms.uMapSystemCount.value = count;
}

const scene = new Scene();
const camera = new Camera();

/**
 * Draw up to `strips` more strips of `map` with `renderer`: the wind's faces first, a face a
 * strip, then the cloud map's a face's rows at a time, and its mipmaps after the last. Whether it
 * is all drawn. May be called while `renderer` draws a scene: its target and settings are left as
 * they were.
 */
export function bakeCloudMap(
  renderer: WebGLRenderer,
  map: CloudMap,
  strips = 1,
): boolean {
  if (map.ready) return true;
  const outer = renderer.getRenderTarget();
  const cubeFace = renderer.getActiveCubeFace();
  const mipLevel = renderer.getActiveMipmapLevel();
  const autoClear = renderer.autoClear;
  const autoReset = renderer.info.autoReset;
  const shadows = renderer.shadowMap.autoUpdate;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.shadowMap.autoUpdate = false;

  const [flowGenerator, generator, typesGenerator] = map.generators;
  const flowUniforms = (flowGenerator.material as ShaderMaterial).uniforms;
  const uniforms = (generator.material as ShaderMaterial).uniforms;
  const typesUniforms = (typesGenerator.material as ShaderMaterial).uniforms;
  flowUniforms.uMapSeed.value = map.seed;
  flowUniforms.uMapSize.value = FLOW_SIZE;
  setSystems(flowUniforms, map.systems);
  for (const [u, size] of [
    [uniforms, CLOUD_MAP_SIZE],
    [typesUniforms, CLOUD_TYPE_MAP_SIZE],
  ] as const) {
    u.uMapSeed.value = map.seed;
    u.uMapSize.value = size;
    u.uMapFlow.value = map.flow.texture;
    u.uMapTerrain.value = map.terrain;
    u.uMapTerrainOn.value = map.terrain ? 1 : 0;
  }
  const { target, typesTarget } = map;
  const perFace = CLOUD_MAP_SIZE / STRIP_ROWS;
  // The type map's rows a strip of the cloud map's spans.
  const typeRows = (STRIP_ROWS * CLOUD_TYPE_MAP_SIZE) / CLOUD_MAP_SIZE;
  for (let n = 0; n < strips && map.strips < STRIPS; n++, map.strips++) {
    if (map.strips < 6) {
      const face = map.strips;
      flowUniforms.uMapFace.value = face;
      scene.add(flowGenerator);
      renderer.setRenderTarget(map.flow, face);
      renderer.render(scene, camera);
      scene.remove(flowGenerator);
      continue;
    }
    const strip = map.strips - 6;
    const face = Math.floor(strip / perFace);
    const row = (strip % perFace) * STRIP_ROWS;
    // Their mipmaps once, after the last strip.
    const last = map.strips === STRIPS - 1;
    uniforms.uMapFace.value = face;
    target.scissor.set(0, row, CLOUD_MAP_SIZE, STRIP_ROWS);
    target.scissorTest = true;
    target.texture.generateMipmaps = last;
    scene.add(generator);
    renderer.setRenderTarget(target, face);
    renderer.render(scene, camera);
    scene.remove(generator);
    // The same rows of the type map.
    typesUniforms.uMapFace.value = face;
    typesTarget.scissor.set(
      0,
      (row * CLOUD_TYPE_MAP_SIZE) / CLOUD_MAP_SIZE,
      CLOUD_TYPE_MAP_SIZE,
      typeRows,
    );
    typesTarget.scissorTest = true;
    typesTarget.texture.generateMipmaps = last;
    scene.add(typesGenerator);
    renderer.setRenderTarget(typesTarget, face);
    renderer.render(scene, camera);
    scene.remove(typesGenerator);
  }
  target.texture.generateMipmaps = false;
  target.scissorTest = false;
  typesTarget.texture.generateMipmaps = false;
  typesTarget.scissorTest = false;

  renderer.setRenderTarget(outer, cubeFace, mipLevel);
  renderer.autoClear = autoClear;
  renderer.info.autoReset = autoReset;
  renderer.shadowMap.autoUpdate = shadows;
  return map.ready;
}
