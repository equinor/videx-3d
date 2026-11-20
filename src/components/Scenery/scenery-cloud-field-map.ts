import {
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Material,
  Mesh,
  NoBlending,
  OrthographicCamera,
  RGBAFormat,
  RedFormat,
  Scene,
  ShaderMaterial,
  Texture,
  Uniform,
  Vector2,
  Vector4,
  WebGLArrayRenderTarget,
  WebGLRenderer,
} from 'three';
import { renderAside } from '../../sdk/utils/render-aside';
import { createSceneryGeometry } from './scenery-material';

// Texels a side at most: some 200 m over a weather of 100 km's radius.
const SIZE_MOST = 1024;
// The newer drawing fades in over this long (wall seconds), so what it holds never steps.
const FADE = 0.5;

/** What a {@link CloudFieldMap} is drawn from, frame by frame. */
export type CloudFieldMapInputs = {
  /** the levels drawn (a layer each) */
  levels: number;
  /** the map's half-width on the field about the weather's middle (m) */
  half: number;
  /** the texel wanted (m): the finest level's cover texel */
  texel: number;
  /** everything it is drawn from but the clock and the light: the drawing under way is dropped once it changes */
  key: string;
  /**
   * the light's way, for a map of the light: drawn anew once it changes, but the drawing under
   * way finishes first, so a light that keeps turning (a timelapse) is followed a drawing behind
   * rather than never
   */
  light?: string;
  /** the weather's clock (s) */
  time: number;
  /** drawn anew after the clock has run on this far (weather seconds): the clouds form and fade */
  refresh: number;
  /** each level's wind on the field: the way it blows toward (east, north) times its speed (m/s) */
  winds: readonly Vector2[];
};

/** What a {@link CloudFieldMap} holds, and how it is drawn. */
export type CloudFieldMapOptions = {
  /**
   * what it holds, naming the march's uniforms for it — `uCloud${name}Newer`, `Older`, `Area`,
   * `Fade`, `Drift`, `Mode` — and its program's — `uCloud${name}Level`, `Shift`, its own `Area`
   */
  name: 'Light' | 'Cover';
  /** the march's define that draws a texel of it (cloud-march.glsl) */
  define: string;
  /** more of its program's defines */
  defines?: Record<string, unknown>;
  /** its texels: RGBA, or red alone, in half floats */
  format: typeof RGBAFormat | typeof RedFormat;
  /** texels drawn a frame, all levels together */
  texelsAFrame: number;
  /** the most levels it holds */
  levels: number;
};

// What a map holds: what it was drawn from, at what time, and its size.
type Held = {
  key: string;
  light: string;
  time: number;
  size: number;
  levels: number;
  half: number;
};

const camera = new OrthographicCamera();

/**
 * A map of a local weather's 3D clouds (`CloudsRenderer`), a layer a level, on the field over
 * the weather's disc, fixed on the Earth: it never depends on where the camera is. Drawn by the
 * march's own program under `define`, so it holds what the march would read: the light toward
 * the light from each level's base (`Light`, cloud-march.glsl `cloudLightFromMap`), or each
 * column's mean cover (`Cover`, `cloudCoverOf`: one read of a 2D map for two of the 3D volume).
 *
 * Two drawings: the one shown, and the next, drawn a few rows a frame (`texelsAFrame`), then
 * faded in over FADE. A new one once what it is drawn from changes (`key`: the settings, the
 * ground; the drawing under way is dropped), the light's way does (`light`: the drawing under
 * way finishes first, so a light that keeps turning is followed a drawing behind), or the clock
 * has run on (`refresh`: the clouds form and fade). Each is read where the wind has carried its
 * clouds since its time, and its rows drawn over several frames all of that time, so drift costs
 * nothing. Until the first is drawn the march does without it (`uCloud${name}Mode` 0).
 *
 * Until 2026-11-18 the cover's map was drawn whole, every frame the clock moved (0.76 ms a frame
 * on an RTX A1000), and the light's first drawing, and one at a new size, was drawn over the
 * area of the drawing shown before it: its program now has an area of its own.
 */
export class CloudFieldMap {
  /** the march's own uniforms for it */
  readonly uniforms: Record<string, Uniform>;
  /** Counts what the march reads of it changing: drawn anew, or faded on. */
  version = 0;
  private readonly newerMap = new Uniform<Texture | null>(null);
  private readonly olderMap = new Uniform<Texture | null>(null);
  private readonly area = new Uniform(new Vector4(0, 0, 1, 1));
  private readonly fade = new Uniform(1);
  private readonly drift: Uniform<Vector2[]>;
  private readonly mode = new Uniform(0);
  // Its program's own: the drawing's area, the level drawn, and where the clouds of the
  // drawing's time lie now.
  private readonly drawArea = new Uniform(new Vector4(0, 0, 1, 1));
  private readonly drawLevel = new Uniform(0);
  private readonly drawShift = new Uniform(new Vector2());
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

