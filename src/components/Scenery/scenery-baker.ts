import {
  BufferGeometry,
  Color,
  CubeCamera,
  CustomBlending,
  DirectionalLight,
  HalfFloatType,
  IUniform,
  LightProbe,
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
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import {
  precompile,
  PRECOMPILE_PRIORITY,
  PrecompileOptions,
} from '../../rendering/precompile';
import { readFloatTargetAsync } from '../../sdk/utils/read-target-async';
import { cubeFacesToSphericalHarmonics } from '../../sdk/utils/spherical-harmonics';
import skyVertexShader from './shaders/sky-vertex.glsl';
import subsurfaceFragmentShader from './shaders/subsurface-fragment.glsl';
import { createSceneryGeometry, SceneryMaterial } from './scenery-material';
import {
  SCENERY_WATER_BAKE_DEPTH,
  ScenerySubsurfaceColors,
  SceneryZone,
} from './scenery-model';
import {
  createSceneryLayerMaterial,
  SCENERY_LAYER_ORDER,
  sceneryLayerDefines,
  sceneryLayers,
  SceneryOverLayer,
} from './scenery-layers';
import { sceneryOceanDefines } from './scenery-stage';
import type { ScenerySkyOverlay } from './scenery-registry';

const PROBE_RESOLUTION = 32;
// A cube target's faces, read for the probe in this order (cubeFacesToSphericalHarmonics').
const CUBE_FACES = [0, 1, 2, 3, 4, 5];
// How far above the sea surface (or the abyss level) the air is filmed from, in world units.
const AIR_BAKE_HEIGHT = 100;
// After every layer of the sky, the sea's surface the last (at 1).
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

/** The sun a {@link SceneryBaker} lights the seabed with: as the sky's directional light. */
export type SceneryBakerSun = {
  direction: Vector3;
  color: Color;
  intensity: number;
};

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
 * Films a {@link SceneryMaterial} into an environment map (for `scene.environment`) and into
 * light-probe coefficients, once per {@link SceneryZone}: the air over its sea, the water in
 * it, and the subsurface below its seabed. Internal to {@link Scenery}.
 */
export class SceneryBaker {
  private readonly scene = new Scene();
  private readonly geometry = createSceneryGeometry();
  // Fog as the visible sky has it, so the two share a program: this scene has none.
  private readonly material = new SceneryMaterial();
  // No disc: the directional light is the sun. No stage: the light comes off the whole sea.
  // Never buried nor in a trench, nothing cut away and the seabed whole: the zones are the sea's own.
  // A level horizon, so climbing never needs a new bake: a few degrees' drop barely changes the light.
  // Lights of its own: three wires a material's light uniforms to the scene it is drawn in.
  private readonly overrides: Record<string, IUniform> = {
    uSkySunDisc: new Uniform(0),
    uSkyOceanStageReach: new Uniform(0),
    uSkyOceanBuried: new Uniform(0),
    uSkyOceanTrench: new Uniform(0),
    uSkyOceanStageOpen: new Uniform(0),
    uSkyOceanCutawayShape: new Uniform(new Vector3()),
    uSkyOceanSeabedOpacity: new Uniform(1),
    // The seabed on and the hollow off: the bakes take the seabed whole, peeled or not, so
    // peeling it bakes nothing.
    uSkyOceanSeabed: new Uniform(1),
    uSkyHollow: new Uniform(new Vector4(0, 0, 0, 0)),
    uSkyCurvature: new Uniform(0),
    // The globe off: a flat sea, and the waves on the field's plane. ⚠️ Their w is the switch,
    // and a Vector4's default w is 1: with it, the globe was on with no radius, and the
    // half of the bake's sea away from the sun lay in night.
    uGlobe: new Uniform(new Vector4(0, 0, 0, 0)),
    uOceanCharts: new Uniform(new Vector4(0, 0, 0, 0)),
    uSkyDebug: new Uniform(0),
    // The field's light, as the scene's lights are: the visible sky's is where the camera
    // is (SceneryMaterial.fieldLight). Filled in before each film.
    uSkySunColor: new Uniform(new Color()),
    uSkyDaylight: new Uniform(1),
    uSkyTwilight: new Uniform(new Vector2()),
    uSkyMoonlight: new Uniform(0),
    uSkyNight: new Uniform(0),
    ...UniformsUtils.clone(UniformsLib.lights),
  };
  // The seabed is lit as the scene lights it; the probe is the previous bake's.
  private readonly sun = new DirectionalLight();
  private readonly probe = new LightProbe();
  // The background's layers over the sky (see sync), and what each was made from.
  private readonly layers = new Map<
    SceneryOverLayer,
    { key: string; mesh: Mesh<BufferGeometry, ShaderMaterial> }
  >();
  private readonly subsurfaceScene = new Scene();
  private readonly subsurface: ShaderMaterial;
  private readonly subsurfaceMesh: Mesh;
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
    // Same uniform objects as the visible sky, but for the overrides.
    this.material.uniforms = { ...source.uniforms, ...this.overrides };
    const mesh = new Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.overlayMaterial.uniforms.uSkyIntensity = source.uniforms.uSkyIntensity;
    this.overlayMesh.frustumCulled = false;
    this.overlayMesh.renderOrder = OVERLAY_ORDER;
    this.overlayMesh.visible = false;
    this.scene.add(mesh, this.sun, this.probe, this.overlayMesh);

    this.subsurface = new ShaderMaterial({
      vertexShader: skyVertexShader,
      fragmentShader: subsurfaceFragmentShader,
      uniforms: {
        uSkyUp: source.uniforms.uSkyUp,
        uSkyNorth: source.uniforms.uSkyNorth,
        uSkyEast: source.uniforms.uSkyEast,
        uSubsurfaceTop: new Uniform(new Color()),
        uSubsurfaceBottom: new Uniform(new Color()),
        uSubsurfaceAbove: new Uniform(new Color()),
        uSubsurfaceBelow: new Uniform(new Color()),
      },
      depthTest: false,
      depthWrite: false,
    });
    this.subsurfaceMesh = new Mesh(this.geometry, this.subsurface);
    this.subsurfaceMesh.frustumCulled = false;
    this.subsurfaceScene.add(this.subsurfaceMesh);
  }

  /** Light the seabed in the bakes with the sky's sun and light probe, `null` for none. */
  setLights(sun: SceneryBakerSun | null, probe: LightProbe | null) {
    this.sun.visible = sun !== null;
    if (sun) {
      this.sun.position.copy(sun.direction);
      this.sun.color.copy(sun.color);
      this.sun.intensity = sun.intensity;
    }
    this.probe.visible = probe !== null;
    if (probe) {
      this.probe.sh.copy(probe.sh);
      this.probe.intensity = probe.intensity;
    }
  }

  /**
   * What draws itself in the sky (the 3D clouds): filmed and drawn over the sky in the bakes
   * of the air from now on; null for none.
   */
  setOverlay(overlay: ScenerySkyOverlay | null) {
    this.overlay = overlay;
  }

  /** What the `'subsurface'` zone films from now on. */
  setSubsurface(subsurface: SceneryBakerSubsurface) {
    if ('map' in subsurface) {
      this.subsurfaceScene.background = subsurface.map;
      this.subsurfaceMesh.visible = false;
      return;
    }
    this.subsurfaceScene.background = null;
    this.subsurfaceMesh.visible = true;
    const { uniforms } = this.subsurface;
    uniforms.uSubsurfaceTop.value.copy(subsurface.light.top);
    uniforms.uSubsurfaceBottom.value.copy(subsurface.light.bottom);
    uniforms.uSubsurfaceAbove.value.copy(subsurface.light.above);
    uniforms.uSubsurfaceBelow.value.copy(subsurface.light.below);
  }

  // Follows the visible sky's sea and abyss, which can change after this was made: its
  // switches, and the uniforms linkOcean adds.
  private sync() {
    const { source, material } = this;
    for (const name in source.uniforms) {
      if (!(name in this.overrides))
        material.uniforms[name] = source.uniforms[name];
    }
    // In the visible sky's order too: a program is keyed on the order of its defines.
    if (JSON.stringify(material.defines) !== JSON.stringify(source.defines)) {
      material.defines = { ...source.defines };
      material.needsUpdate = true;
    }
    if (JSON.stringify(material.switches) !== JSON.stringify(source.switches)) {
      for (const key of Object.keys(material.switches))
        delete material.switches[key];
      Object.assign(material.switches, source.switches);
      material.switchesVersion++;
    }

    // The background's layers over the sky, as the visible sky draws them, each made again
    // only when what it compiles with changes.
    const wanted = new Set(sceneryLayers(material));
    for (const [layer, { mesh }] of this.layers) {
      if (
        wanted.has(layer) &&
        this.layerKey(layer) === this.layers.get(layer)!.key
      )
        continue;
      this.scene.remove(mesh);
      mesh.material.dispose();
      this.layers.delete(layer);
    }
    for (const layer of wanted) {
      if (layer === 'sky' || this.layers.has(layer)) continue;
      const mesh = new Mesh(
        this.geometry,
        createSceneryLayerMaterial(material, layer, false),
      );
      mesh.frustumCulled = false;
      mesh.renderOrder = SCENERY_LAYER_ORDER[layer];
      this.scene.add(mesh);
      this.layers.set(layer, { key: this.layerKey(layer), mesh });
    }
  }

  // What a layer's copy is made from (the surface's waves are its own).
  private layerKey(layer: SceneryOverLayer) {
    return layer === 'surface'
      ? JSON.stringify(sceneryOceanDefines(this.material))
      : JSON.stringify(sceneryLayerDefines(this.material, layer));
  }

  /** A zone's last film, before prefiltering; `null` before the first. */
  cubeOf(zone: SceneryZone): Texture | null {
    return this.bakes[zone].cube?.texture ?? null;
  }

  /**
   * Compile what the sky's bakes draw with, in the background where the browser can (see
   * `precompile`). Set the lights first: they are compiled in. `null` when all is ready
   * already.
   */
  precompile(
    renderer: WebGLRenderer,
    onProgress?: PrecompileOptions['onProgress'],
  ): Promise<void> | null {
    this.sync();
    return precompile(
      renderer,
      this.scene,
      compileCamera,
      this.scene,
      'offscreen',
      { priority: PRECOMPILE_PRIORITY.last, onProgress },
    );
  }

  /**
   * The same for the subsurface's bake — and with an environment of `resolution`, the
   * prefilter every environment bake takes. Small, so it is ready first. `track` gives
   * each of its compiles an `onProgress` (see `createPrecompileCount`).
   */
  precompileSubsurface(
    renderer: WebGLRenderer,
    resolution: number | null,
    track?: () => PrecompileOptions['onProgress'],
  ): Promise<void> | null {
    const waits = [
      precompile(
        renderer,
        this.subsurfaceScene,
        compileCamera,
        this.subsurfaceScene,
        'offscreen',
        { onProgress: track?.() },
      ),
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
   * and resolves `null` if the baker is disposed meanwhile, or the bake is not finite: a
   * probe lights the next bake's seabed, so one bad bake would poison every one after it.
   * One at a time: they share a target.
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

  // The sky from where its zone is seen, or the subsurface. The air with what draws itself in
  // the sky (setOverlay) over it, filmed from there first.
  private film(renderer: WebGLRenderer, zone: SceneryZone, camera: CubeCamera) {
    if (zone === 'subsurface') {
      camera.position.set(0, 0, 0);
      camera.update(renderer, this.subsurfaceScene);
      return;
    }
    this.sync();
    const { source, overrides } = this;
    const field = source.fieldLight;
    overrides.uSkySunColor.value.copy(field.sunColor);
    overrides.uSkyDaylight.value = field.daylight;
    overrides.uSkyTwilight.value.set(source.sunTwilight, field.twilight);
    overrides.uSkyMoonlight.value = field.moonlight;
    overrides.uSkyNight.value = field.night;
    sceneryBakePosition(source, zone, camera.position);
    const overlay = zone === 'air' ? this.overlay : null;
    this.overlayMesh.visible = overlay !== null;
    if (overlay) {
      overlay.film(renderer, camera.position);
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
    for (const { mesh } of this.layers.values()) release(mesh.material);
    this.subsurface.dispose();
    this.probeTarget.dispose();
    for (const bake of Object.values(this.bakes)) {
      bake.cube?.dispose();
      bake.prefiltered?.dispose();
    }
    this.pmrem?.dispose();
  }
}
