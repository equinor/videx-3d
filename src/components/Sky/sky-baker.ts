import {
  BufferGeometry,
  Color,
  CubeCamera,
  DirectionalLight,
  HalfFloatType,
  IUniform,
  LightProbe,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphericalHarmonics3,
  Texture,
  Uniform,
  UniformsLib,
  UniformsUtils,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator.js';
import skyVertexShader from './shaders/sky-vertex.glsl';
import studioFragmentShader from './shaders/studio-fragment.glsl';
import {
  createSkyGeometry,
  SKY_SHARED_DEFINES,
  SkyMaterial,
} from './sky-material';
import { SKY_WATER_BAKE_DEPTH, SkyStudioColors, SkyZone } from './sky-model';
import { createSkySurfaceMaterial } from './sky-stage';

const PROBE_RESOLUTION = 32;
// How far above the sea surface (or the abyss level) the air is filmed from, in world units.
const AIR_BAKE_HEIGHT = 100;

/** The sun a {@link SkyBaker} lights the seabed with: as the sky's directional light. */
export type SkyBakerSun = {
  direction: Vector3;
  color: Color;
  intensity: number;
};

/**
 * What lights the scene below the seabed: a studio, or a map of the host's own (an
 * equirectangular or cube texture, as for `scene.background`).
 */
export type SkySubsurface = { studio: SkyStudioColors } | { map: Texture };

type ZoneBake = {
  cube: WebGLCubeRenderTarget | null;
  prefiltered: WebGLRenderTarget | null;
};

/**
 * Films a {@link SkyMaterial} into an environment map (for `scene.environment`) and into
 * light-probe coefficients, once per {@link SkyZone}: the air over its sea, the water in
 * it, and the studio below its seabed. Internal to {@link Sky}.
 */
export class SkyBaker {
  private readonly scene = new Scene();
  private readonly geometry = createSkyGeometry();
  private readonly material = new SkyMaterial({ fog: false });
  // No disc: the directional light is the sun. No stage: the light comes off the whole sea.
  // Never drained or buried, and nothing cut away: the zones are the sea's own.
  // Lights of its own: three wires a material's light uniforms to the scene it is drawn in.
  private readonly overrides: Record<string, IUniform> = {
    uSkySunDisc: new Uniform(0),
    uSkyOceanStageReach: new Uniform(0),
    uSkyOceanDrained: new Uniform(0),
    uSkyOceanBuried: new Uniform(0),
    uSkyOceanCutawayShape: new Uniform(new Vector4(0, 0, 0, 1)),
    uSkyDebug: new Uniform(0),
    ...UniformsUtils.clone(UniformsLib.lights),
  };
  // The seabed is lit as the scene lights it; the probe is the previous bake's.
  private readonly sun = new DirectionalLight();
  private readonly probe = new LightProbe();
  private surface: Mesh<BufferGeometry, ShaderMaterial> | null = null;
  private readonly studioScene = new Scene();
  private readonly studio: ShaderMaterial;
  private readonly studioMesh: Mesh;
  private readonly probeTarget = new WebGLCubeRenderTarget(PROBE_RESOLUTION, {
    type: HalfFloatType,
  });
  private readonly probeCamera = new CubeCamera(0.1, 10, this.probeTarget);
  private envCamera: CubeCamera | null = null;
  private readonly bakes: Record<SkyZone, ZoneBake> = {
    air: { cube: null, prefiltered: null },
    water: { cube: null, prefiltered: null },
    subsurface: { cube: null, prefiltered: null },
  };
  private pmrem: PMREMGenerator | null = null;
  // Bumped by dispose(): a readback still in flight is then reading released targets.
  private generation = 0;

  constructor(private readonly source: SkyMaterial) {
    // Same uniform objects as the visible sky, but for the overrides.
    this.material.uniforms = { ...source.uniforms, ...this.overrides };
    const mesh = new Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh, this.sun, this.probe);

    this.studio = new ShaderMaterial({
      vertexShader: skyVertexShader,
      fragmentShader: studioFragmentShader,
      uniforms: {
        uSkyUp: source.uniforms.uSkyUp,
        uSkyNorth: source.uniforms.uSkyNorth,
        uSkyEast: source.uniforms.uSkyEast,
        uStudioTop: new Uniform(new Color()),
        uStudioBottom: new Uniform(new Color()),
        uStudioAbove: new Uniform(new Color()),
        uStudioBelow: new Uniform(new Color()),
      },
      depthTest: false,
      depthWrite: false,
    });
    this.studioMesh = new Mesh(this.geometry, this.studio);
    this.studioMesh.frustumCulled = false;
    this.studioScene.add(this.studioMesh);
  }

  /** Light the seabed in the bakes with the sky's sun and light probe, `null` for none. */
  setLights(sun: SkyBakerSun | null, probe: LightProbe | null) {
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

  /** What the `'subsurface'` zone films from now on. */
  setSubsurface(subsurface: SkySubsurface) {
    if ('map' in subsurface) {
      this.studioScene.background = subsurface.map;
      this.studioMesh.visible = false;
      return;
    }
    this.studioScene.background = null;
    this.studioMesh.visible = true;
    const { uniforms } = this.studio;
    uniforms.uStudioTop.value.copy(subsurface.studio.top);
    uniforms.uStudioBottom.value.copy(subsurface.studio.bottom);
    uniforms.uStudioAbove.value.copy(subsurface.studio.above);
    uniforms.uStudioBelow.value.copy(subsurface.studio.below);
  }

  // Follows the visible sky's sea and abyss, which can change after this was made: its
  // switches, and the uniforms linkOcean adds.
  private sync() {
    const { source, material } = this;
    for (const name in source.uniforms) {
      if (!(name in this.overrides))
        material.uniforms[name] = source.uniforms[name];
    }
    material.abyss = source.abyss;
    material.ocean = source.ocean;
    material.clouds = source.clouds;
    let changed = false;
    for (const key of SKY_SHARED_DEFINES) {
      if (material.defines[key] === source.defines[key]) continue;
      if (source.defines[key] === undefined) delete material.defines[key];
      else material.defines[key] = source.defines[key];
      changed = true;
    }
    if (changed) material.needsUpdate = true;

    // From above the water, the sea surface is a layer of its own over the seabed.
    if (this.surface && (changed || !source.ocean)) {
      this.scene.remove(this.surface);
      this.surface.material.dispose();
      this.surface = null;
    }
    if (source.ocean && !this.surface) {
      this.surface = new Mesh(
        this.geometry,
        createSkySurfaceMaterial(material),
      );
      this.surface.frustumCulled = false;
      this.surface.renderOrder = 1;
      this.scene.add(this.surface);
    }
  }

  /** A zone's last film, before prefiltering; `null` before the first. */
  cubeOf(zone: SkyZone): Texture | null {
    return this.bakes[zone].cube?.texture ?? null;
  }

  /** A zone's last environment map; `null` before the first. */
  environmentOf(zone: SkyZone): Texture | null {
    return this.bakes[zone].prefiltered?.texture ?? null;
  }

  /** Film a zone and prefilter it. Its textures are reused until the resolution changes. */
  environment(
    renderer: WebGLRenderer,
    zone: SkyZone,
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
   * Film a zone and project it to spherical harmonics; the readback is asynchronous,
   * and resolves `null` if the baker is disposed meanwhile. One at a time: they share a
   * target.
   */
  lightProbe(
    renderer: WebGLRenderer,
    zone: SkyZone,
  ): Promise<SphericalHarmonics3 | null> {
    this.film(renderer, zone, this.probeCamera);
    const generation = this.generation;
    return LightProbeGenerator.fromCubeRenderTarget(
      renderer,
      this.probeTarget,
    ).then(
      probe => (generation === this.generation ? probe.sh : null),
      error => {
        if (generation === this.generation) throw error;
        return null;
      },
    );
  }

  // The sky from where its zone is seen, or the studio.
  private film(renderer: WebGLRenderer, zone: SkyZone, camera: CubeCamera) {
    if (zone === 'subsurface') {
      camera.position.set(0, 0, 0);
      camera.update(renderer, this.studioScene);
      return;
    }
    this.sync();
    const { source } = this;
    const level = source.ocean
      ? source.oceanLevel
      : source.abyss
        ? source.abyssLevel
        : 0;
    const height =
      zone === 'water' ? level - SKY_WATER_BAKE_DEPTH : level + AIR_BAKE_HEIGHT;
    camera.position.copy(source.up).multiplyScalar(height);
    camera.update(renderer, this.scene);
  }

  dispose() {
    this.generation++;
    this.geometry.dispose();
    this.material.dispose();
    this.surface?.material.dispose();
    this.studio.dispose();
    this.probeTarget.dispose();
    for (const bake of Object.values(this.bakes)) {
      bake.cube?.dispose();
      bake.prefiltered?.dispose();
    }
    this.pmrem?.dispose();
  }
}
