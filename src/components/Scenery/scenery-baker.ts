import {
  Color,
  CubeCamera,
  CustomBlending,
  HalfFloatType,
  IUniform,
  Material,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphericalHarmonics3,
  Texture,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { precompile, PrecompileOptions } from '../../rendering/precompile';
import { readFloatTargetAsync } from '../../sdk/utils/read-target-async';
import { cubeFacesToSphericalHarmonics } from '../../sdk/utils/spherical-harmonics';
import { oceanWhitecapCover } from '../Ocean/ocean-material';
import skyVertexShader from './shaders/sky-vertex.glsl';
import bakeFragmentShader from './shaders/scenery-bake-fragment.glsl';
import { createSceneryGeometry, SceneryMaterial } from './scenery-material';
import {
  SCENERY_WATER_BAKE_DEPTH,
  ScenerySubsurfaceColors,
  SceneryZone,
} from './scenery-model';
import type { ScenerySkyOverlay } from './scenery-registry';

const PROBE_RESOLUTION = 32;
// A cube target's faces, read for the probe in this order (cubeFacesToSphericalHarmonics').
const CUBE_FACES = [0, 1, 2, 3, 4, 5];
// How far above the sea surface (or the abyss level) the air is filmed from, in world units.
const AIR_BAKE_HEIGHT = 100;
// The bake's zones, as its shader numbers them (uBakeZone).
const BAKE_ZONE: Record<SceneryZone, number> = {
  air: 0,
  water: 1,
  subsurface: 2,
};
// Over the zone's light.
const OVERLAY_ORDER = 2;

const overlayFragmentShader = /* glsl */ `
uniform samplerCube uOverlay;
uniform float uSkyIntensity;
varying vec3 vSkyDirection;
void main() {
  vec4 overlay = textureCube(uOverlay, normalize(vSkyDirection));
  if(overlay.a <= 0.0)
    discard;
  gl_FragColor = vec4(overlay.rgb * uSkyIntensity, overlay.a);
}`;

/**
 * Where the bakes film `zone` of the sky of `source` from (world): over the disc's centre,
 * some way over the sea's surface (or the abyss level) for the air, and some way under it for
 * the water. The subsurface's from the origin.
 */
export function sceneryBakePosition(
  source: SceneryMaterial,
  zone: SceneryZone,
  target: Vector3,
): Vector3 {
  if (zone === 'subsurface') return target.set(0, 0, 0);
  const level = source.ocean
    ? source.oceanLevel
    : source.abyss
      ? source.abyssLevel
      : 0;
  const height =
    zone === 'water'
      ? level - SCENERY_WATER_BAKE_DEPTH
      : level + AIR_BAKE_HEIGHT;
  return target.copy(source.up).multiplyScalar(height);
}

/**
 * What lights the scene below the seabed: the subsurface's light panels, or a map of the
 * host's own (an equirectangular or cube texture, as for `scene.background`).
 */
export type SceneryBakerSubsurface =
  | { light: ScenerySubsurfaceColors }
  | { map: Texture };

type ZoneBake = {
  cube: WebGLCubeRenderTarget | null;
  prefiltered: WebGLRenderTarget | null;
};

// PMREMGenerator makes its prefilter material only with its first targets, privately, and
// the material `fromCubemap` copies the cube with on demand.
type PmremInternals = {
  _setSize?: (cubeSize: number) => void;
  _allocateTargets?: () => WebGLRenderTarget;
  _ggxMaterial?: Material | null;
  _blurMaterial?: Material | null;
  _cubemapMaterial?: Material | null;
};

const compileCamera = new PerspectiveCamera();

/**
 * Films the light of a {@link SceneryMaterial}'s sky into an environment map (for
 * `scene.environment`) and into light-probe coefficients, once per {@link SceneryZone}: the
 * air over its sea, the water in it, and the subsurface below its seabed. Every zone with one
 * small program (`scenery-bake-fragment.glsl`): the sky's own surface over a flat sea, the
 * water's light about Snell's window, the subsurface's panels. The light is smooth, so it
 * needs none of the background's programs, and is ready within moments. Internal to
 * {@link Scenery}.
 */
export class SceneryBaker {
  private readonly scene = new Scene();
  private readonly geometry = createSceneryGeometry();
  // The globe off: a flat sea under a level horizon, so climbing never needs a new bake (a few
  // degrees' drop barely changes the light). The field's light, as the scene's lights are: the
  // visible sky's is where the camera is (SceneryMaterial.fieldLight). Filled in before each
  // film.
  private readonly overrides = {
    uSkyCurvature: new Uniform(0),
    // ⚠️ Its w is the switch, and a Vector4's default w is 1: with it, the globe was on with
    // no radius, and the half of the bake's sea away from the sun lay in night (until
    // 2026-11-05).
    uGlobe: new Uniform(new Vector4(0, 0, 0, 0)),
    uSkySunColor: new Uniform(new Color()),
    uSkyDaylight: new Uniform(1),
    uSkyTwilight: new Uniform(new Vector2()),
    uSkyMoonlight: new Uniform(0),
  };
  // The bake's own (scenery-bake-fragment.glsl).
  private readonly own = {
    uBakeZone: new Uniform(0),
    uBakeSea: new Uniform(new Vector4()),
    uBakeFoamColor: new Uniform(new Color()),
    uBakeDepth: new Uniform(SCENERY_WATER_BAKE_DEPTH),
    uSubsurfaceTop: new Uniform(new Color()),
    uSubsurfaceBottom: new Uniform(new Color()),
    uSubsurfaceAbove: new Uniform(new Color()),
    uSubsurfaceBelow: new Uniform(new Color()),
  };
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
  // The host's own map for the subsurface, drawn as the scene's background instead.
  private subsurfaceMap: Texture | null = null;
  private readonly probeTarget = new WebGLCubeRenderTarget(PROBE_RESOLUTION, {
    type: HalfFloatType,
  });
  private readonly probeCamera = new CubeCamera(0.1, 10, this.probeTarget);
  private envCamera: CubeCamera | null = null;
  private readonly bakes: Record<SceneryZone, ZoneBake> = {
    air: { cube: null, prefiltered: null },
    water: { cube: null, prefiltered: null },
    subsurface: { cube: null, prefiltered: null },
  };
  private pmrem: PMREMGenerator | null = null;
  // Bumped by dispose(): a readback still in flight is then reading released targets.
  private generation = 0;
  // What draws itself in the sky, drawn over the air's bakes (setOverlay).
  private overlay: ScenerySkyOverlay | null = null;
  private readonly overlayMaterial = new ShaderMaterial({
    vertexShader: skyVertexShader,
    fragmentShader: overlayFragmentShader,
    uniforms: {
      uOverlay: new Uniform<Texture | null>(null),
      uSkyIntensity: new Uniform(1),
    },
    depthTest: false,
    depthWrite: false,
    // Premultiplied.
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
  private readonly overlayMesh = new Mesh(this.geometry, this.overlayMaterial);

  constructor(private readonly source: SceneryMaterial) {
    // The sky's uniform objects, so its setters drive the bakes too, but for the overrides.
    this.material = new ShaderMaterial({
      name: 'scenery-bake',
      vertexShader: skyVertexShader,
      fragmentShader: bakeFragmentShader,
      uniforms: {
        ...(source.uniforms as Record<string, IUniform>),
        ...this.overrides,
        ...this.own,
      },
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.overlayMaterial.uniforms.uSkyIntensity = source.uniforms.uSkyIntensity;
    this.overlayMesh.frustumCulled = false;
    this.overlayMesh.renderOrder = OVERLAY_ORDER;
    this.overlayMesh.visible = false;
    this.scene.add(this.mesh, this.overlayMesh);
  }

  /**
   * What draws itself in the sky (the 3D clouds): baked as seen from where the air is and drawn
   * over the sky in the bakes of the air from now on; null for none.
   */
  setOverlay(overlay: ScenerySkyOverlay | null) {
    this.overlay = overlay;
  }

  /** What the `'subsurface'` zone films from now on. */
  setSubsurface(subsurface: SceneryBakerSubsurface) {
    if ('map' in subsurface) {
      this.subsurfaceMap = subsurface.map;
      return;
    }
    this.subsurfaceMap = null;
    const own = this.own;
    own.uSubsurfaceTop.value.copy(subsurface.light.top);
    own.uSubsurfaceBottom.value.copy(subsurface.light.bottom);
    own.uSubsurfaceAbove.value.copy(subsurface.light.above);
    own.uSubsurfaceBelow.value.copy(subsurface.light.below);
  }

  /** A zone's last film, before prefiltering; `null` before the first. */
  cubeOf(zone: SceneryZone): Texture | null {
    return this.bakes[zone].cube?.texture ?? null;
  }

  /**
   * Compile what the bakes draw with, in the background where the browser can (see
   * `precompile`): its one small program, and with an environment of `resolution`, the
   * prefilter every environment bake takes. `track` gives each of its compiles an
   * `onProgress` (see `createPrecompileCount`). `null` when all is ready already.
   */
  precompile(
    renderer: WebGLRenderer,
    resolution: number | null,
    track?: () => PrecompileOptions['onProgress'],
  ): Promise<void> | null {
    const waits = [
      precompile(renderer, this.scene, compileCamera, this.scene, 'offscreen', {
        onProgress: track?.(),
      }),
      resolution === null
        ? null
        : this.precompilePmrem(renderer, resolution, track?.()),
    ].filter(wait => wait !== null);
    return waits.length > 0 ? Promise.all(waits).then(() => {}) : null;
  }

  private precompilePmrem(
    renderer: WebGLRenderer,
    resolution: number,
    onProgress?: PrecompileOptions['onProgress'],
  ) {
    this.pmrem ??= new PMREMGenerator(renderer);
    const pmrem = this.pmrem as unknown as PmremInternals;
    if (pmrem._setSize && pmrem._allocateTargets) {
      pmrem._setSize(resolution);
      // Its working target and material stay, for the bakes of this size.
      pmrem._allocateTargets().dispose();
    }
    // Made by three's own compile, for the target bound: one, as `fromCubemap` draws it.
    if (!pmrem._cubemapMaterial) {
      const previous = renderer.getRenderTarget();
      const face = renderer.getActiveCubeFace();
      const mipmap = renderer.getActiveMipmapLevel();
      renderer.setRenderTarget(this.probeTarget);
      this.pmrem.compileCubemapShader();
      renderer.setRenderTarget(previous, face, mipmap);
    }
    const materials = [
      pmrem._ggxMaterial ?? pmrem._blurMaterial,
      pmrem._cubemapMaterial,
    ].filter(material => !!material);
    if (materials.length === 0) return null;
    const scene = new Scene();
    for (const material of materials)
      scene.add(new Mesh(this.geometry, material));
    return precompile(renderer, scene, compileCamera, scene, 'offscreen', {
      onProgress,
    });
  }

  /** A zone's last environment map; `null` before the first. */
  environmentOf(zone: SceneryZone): Texture | null {
    return this.bakes[zone].prefiltered?.texture ?? null;
  }

  /** Film a zone and prefilter it. Its textures are reused until the resolution changes. */
  environment(
    renderer: WebGLRenderer,
    zone: SceneryZone,
    resolution: number,
  ): Texture {
    const bake = this.bakes[zone];
    if (!bake.cube || bake.cube.width !== resolution) {
      bake.cube?.dispose();
      bake.prefiltered?.dispose();
      bake.prefiltered = null;
      bake.cube = new WebGLCubeRenderTarget(resolution, {
        type: HalfFloatType,
      });
    }
    this.envCamera ??= new CubeCamera(0.1, 10, bake.cube);
    this.envCamera.renderTarget = bake.cube;
    this.film(renderer, zone, this.envCamera);
    this.pmrem ??= new PMREMGenerator(renderer);
    bake.prefiltered = this.pmrem.fromCubemap(
      bake.cube.texture,
      bake.prefiltered,
    );
    return bake.prefiltered.texture;
  }

  /**
   * Film a zone and project it to spherical harmonics; the readback is asynchronous (all six
   * faces behind one fence, without three's synchronous format queries: `readFloatTargetAsync`),
   * and resolves `null` if the baker is disposed meanwhile, or the bake is not finite. One at
   * a time: they share a target.
   */
  lightProbe(
    renderer: WebGLRenderer,
    zone: SceneryZone,
  ): Promise<SphericalHarmonics3 | null> {
    this.film(renderer, zone, this.probeCamera);
    const generation = this.generation;
    return readFloatTargetAsync(renderer, this.probeTarget, CUBE_FACES).then(
      pixels => {
        if (generation !== this.generation) return null;
        const sh = cubeFacesToSphericalHarmonics(pixels, PROBE_RESOLUTION);
        return sh.coefficients.every(
          c =>
            Number.isFinite(c.x) &&
            Number.isFinite(c.y) &&
            Number.isFinite(c.z),
        )
          ? sh
          : null;
      },
      error => {
        if (generation === this.generation) throw error;
        return null;
      },
    );
  }

  // A zone's light from where it is seen: the air with what draws itself in the sky
  // (setOverlay) over it, baked from there first.
  private film(renderer: WebGLRenderer, zone: SceneryZone, camera: CubeCamera) {
    const { source, overrides, own } = this;
    const field = source.fieldLight;
    overrides.uSkySunColor.value.copy(field.sunColor);
    overrides.uSkyDaylight.value = field.daylight;
    overrides.uSkyTwilight.value.set(source.sunTwilight, field.twilight);
    overrides.uSkyMoonlight.value = field.moonlight;
    own.uBakeZone.value = BAKE_ZONE[zone];
    // The sea's, as its water has them (linkOcean): none until linked.
    const sea = source.uniforms as Record<string, IUniform | undefined>;
    own.uBakeSea.value.set(
      source.ocean ? 1 : 0,
      sea.uReflectionIntensity?.value ?? 1,
      oceanWhitecapCover(
        sea.uWindSpeed?.value ?? 0,
        sea.uFoamAmount?.value ?? 0,
      ) * (sea.uFoamLook?.value?.y ?? 1),
      source.oceanWater ? 1 : 0,
    );
    if (sea.uFoamColor) own.uBakeFoamColor.value.copy(sea.uFoamColor.value);
    const map = zone === 'subsurface' ? this.subsurfaceMap : null;
    this.scene.background = map;
    this.mesh.visible = map === null;
    sceneryBakePosition(source, zone, camera.position);
    const overlay = zone === 'air' ? this.overlay : null;
    this.overlayMesh.visible = overlay !== null;
    if (overlay) {
      overlay.bake(renderer, camera.position);
      this.overlayMaterial.uniforms.uOverlay.value = overlay.texture;
    }
    camera.update(renderer, this.scene);
  }

  /**
   * Dispose of everything it holds; its own materials through `release` (default
   * `dispose`), such as `releaseMaterial`, so none goes while its program still links.
   */
  dispose(release: (material: Material) => void = m => m.dispose()) {
    this.generation++;
    this.geometry.dispose();
    release(this.material);
    release(this.overlayMaterial);
    this.probeTarget.dispose();
    for (const bake of Object.values(this.bakes)) {
      bake.cube?.dispose();
      bake.prefiltered?.dispose();
    }
    this.pmrem?.dispose();
  }
}
