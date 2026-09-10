import {
  Color,
  DataTexture,
  FloatType,
  MeshBasicMaterialParameters,
  NearestFilter,
  RGBAFormat,
  ShaderLib,
  ShaderMaterial,
  Texture,
  Uniform,
  UniformsUtils,
  Vector2,
  WebGLRenderer,
} from 'three';
import { attachOitVariants } from '../../../rendering/oit-material';
import { TrajectoryColorInterval } from './trajectory-defs';

// Own fragment (reworked from the SDK tube fragment): rim shading + analytic edge AA,
// distance fade left to scene fog (no distance darkening / no distance opacity), and
// no texture-map / vertex-colour paths. Keeps the legacy TubeMaterial untouched.
import fragmentShader from './shaders/fragment.glsl';
import vertexShader from './shaders/vertex.glsl';

// Scratch reused by onBeforeRender to read the current render-target size.
const _size = new Vector2();

/**
 * Material for the unified instanced-tube trajectory. Radius is a uniform,
 * so thickness changes never rebuild geometry, and a screen-space `minPixelRadius`
 * floor keeps the tube readable as a ~1px line at field scale.
 *
 * OIT variants are attached (`attachOitVariants`); at `opacity` 1 it renders in the
 * opaque pass, and semi-transparent when `opacity` < 1.
 */
export class TrajectoryMaterial extends ShaderMaterial {
  isTrajectoryMaterial = true;

  // Source array for the interval-colour textures; kept so the setter can skip a
  // rebuild when the same reference is re-applied, and to back the getter.
  private _colorIntervals: TrajectoryColorInterval[] | null = null;

