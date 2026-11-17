import {
  Color,
  type CubeTexture,
  CubeReflectionMapping,
  CubeRefractionMapping,
  CubeUVReflectionMapping,
  type DirectionalLight,
  EquirectangularReflectionMapping,
  EquirectangularRefractionMapping,
  Euler,
  Matrix3,
  Matrix4,
  type Object3D,
  PMREMGenerator,
  type Scene,
  type Texture,
  Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';

/**
 * The light a sky source shines: the direction toward it (world, normalised), its colour
 * with its intensity in it, and how much wider than the sun's disc its glint on water is
 * laid (a low sun's glitter path; 0 for none).
 *
 * @group Materials
 */
export type SceneSkySun = {
  direction: Vector3;
  color: Color;
  glintSpread: number;
};

/**
 * What a scene's sky looks like to what reflects it (the seas): its environment, the clouds
 * that draw themselves in it, and its sun. Filled by {@link SceneSky}.
 *
 * @group Materials
 */
export type SceneSkySource = {
  /** the sky all round, prefiltered (a PMREM, `CubeUVReflectionMapping`); null for none */
  environment: Texture | null;
  /** what {@link environment} is scaled by (`scene.environmentIntensity`) */
  intensity: number;
  /** world directions into {@link environment}'s (`scene.environmentRotation`, as three reads it) */
  rotation: Matrix3;
  /**
   * the clouds that draw themselves in the sky (a `Scenery`'s 3D clouds), sharper than
   * {@link environment} holds them, by world direction, premultiplied, with mipmaps; null for none
   */
  clouds: CubeTexture | null;
  /** those clouds' lowest base over the sea (world units): their bake is blurred by the height they are seen from over it */
  cloudBase: number;
  /** its light; null for none (a material keeps its own) */
  sun: SceneSkySun | null;
};

/** How often the scene is searched again for its sun, in milliseconds. */
export const SCENE_SKY_LIGHT_SEARCH = 500;

function emptySource(): SceneSkySource {
  return {
    environment: null,
    intensity: 1,
    rotation: new Matrix3(),
    clouds: null,
    cloudBase: 0,
    sun: null,
  };
}

/**
 * The defines three's `cube_uv_reflection_fragment` reads a prefiltered environment
 * (`CubeUVReflectionMapping`) `height` texels tall by, worked out as three works them out
 * for its own materials.
 *
 * @group Materials
 */
export function cubeUVSize(height: number): {
  texelWidth: number;
  texelHeight: number;
  maxMip: number;
} {
  const maxMip = Math.log2(height) - 2;
  return {
    texelWidth: 1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16)),
    texelHeight: 1 / height,
    maxMip,
  };
}

type Prefiltered = { target: WebGLRenderTarget; version: number };
const PREFILTERED = new WeakMap<WebGLRenderer, WeakMap<Texture, Prefiltered>>();

function isCube(texture: Texture): boolean {
  return (
    texture.mapping === CubeReflectionMapping ||
    texture.mapping === CubeRefractionMapping
  );
}

function isEquirect(texture: Texture): boolean {
  return (
    texture.mapping === EquirectangularReflectionMapping ||
    texture.mapping === EquirectangularRefractionMapping
  );
}

// Whether there is anything to prefilter yet: a loader hands the texture over before its
// image arrives.
function isLoaded(texture: Texture): boolean {
  if (texture.isRenderTargetTexture) return true;
  if (texture.version === 0) return false;
  const image = texture.image as
    | { width?: number }
    | ({ width?: number } | null)[]
    | null;
  if (Array.isArray(image))
    return image.length === 6 && image.every(face => !!face?.width);
  return !!image?.width;
}

/**
 * `texture` prefiltered for reflections (a PMREM, `CubeUVReflectionMapping`), as three
 * prefilters `scene.environment` for its own materials: itself if it is one already; an
 * equirectangular or cube map prefiltered once per `renderer` and kept until it is disposed,
 * again as its `version` changes. Null for any other texture, or one not loaded yet.
 *
 * ⚠️ Renders: call it before the frame is drawn, never from a draw (`onBeforeRender`). A cube
 * render target drawn again keeps its version: hand that one over prefiltered.
 *
 * @group Materials
 */
export function prefilteredEnvironment(
  renderer: WebGLRenderer,
  texture: Texture,
): Texture | null {
  if (texture.mapping === CubeUVReflectionMapping) return texture;
  const cube = isCube(texture);
  if (!cube && !isEquirect(texture)) return null;
  if (!isLoaded(texture)) return null;
  let cache = PREFILTERED.get(renderer);
  if (!cache) {
    cache = new WeakMap();
    PREFILTERED.set(renderer, cache);
  }
  const entry = cache.get(texture);
  if (entry && entry.version === texture.version) return entry.target.texture;
  const pmrem = new PMREMGenerator(renderer);
  const target = cube
    ? pmrem.fromCubemap(texture as CubeTexture, entry?.target ?? null)
    : pmrem.fromEquirectangular(texture, entry?.target ?? null);
  pmrem.dispose();
  if (entry) {
    entry.target = target;
    entry.version = texture.version;
  } else {
    const made: Prefiltered = { target, version: texture.version };
    cache.set(texture, made);
    const forget = () => {
      texture.removeEventListener('dispose', forget);
      made.target.dispose();
      cache.delete(texture);
    };
    texture.addEventListener('dispose', forget);
  }
  return target.texture;
}

