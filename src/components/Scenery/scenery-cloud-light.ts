import {
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Texture,
  Uniform,
  Vector2,
  Vector4,
  WebGLArrayRenderTarget,
  WebGLRenderer,
} from 'three';
import { createSceneryGeometry } from './scenery-material';

// Texels a side at most: some 200 m over a weather of 100 km's radius.
const SIZE_MOST = 1024;
// Texels drawn a frame, all levels together: a map of SIZE_MOST a side in 16 frames a level.
const TEXELS_A_FRAME = 65536;
// The newer drawing fades in over this long (wall seconds), so the light never steps.
const FADE = 0.5;

/** The stretches along each texel's ray toward the light (the shader's CLOUD_LIGHT_STEPS). */
export const CLOUD_LIGHT_STEPS = 16;

/** What a {@link CloudLightMap} is drawn from, frame by frame. */
export type CloudLightMapInputs = {
  /** the levels drawn (a layer each) */
  levels: number;
  /** the map's half-width on the field about the weather's middle (m) */
  half: number;
  /** the texel wanted (m): the finest level's cover texel */
  texel: number;
  /** everything it is drawn from but the clock: drawn anew once it changes */
  key: string;
  /** the weather's clock (s) */
  time: number;
  /** drawn anew after the clock has run on this far (weather seconds): the clouds form and fade */
  refresh: number;
  /** each level's wind on the field: the way it blows toward (east, north) times its speed (m/s) */
  winds: readonly Vector2[];
};

// What a map holds: what it was drawn from, at what time, and its size.
type Held = {
  key: string;
  time: number;
  size: number;
  levels: number;
  half: number;
};

const camera = new OrthographicCamera();

/**
 * The light maps of a local weather's 3D clouds (`CloudVolumeRenderer`): for each level, how much
 * of its cloud lies toward the light from anywhere in its shell, so a point of the march is lit
 * by a read of it rather than by marching toward the light (cloud-volume-march.glsl,
 * `cloudLightFromMap`). A layer a level, on the field over the weather's disc, fixed on the
 * Earth: it never depends on where the camera is. Drawn by the march's own program
 * (`CLOUD_LIGHT_MAP`), so it holds the cloud the march draws: a ray toward the light a texel,
 * from where it leaves the level's base, its optical depth from four heights up to the top.
 *
 * Two drawings: the one shown, and the next, drawn a few rows a frame (TEXELS_A_FRAME), then
 * faded in over FADE. A new one once what it is drawn from changes (`key`: the settings, the
 * light's way, the ground) or the clock has run on (`refresh`: the clouds form and fade); each
 * read where the wind has carried its clouds since its time, and its rows drawn over several
 * frames all of that time, so drift costs nothing.
 */
export class CloudLightMap {
  /** the march's own uniforms for it */
  readonly uniforms = {
    uCloudLightNewer: new Uniform<Texture | null>(null),
    uCloudLightOlder: new Uniform<Texture | null>(null),
    uCloudLightArea: new Uniform(new Vector4(0, 0, 1, 1)),
    uCloudLightFade: new Uniform(1),
    uCloudLightDrift: new Uniform<Vector2[]>([]),
    uCloudLightMode: new Uniform(0),
  };
  /** Counts what the march reads of it changing: drawn anew, or faded on. */
  version = 0;
  private material: ShaderMaterial | null = null;
  private mesh: Mesh | null = null;
  private readonly scene = new Scene();
  private readonly targets: (WebGLArrayRenderTarget | null)[] = [null, null];
  private readonly held: (Held | null)[] = [null, null];
  // The one shown (-1 none), the one fading out (-1 none), and since when the newer fades in.
  private newer = -1;
  private older = -1;
  private fadeStart = 0;
  // The drawing under way: into which target, of what, and how far it has come.
  private drawing:
    | (Held & { target: number; layer: number; row: number })
    | null = null;

  constructor(levels: number) {
    this.uniforms.uCloudLightDrift.value = Array.from(
      { length: 2 * levels },
      () => new Vector2(),
    );
  }

