import {
  CubeTexture,
  MathUtils,
  Mesh,
  type IUniform,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  acquireCloudMap,
  bakeCloudMap,
  CLOUD_MAP_STRIPS,
  type CloudMap,
  cloudMapKey,
  type CloudMapTerrain,
  releaseCloudMap,
} from './scenery-cloud-map';

// The cloud map's strips drawn a frame: the first map, which the clouds wait for (some half a
// second); and the next ones, drawn in the background while the clouds show the ones before.
const STRIPS_FIRST = 16;
const STRIPS_NEXT = 1;
// As the clock runs, maps are drawn at least this far apart (weather seconds: the systems
// travel some 20 km), further where the clock runs so fast that drawing each takes longer than
// MAP_DRAW_SHARE of the time between them: STRIPS_NEXT strips a frame, more (up to STRIPS_MOST)
// where that would set them more than SPAN_MOST apart.
const SPAN = 1800;
const SPAN_MOST = 6 * 3600;
const DRAW_SHARE = 0.5;
const STRIPS_MOST = 4;
// A jump of the clock this far past the newer map (weather seconds) draws one anew.
const JUMP = 12 * 3600;

/** The uniforms a {@link CloudWeather} sets: the march's (`cloud-volume-march.glsl`). */
export type CloudWeatherUniforms = {
  uCloudMap: IUniform<CubeTexture | null>;
  uCloudMapNext: IUniform<CubeTexture | null>;
  uCloudTypes: IUniform<CubeTexture | null>;
  uCloudTypesNext: IUniform<CubeTexture | null>;
  uCloudMapTimes: IUniform<Vector3>;
};

/**
 * A global weather's maps of the weather systems for the 3D clouds (`scenery-cloud-map.ts`):
 * the two drawings it blends between as the clock runs (older and newer), and one being drawn
 * meanwhile, a few strips a frame — the next ahead, or anew for another seed, other ground or a
 * jump of the clock. The march reads the older and the newer each where its cloud has drifted
 * to since it was drawn, and the older gives way to the newer place by place
 * (`documents/clouds.md`, "Motion").
 */
export class CloudWeather {
  private renderer: WebGLRenderer | null = null;
  private older: CloudMap | null = null;
  private newer: CloudMap | null = null;
  private next: CloudMap | null = null;
  // Whether `next` is drawn anew (shown alone once drawn) rather than the next ahead.
  private fresh = true;
  // The clock when the newer took over.
  private blendStart = 0;
  // How fast the clock runs (weather seconds a wall second) and a frame's wall time (s), eased;
  // and the clock and the wall time at the last update.
  private pace = 0;
  private frameWall = 1 / 60;
  private paceTime = 0;
  private paceWall = 0;
  /** Counts the drawings taking over: what was drawn from them is drawn again. */
  version = 0;

  constructor(private readonly uniforms: CloudWeatherUniforms) {}

  /** What draws `renderer`'s cloud maps, the same for every seed: compile them before {@link update}. */
  generators(renderer: WebGLRenderer): readonly Mesh[] {
    this.ensure(renderer);
    const any = this.next ?? this.newer;
    if (any) return any.generators;
    // Made (not drawn) to compile with: the first one update draws.
    this.next = acquireCloudMap(renderer, 0, null, 0);
    this.fresh = true;
    return this.next.generators;
  }