  constructor(parameters?: MeshBasicMaterialParameters) {
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...UniformsUtils.clone(ShaderLib['basic'].uniforms),
        sizeMultiplier: new Uniform(1),
        radius: new Uniform(0.5),
        minPixelRadius: new Uniform(1),
        resolution: new Uniform(new Vector2(1, 1)),
        shadingColor: new Uniform(new Color(0x000000)),
        shadingStrength: new Uniform(0.6),
        shadingFalloff: new Uniform(2),
        uvWorld: new Uniform(false),
        wellLength: new Uniform(1),
        measuredTop: new Uniform(0),
        depthInterval: new Uniform(100),
        depthMarkerWidth: new Uniform(1),
        depthMarkerColorMode: new Uniform(0),
        depthMarkerColorModeFactor: new Uniform(0.5),
        depthMarkerColor: new Uniform(new Color(0x000000)),
        depthMarkerOffset: new Uniform(0),
        intervalColorTexture: new Uniform<Texture | null>(null),
        intervalPaletteTexture: new Uniform<Texture | null>(null),
        intervalPaletteSize: new Uniform(1),
      },
      clipping: true,
      fog: true,
    });
    if (parameters) this.setValues(parameters);
    attachOitVariants(this);
  }

  get color(): Color {
    return this.uniforms.diffuse.value;
  }

  set color(color: Color) {
    this.uniforms.diffuse.value.set(color);
  }

  get radius(): number {
    return this.uniforms.radius.value;
  }

  set radius(v: number) {
    this.uniforms.radius.value = v;
  }

  get sizeMultiplier(): number {
    return this.uniforms.sizeMultiplier.value;
  }

  set sizeMultiplier(v: number) {
    this.uniforms.sizeMultiplier.value = v;
  }

  get minPixelRadius(): number {
    return this.uniforms.minPixelRadius.value;
  }

  set minPixelRadius(v: number) {
    this.uniforms.minPixelRadius.value = v;
  }

  get shadingColor(): Color {
    return this.uniforms.shadingColor.value;
  }

  set shadingColor(color: Color) {
    this.uniforms.shadingColor.value.set(color);
  }

  get shadingStrength(): number {
    return this.uniforms.shadingStrength.value;
  }

  set shadingStrength(v: number) {
    this.uniforms.shadingStrength.value = v;
  }

  get shadingFalloff(): number {
    return this.uniforms.shadingFalloff.value;
  }

  set shadingFalloff(v: number) {
    this.uniforms.shadingFalloff.value = v;
  }

  /**
   * Optional albedo texture. Setting/clearing it toggles the `USE_MAP` define (which
   * the OIT variants pick up via their program-signature resync) and seeds the map
   * transform; the trajectory is unlit, so only a colour map is meaningful.
   */
  get map(): Texture | null {
    return this.uniforms.map.value;
  }

  set map(texture: Texture | null) {
    const next = texture || null;
    this.uniforms.map.value = next;
    const wasDefined = this.defines.USE_MAP !== undefined;
    if (next) {
      this.defines.USE_MAP = '';
      if (next.matrixAutoUpdate) next.updateMatrix();
      this.uniforms.mapTransform.value.copy(next.matrix);
    } else {
      delete this.defines.USE_MAP;
    }
    if (!!next !== wasDefined) this.needsUpdate = true;
  }

  /**
   * UV units for `map`: `'normalized'` (azimuth 0..1 x curve position 0..1) or
   * `'world'` (circumference metres x measured-depth metres, so `map.repeat` sets a
   * world-consistent texel density). Requires `wellLength` for the world path.
   */
  get mapUvUnits(): 'normalized' | 'world' {
    return this.uniforms.uvWorld.value ? 'world' : 'normalized';
  }

  set mapUvUnits(units: 'normalized' | 'world') {
    this.uniforms.uvWorld.value = units === 'world';
  }

  /** Full measured length of the wellbore in metres (scales the world-unit UV V). */
  get wellLength(): number {
    return this.uniforms.wellLength.value;
  }

  set wellLength(v: number) {
    this.uniforms.wellLength.value = v;
  }

  /** Measured depth (MSL) in metres at the top of the trajectory (depth-marker datum). */
  get measuredTop(): number {
    return this.uniforms.measuredTop.value;
  }

  set measuredTop(v: number) {
    this.uniforms.measuredTop.value = v;
  }

  /**
   * Depth-marker bands: flat-colour rings every `depthInterval` metres of measured depth.
   * Toggling this compiles the `USE_DEPTH_MARKERS` path in/out (the OIT variants pick it
   * up via their program-signature resync).
   */
  get depthMarkers(): boolean {
    return this.defines.USE_DEPTH_MARKERS !== undefined;
  }

  set depthMarkers(enabled: boolean) {
    const wasEnabled = this.defines.USE_DEPTH_MARKERS !== undefined;
    if (enabled) {
      this.defines.USE_DEPTH_MARKERS = '';
    } else {
      delete this.defines.USE_DEPTH_MARKERS;
    }
    if (enabled !== wasEnabled) this.needsUpdate = true;
  }

  /** Spacing between depth markers in metres. */
  get depthInterval(): number {
    return this.uniforms.depthInterval.value;
  }

  set depthInterval(v: number) {
    this.uniforms.depthInterval.value = v;
  }

  /**
   * How depth markers modulate the tube colour (mirrors the Surface contour modes):
   * 0 = darken, 1 = lighten, 2 = mixed (blend toward `depthMarkerColor`).
   */
  get depthMarkerColorMode(): number {
    return this.uniforms.depthMarkerColorMode.value;
  }

  set depthMarkerColorMode(v: number) {
    this.uniforms.depthMarkerColorMode.value = v;
  }

  /** Depth-marker modulation strength (0..1). */
  get depthMarkerColorModeFactor(): number {
    return this.uniforms.depthMarkerColorModeFactor.value;
  }

  set depthMarkerColorModeFactor(v: number) {
    this.uniforms.depthMarkerColorModeFactor.value = v;
  }

  /** Depth-marker target colour used by the 'mixed' colour mode. */
  get depthMarkerColor(): Color {
    return this.uniforms.depthMarkerColor.value;
  }

  set depthMarkerColor(color: Color) {
    this.uniforms.depthMarkerColor.value.set(color);
  }

  /** Depth-marker band thickness in metres (centred on each interval). */
  get depthMarkerWidth(): number {
    return this.uniforms.depthMarkerWidth.value;
  }

  set depthMarkerWidth(v: number) {
    this.uniforms.depthMarkerWidth.value = v;
  }

  /**
   * Metre offset applied to the MSL datum used by the depth markers (e.g. set to the RT
   * elevation or a kickoff depth to align the marker grid to that reference).
   */
  get depthMarkerOffset(): number {
    return this.uniforms.depthMarkerOffset.value;
  }

  set depthMarkerOffset(v: number) {
    this.uniforms.depthMarkerOffset.value = v;
  }

  /**
   * Data-driven interval colouring: an array of measured-depth (MSL) intervals, each
   * with a colour. Where a point on the tube falls inside an interval, the base colour
   * is replaced by that interval's colour; outside every interval the diffuse `color`
   * is used. Colours are de-duplicated into a small palette so many intervals can share
   * a colour cheaply, and the interval ranges + palette are uploaded as two small
   * `NearestFilter` float strip textures (built and owned here — disposed with the
   * material).
   *
   * Setting/clearing this toggles the `USE_INTERVAL_COLORS` define and updates the
   * `INTERVAL_COLOR_COUNT` define (which the OIT variants pick up via their
   * program-signature resync). Re-applying the same array reference is a no-op, so
   * callers should memoize the array to avoid rebuilding the textures.
   */
  get colorIntervals(): TrajectoryColorInterval[] | null {
    return this._colorIntervals;
  }

  set colorIntervals(intervals: TrajectoryColorInterval[] | null) {
    if (intervals === this._colorIntervals) return;
    this._colorIntervals = intervals;

    // Free the previously built strip textures (owned by this material).
    (this.uniforms.intervalColorTexture.value as Texture | null)?.dispose();
    (this.uniforms.intervalPaletteTexture.value as Texture | null)?.dispose();

    const wasEnabled = this.defines.USE_INTERVAL_COLORS !== undefined;
    const previousCount = this.defines.INTERVAL_COLOR_COUNT;

    if (intervals && intervals.length > 0) {
      // De-duplicate colours into a palette; each interval references a palette index,
      // so intervals sharing a colour cost only one palette entry.
      const paletteIndex = new Map<string, number>();
      const palette: Color[] = [];
      const intervalData = new Float32Array(intervals.length * 4);
      for (let i = 0; i < intervals.length; i++) {
        const { from, to, color } = intervals[i];
        let index = paletteIndex.get(color);
        if (index === undefined) {
          index = palette.length;
          paletteIndex.set(color, index);
          palette.push(new Color(color));
        }
        intervalData[i * 4] = from;
        intervalData[i * 4 + 1] = to;
        intervalData[i * 4 + 2] = index;
        intervalData[i * 4 + 3] = 0;
      }

      const paletteData = new Float32Array(palette.length * 4);
      for (let i = 0; i < palette.length; i++) {
        paletteData[i * 4] = palette[i].r;
        paletteData[i * 4 + 1] = palette[i].g;
        paletteData[i * 4 + 2] = palette[i].b;
        paletteData[i * 4 + 3] = 1;
      }

      const intervalTexture = new DataTexture(
        intervalData,
        intervals.length,
        1,
        RGBAFormat,
        FloatType,
      );
      intervalTexture.magFilter = NearestFilter;
      intervalTexture.minFilter = NearestFilter;
      intervalTexture.needsUpdate = true;

      const paletteTexture = new DataTexture(
        paletteData,
        palette.length,
        1,
        RGBAFormat,
        FloatType,
      );
      paletteTexture.magFilter = NearestFilter;
      paletteTexture.minFilter = NearestFilter;
      paletteTexture.needsUpdate = true;

      this.uniforms.intervalColorTexture.value = intervalTexture;
      this.uniforms.intervalPaletteTexture.value = paletteTexture;
      this.uniforms.intervalPaletteSize.value = palette.length;

      this.defines.USE_INTERVAL_COLORS = '';
      this.defines.INTERVAL_COLOR_COUNT = String(intervals.length);
    } else {
      this.uniforms.intervalColorTexture.value = null;
      this.uniforms.intervalPaletteTexture.value = null;
      this.uniforms.intervalPaletteSize.value = 1;
      delete this.defines.USE_INTERVAL_COLORS;
      delete this.defines.INTERVAL_COLOR_COUNT;
    }

    // Only recompile when the program-affecting defines actually change (enable toggle
    // or a different interval count — changing colours/depths just updates the texture).
    const isEnabled = this.defines.USE_INTERVAL_COLORS !== undefined;
    if (
      isEnabled !== wasEnabled ||
      this.defines.INTERVAL_COLOR_COUNT !== previousCount
    ) {
      this.needsUpdate = true;
    }
  }

  setResolution(width: number, height: number) {
    this.uniforms.resolution.value.set(width, height);
  }

  // Dispose the internally-built interval-colour textures alongside the material (the
  // albedo `map` is user-supplied and intentionally left untouched).
  dispose() {
    (this.uniforms.intervalColorTexture.value as Texture | null)?.dispose();
    (this.uniforms.intervalPaletteTexture.value as Texture | null)?.dispose();
    super.dispose();
  }

  // Called by the renderer before each draw of this material. Two jobs:
  // 1. Keep the map transform in sync with the texture's matrix so runtime repeat/offset
  //    changes take effect (mirrors what Three does for built-in materials, which
  //    ShaderMaterial does not do automatically).
  // 2. Refine the screen-space floor's `resolution` to the ACTUAL render-target size
  //    (device pixels), so `minPixelRadius` stays exact even under a supersampled custom
  //    pipeline whose buffer is larger than the R3F size*dpr baseline. When rendering to
  //    screen the render target is null, so fall back to the drawing-buffer size.
  onBeforeRender(renderer: WebGLRenderer) {
    const texture = this.uniforms.map.value as Texture | null;
    if (texture) {
      if (texture.matrixAutoUpdate) texture.updateMatrix();
      this.uniforms.mapTransform.value.copy(texture.matrix);
    }

    const target = renderer.getRenderTarget();
    if (target) {
      _size.set(target.width, target.height);
    } else {
      renderer.getDrawingBufferSize(_size);
    }
    (this.uniforms.resolution.value as Vector2).copy(_size);
  }
}