  /**
   * What draws it: the march's program as `CLOUD_LIGHT_MAP`, its uniforms the march's own (made
   * once, for `march`); compile it before it draws.
   */
  generator(march: ShaderMaterial): Mesh {
    if (!this.mesh) {
      // A local weather's alone: never a global one's.
      const defines = { ...march.defines };
      delete defines.CLOUD_GLOBAL;
      this.material = new ShaderMaterial({
        name: 'scenery-cloud-light-map',
        vertexShader: march.vertexShader,
        fragmentShader: march.fragmentShader,
        defines: { ...defines, CLOUD_LIGHT_MAP: '', CLOUD_LIGHT_STEPS },
        uniforms: {
          ...march.uniforms,
          uCloudLightLevel: new Uniform(0),
          uCloudLightShift: new Uniform(new Vector2()),
        },
        depthTest: false,
        depthWrite: false,
        blending: NoBlending,
      });
      this.mesh = new Mesh(createSceneryGeometry(), this.material);
      this.mesh.frustumCulled = false;
    }
    return this.mesh;
  }

  /**
   * Draw on with `renderer` for `inputs` (null: none, as in a global weather), and set what the
   * march reads. Within the scene's draw, after the march's uniforms are set for the frame: it
   * draws with them. `renderer`'s target is left as it was.
   */
  update(renderer: WebGLRenderer, inputs: CloudLightMapInputs | null) {
    const u = this.uniforms;
    if (!inputs || !this.material) {
      this.set(u.uCloudLightMode, 0);
      return;
    }
    const size = Math.min(
      SIZE_MOST,
      Math.max(64, Math.ceil((2 * inputs.half) / inputs.texel / 64) * 64),
    );
    const want = {
      key: inputs.key,
      size,
      levels: inputs.levels,
      half: inputs.half,
    };
    const same = (held: Held | null) =>
      !!held &&
      held.key === want.key &&
      held.size === want.size &&
      held.levels === want.levels &&
      held.half === want.half;
    const shown = this.newer >= 0 ? this.held[this.newer] : null;
    const fading = this.fadeShare() < 1;
    // A drawing begun, or begun again for what it is drawn from now.
    if (this.drawing && !same(this.drawing)) this.drawing = null;
    if (
      !this.drawing &&
      !fading &&
      (!same(shown) || Math.abs(inputs.time - shown!.time) > inputs.refresh)
    )
      this.drawing = {
        ...want,
        time: inputs.time,
        target: this.newer === 0 ? 1 : 0,
        layer: 0,
        row: 0,
      };
    if (this.drawing) this.draw(renderer, inputs);

    // What the march reads: the newer faded in over the older, each where the wind has carried
    // its clouds since it was drawn.
    const newer = this.newer >= 0 ? this.held[this.newer] : null;
    if (!newer) {
      this.set(u.uCloudLightMode, 0);
      return;
    }
    let share = this.fadeShare();
    if (share >= 1 && this.older >= 0) this.older = -1;
    const older = this.older >= 0 ? this.held[this.older] : null;
    if (!older) share = 1;
    this.set(u.uCloudLightMode, 1);
    this.set(u.uCloudLightFade, share);
    const newerTexture = this.targets[this.newer]!.texture;
    if (u.uCloudLightNewer.value !== newerTexture) {
      u.uCloudLightNewer.value = newerTexture;
      this.version++;
    }
    const olderTexture = older
      ? this.targets[this.older]!.texture
      : newerTexture;
    if (u.uCloudLightOlder.value !== olderTexture) {
      u.uCloudLightOlder.value = olderTexture;
      this.version++;
    }
    u.uCloudLightArea.value.set(0, 0, newer.half, newer.size);
    const drift = u.uCloudLightDrift.value;
    inputs.winds.forEach((wind, k) => {
      drift[2 * k]?.copy(wind).multiplyScalar(inputs.time - newer.time);
      drift[2 * k + 1]
        ?.copy(wind)
        .multiplyScalar(inputs.time - (older ?? newer).time);
    });
  }