  constructor(private readonly options: CloudFieldMapOptions) {
    const name = options.name;
    this.drift = new Uniform(
      Array.from({ length: 2 * options.levels }, () => new Vector2()),
    );
    this.uniforms = {
      [`uCloud${name}Newer`]: this.newerMap,
      [`uCloud${name}Older`]: this.olderMap,
      [`uCloud${name}Area`]: this.area,
      [`uCloud${name}Fade`]: this.fade,
      [`uCloud${name}Drift`]: this.drift,
      [`uCloud${name}Mode`]: this.mode,
    };
  }

  /** Whether the march reads it: a drawing is shown. */
  get shown(): boolean {
    return this.mode.value > 0;
  }

  /** Whether a drawing is under way. */
  get underway(): boolean {
    return this.drawing !== null;
  }

  /**
   * Drawn anew from the next {@link update} on, as if what it is drawn from had changed, the
   * one shown let go at once: to time a drawing whole (the debug benches).
   */
  restart() {
    this.drawing = null;
    this.older = -1;
    if (this.newer >= 0) this.held[this.newer] = null;
  }

  /**
   * What draws it: the march's program under `define`, its uniforms the march's own but for its
   * own area, level and shift (made once, for `march`); compile it before it draws.
   */
  generator(march: ShaderMaterial): Mesh {
    if (!this.mesh) {
      const { name, define } = this.options;
      // A local weather's alone: never a global one's.
      const defines = { ...march.defines };
      delete defines.CLOUD_GLOBAL;
      this.material = new ShaderMaterial({
        name: `scenery-cloud-${name.toLowerCase()}-map`,
        vertexShader: march.vertexShader,
        fragmentShader: march.fragmentShader,
        defines: { ...defines, [define]: '', ...this.options.defines },
        uniforms: {
          ...march.uniforms,
          [`uCloud${name}Area`]: this.drawArea,
          [`uCloud${name}Level`]: this.drawLevel,
          [`uCloud${name}Shift`]: this.drawShift,
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
  update(renderer: WebGLRenderer, inputs: CloudFieldMapInputs | null) {
    if (!inputs || !this.material || inputs.levels === 0) {
      this.set(this.mode, 0);
      return;
    }
    const size = Math.min(
      SIZE_MOST,
      Math.max(64, Math.ceil((2 * inputs.half) / inputs.texel / 64) * 64),
    );
    const want = {
      key: inputs.key,
      light: inputs.light ?? '',
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
    // A drawing begun, or begun again for what it is drawn from now; one for an earlier light
    // finishes.
    if (this.drawing && !same(this.drawing)) this.drawing = null;
    if (
      !this.drawing &&
      !fading &&
      (!same(shown) ||
        shown!.light !== want.light ||
        Math.abs(inputs.time - shown!.time) > inputs.refresh)
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
      this.set(this.mode, 0);
      return;
    }
    let share = this.fadeShare();
    if (share >= 1 && this.older >= 0) this.older = -1;
    const older = this.older >= 0 ? this.held[this.older] : null;
    if (!older) share = 1;
    this.set(this.mode, 1);
    this.set(this.fade, share);
    const newerTexture = this.targets[this.newer]!.texture;
    if (this.newerMap.value !== newerTexture) {
      this.newerMap.value = newerTexture;
      this.version++;
    }
    const olderTexture = older
      ? this.targets[this.older]!.texture
      : newerTexture;
    if (this.olderMap.value !== olderTexture) {
      this.olderMap.value = olderTexture;
      this.version++;
    }
    this.area.value.set(0, 0, newer.half, newer.size);
    const drift = this.drift.value;
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

  // texelsAFrame more of the drawing under way, its layers one after another; once done, shown,
  // fading in over the one before.
  private draw(renderer: WebGLRenderer, inputs: CloudFieldMapInputs) {
    const drawing = this.drawing!;
    const target = this.target(drawing.target, drawing.size, drawing.levels);
    renderAside(renderer, () => {
      this.scene.add(this.mesh!);
      this.drawArea.value.set(0, 0, drawing.half, drawing.size);
      const shift = this.drawShift.value;
      let left = Math.max(
        Math.floor(this.options.texelsAFrame / drawing.size),
        1,
      );
      while (left > 0 && drawing.layer < drawing.levels) {
        const rows = Math.min(left, drawing.size - drawing.row);
        this.drawLevel.value = drawing.layer;
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
    });
    if (drawing.layer < drawing.levels) return;

    const index = drawing.target;
    const held: Held = {
      key: drawing.key,
      light: drawing.light,
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
        format: this.options.format,
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
  dispose(release?: (material: Material) => void) {
    for (const target of this.targets) target?.dispose();
    this.targets.fill(null);
    this.held.fill(null);
    this.newer = this.older = -1;
    this.drawing = null;
    this.mode.value = 0;
    this.mesh?.geometry.dispose();
    if (this.material) {
      if (release) release(this.material);
      else this.material.dispose();
    }
    this.material = null;
    this.mesh = null;
  }
}