  /**
   * Draw more of the maps for `seed` over `terrain` at the clock's `time` with `renderer`, a
   * few strips a frame, and draw with them once done; until then, with the ones before.
   * Whether there is a map to draw with.
   */
  update(
    renderer: WebGLRenderer,
    seed: number,
    time: number,
    terrain: CloudMapTerrain | null = null,
  ): boolean {
    this.ensure(renderer);
    // The clock's pace, and a frame's wall time, eased over some half a second.
    const wall = performance.now() / 1000;
    if (this.paceWall > 0) {
      const dw = Math.min(Math.max(wall - this.paceWall, 1e-3), 0.25);
      const ease = 1 - Math.exp(-dw / 0.5);
      this.pace += ((time - this.paceTime) / dw - this.pace) * ease;
      this.frameWall += (dw - this.frameWall) * ease;
    }
    this.paceTime = time;
    this.paceWall = wall;

    const base = cloudMapKey(seed, terrain);
    const newer = this.newer;
    const fresh =
      !newer ||
      newer.base !== base ||
      time > newer.time + JUMP ||
      time < (this.older ?? newer).time - SPAN;
    if (fresh) {
      // Drawn anew at the time now, and shown alone once drawn.
      if (!this.fresh || this.next?.base !== base) this.dropNext();
      if (!this.next) {
        this.next = acquireCloudMap(renderer, seed, terrain, time);
        this.fresh = true;
      }
    } else if (!this.next && this.pace > 0 && newer.time < time + this.span()) {
      // The next one ahead, while the clock runs on toward the newer.
      this.next = acquireCloudMap(
        renderer,
        seed,
        terrain,
        newer.time + this.span(),
      );
      this.fresh = false;
    }

    const next = this.next;
    if (next) {
      const strips = !newer ? STRIPS_FIRST : this.strips();
      // The next one ahead takes over once the clock has come to the newer.
      const due = this.fresh || !newer || time >= newer.time;
      if (bakeCloudMap(renderer, next, strips) && due) {
        if (this.fresh) {
          this.release(this.older);
          this.release(this.newer);
          this.older = null;
        } else {
          this.release(this.older);
          this.older = this.newer;
        }
        this.newer = next;
        this.next = null;
        this.blendStart = time;
        this.version++;
      }
    }
    this.updateUniforms(time);
    return this.newer !== null;
  }

  /** Let go of every map: drawn anew should the weather turn global again. */
  dispose() {
    for (const map of [this.older, this.newer, this.next]) this.release(map);
    this.older = this.newer = this.next = null;
    this.renderer = null;
    this.fresh = true;
    this.updateUniforms(0);
  }

  private ensure(renderer: WebGLRenderer) {
    if (this.renderer !== renderer) {
      this.dispose();
      this.renderer = renderer;
    }
  }

  // Strips of the next map drawn a frame as the clock runs: enough to draw it in DRAW_SHARE of
  // SPAN_MOST at the pace, if they can.
  private strips() {
    const wall = (DRAW_SHARE * SPAN_MOST) / Math.max(Math.abs(this.pace), 1e-6);
    const strips = Math.ceil((CLOUD_MAP_STRIPS * this.frameWall) / wall);
    return MathUtils.clamp(strips, STRIPS_NEXT, STRIPS_MOST);
  }

  // The time between two maps as the clock runs (weather seconds): SPAN, or as long as one
  // takes to draw at the pace, over DRAW_SHARE.
  private span() {
    const drawn = (CLOUD_MAP_STRIPS / this.strips()) * this.frameWall;
    return Math.max(SPAN, (drawn * Math.abs(this.pace)) / DRAW_SHARE);
  }

  // The march's maps and how it blends them (cloudMapRead): the older and the newer, the newer's
  // share by the clock between the blend's start and the newer's time, and each one's age.
  private updateUniforms(time: number) {
    const u = this.uniforms;
    const newer = this.newer;
    const older = this.older ?? newer;
    u.uCloudMap.value = older?.texture ?? null;
    u.uCloudMapNext.value = newer?.texture ?? null;
    u.uCloudTypes.value = older?.types ?? null;
    u.uCloudTypesNext.value = newer?.types ?? null;
    let share = 0;
    if (older && newer && older !== newer) {
      const span = newer.time - this.blendStart;
      share =
        span > 1 ? MathUtils.clamp((time - this.blendStart) / span, 0, 1) : 1;
    }
    u.uCloudMapTimes.value.set(
      share,
      older ? time - older.time : 0,
      newer ? time - newer.time : 0,
    );
  }

  private dropNext() {
    this.release(this.next);
    this.next = null;
  }

  private release(map: CloudMap | null) {
    if (map && this.renderer) releaseCloudMap(this.renderer, map);
  }
}