  // How far the newer has faded in, 0 to 1.
  private fadeShare(): number {
    if (this.older < 0) return 1;
    return Math.min((performance.now() / 1000 - this.fadeStart) / FADE, 1);
  }

  private set(uniform: Uniform<number>, value: number) {
    if (uniform.value === value) return;
    uniform.value = value;
    this.version++;
  }

  // TEXELS_A_FRAME more of the drawing under way, its layers one after another; once done, shown,
  // fading in over the one before.
  private draw(renderer: WebGLRenderer, inputs: CloudLightMapInputs) {
    const drawing = this.drawing!;
    const material = this.material!;
    const target = this.target(drawing.target, drawing.size, drawing.levels);
    const outer = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    this.scene.add(this.mesh!);
    const level = material.uniforms.uCloudLightLevel;
    const shift = material.uniforms.uCloudLightShift.value as Vector2;
    let left = Math.max(Math.floor(TEXELS_A_FRAME / drawing.size), 1);
    while (left > 0 && drawing.layer < drawing.levels) {
      const rows = Math.min(left, drawing.size - drawing.row);
      level.value = drawing.layer;
      // Where the clouds of the drawing's time lie now.
      shift
        .copy(inputs.winds[drawing.layer] ?? shift.set(0, 0))
        .multiplyScalar(inputs.time - drawing.time);
      const last =
        drawing.layer === drawing.levels - 1 &&
        drawing.row + rows >= drawing.size;
      target.texture.generateMipmaps = last;
      target.scissor.set(0, drawing.row, drawing.size, rows);
      target.scissorTest = true;
      renderer.setRenderTarget(target, drawing.layer);
      renderer.render(this.scene, camera);
      target.texture.generateMipmaps = false;
      drawing.row += rows;
      left -= rows;
      if (drawing.row >= drawing.size) {
        drawing.row = 0;
        drawing.layer++;
      }
    }
    target.scissorTest = false;
    this.scene.remove(this.mesh!);
    renderer.setRenderTarget(outer, cubeFace, mipLevel);
    renderer.autoClear = autoClear;
    renderer.info.autoReset = autoReset;
    if (drawing.layer < drawing.levels) return;

    const index = drawing.target;
    const held: Held = {
      key: drawing.key,
      time: drawing.time,
      size: drawing.size,
      levels: drawing.levels,
      half: drawing.half,
    };
    this.held[index] = held;
    const before = this.newer >= 0 ? this.held[this.newer] : null;
    // Faded in over the one before, where they are alike enough to.
    this.older =
      before &&
      before.size === held.size &&
      before.half === held.half &&
      before.levels === held.levels
        ? this.newer
        : -1;
    this.newer = index;
    this.fadeStart = performance.now() / 1000;
    this.drawing = null;
    this.version++;
  }

  // The `index`th target, `size` texels a side and `levels` deep, made anew if it is not.
  private target(
    index: number,
    size: number,
    levels: number,
  ): WebGLArrayRenderTarget {
    let target = this.targets[index];
    if (
      target &&
      (target.width !== size ||
        target.height !== size ||
        target.depth !== levels)
    ) {
      target.dispose();
      target = null;
      this.held[index] = null;
    }
    if (!target) {
      target = new WebGLArrayRenderTarget(size, size, levels, {
        type: HalfFloatType,
        format: RGBAFormat,
        minFilter: LinearMipmapLinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
      this.targets[index] = target;
    }
    return target;
  }

  /** Let go of its maps, and its generator's material through `release` (default `dispose`). */
  dispose(release?: (material: ShaderMaterial) => void) {
    for (const target of this.targets) target?.dispose();
    this.targets.fill(null);
    this.held.fill(null);
    this.newer = this.older = -1;
    this.drawing = null;
    this.mesh?.geometry.dispose();
    if (this.material) {
      if (release) release(this.material);
      else this.material.dispose();
    }
    this.material = null;
    this.mesh = null;
  }
}