const lightAt = new Vector3();
const rotationEuler = new Euler();
const rotationMatrix = new Matrix4();

function lightPower(light: DirectionalLight): number {
  const c = light.color;
  return light.intensity * (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);
}

function brightestLight(scene: Scene): DirectionalLight | null {
  const found: { light: DirectionalLight | null; power: number } = {
    light: null,
    power: 0,
  };
  scene.traverseVisible(o => {
    const light = o as DirectionalLight;
    if (!light.isDirectionalLight) return;
    const power = lightPower(light);
    if (power > found.power) {
      found.power = power;
      found.light = light;
    }
  });
  return found.light;
}

// Whether `object` is drawn: it and every parent up to the scene visible.
function isShown(object: Object3D, scene: Scene): boolean {
  let o: Object3D | null = object;
  while (o) {
    if (!o.visible) return false;
    if (o === scene) return true;
    o = o.parent;
  }
  return false;
}

/**
 * A scene's sky, for what reflects it (one per scene, {@link sceneSky}): the sky a `Scenery`
 * in it publishes ({@link claim}), else the scene's own — `scene.environment` prefiltered
 * ({@link prefilteredEnvironment}), and its brightest visible `DirectionalLight` — else none,
 * which leaves a reflecting material its own.
 *
 * @group Materials
 */
export class SceneSky {
  private owner: object | null = null;
  private readonly published = emptySource();
  private readonly own = emptySource();
  private readonly ownSun: SceneSkySun = {
    direction: new Vector3(0, 1, 0),
    color: new Color(1, 1, 1),
    glintSpread: 0,
  };
  private light: DirectionalLight | null = null;
  private searched = -Infinity;

  /** whether a `Scenery` publishes the sky ({@link claim}) */
  get claimed(): boolean {
    return this.owner !== null;
  }

  /**
   * Publish the sky for `owner` (a `Scenery`): the source returned is what the scene's seas
   * reflect until {@link release}d, written in place by its owner each frame. Another owner
   * takes it over.
   */
  claim(owner: object): SceneSkySource {
    if (this.owner !== owner) {
      this.owner = owner;
      Object.assign(this.published, emptySource());
    }
    return this.published;
  }

  /** Stop publishing the sky for `owner`; the scene's own is reflected again. */
  release(owner: object): void {
    if (this.owner === owner) this.owner = null;
  }

  /**
   * The sky the scene's seas reflect this frame: the published one while claimed, else the
   * scene's own. The same object each call, until it is claimed or released.
   *
   * ⚠️ May prefilter the scene's environment: before the frame is drawn
   * ({@link prefilteredEnvironment}).
   */
  resolve(
    renderer: WebGLRenderer,
    scene: Scene,
    now = performance.now(),
  ): SceneSkySource {
    if (this.owner) return this.published;
    const own = this.own;
    const environment = scene.environment
      ? prefilteredEnvironment(renderer, scene.environment)
      : null;
    own.environment = environment;
    own.intensity = scene.environmentIntensity ?? 1;
    if (environment) {
      // As three turns a render target's environment (WebGLMaterials).
      const r = scene.environmentRotation;
      rotationEuler.set(-r.x, -r.y, -r.z, r.order);
      own.rotation.setFromMatrix4(
        rotationMatrix.makeRotationFromEuler(rotationEuler),
      );
    }
    own.sun = this.sunOf(scene, now);
    return own;
  }

  // The brightest visible directional light's, searched for again now and then and as soon
  // as the one found goes.
  private sunOf(scene: Scene, now: number): SceneSkySun | null {
    if (
      !this.light ||
      !isShown(this.light, scene) ||
      now - this.searched >= SCENE_SKY_LIGHT_SEARCH
    ) {
      this.searched = now;
      this.light = brightestLight(scene);
    }
    const l = this.light;
    if (!l) return null;
    const sun = this.ownSun;
    l.updateWorldMatrix(true, false);
    l.target.updateWorldMatrix(true, false);
    sun.direction
      .setFromMatrixPosition(l.matrixWorld)
      .sub(lightAt.setFromMatrixPosition(l.target.matrixWorld));
    if (sun.direction.lengthSq() === 0) sun.direction.set(0, 1, 0);
    else sun.direction.normalize();
    sun.color.copy(l.color).multiplyScalar(l.intensity);
    return sun;
  }
}

const SCENE_SKY = new WeakMap<object, SceneSky>();

/**
 * The sky of a scene (one per scene): what the seas drawn in it reflect, and the sun their
 * glint is of ({@link SceneSky}). A `Scenery` publishes its own; without one, the scene's
 * environment and brightest directional light.
 *
 * @group Materials
 */
export function sceneSky(scene: object): SceneSky {
  let sky = SCENE_SKY.get(scene);
  if (!sky) {
    sky = new SceneSky();
    SCENE_SKY.set(scene, sky);
  }
  return sky;
}
