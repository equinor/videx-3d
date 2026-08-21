import { WebGLRenderer } from 'three';

/** Minimal subset of the `EXT_disjoint_timer_query_webgl2` extension we use. */
interface DisjointTimerQueryExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

type Segment = {
  /** Queries issued but not yet read back (FIFO — results lag a few frames). */
  inflight: WebGLQuery[];
  /** Smoothed elapsed time in milliseconds (EMA), or -1 until the first result. */
  ms: number;
};

/**
 * Tiny GPU timer for WebGL2 built on `EXT_disjoint_timer_query_webgl2`.
 *
 * DEBUG-ONLY instrumentation: it brackets named, non-overlapping segments with
 * `TIME_ELAPSED` queries and reads the results back asynchronously (a few frames
 * later), reporting a smoothed millisecond figure per segment. Because the GPU runs
 * behind the CPU, results are never available the same frame they are issued, so a
 * small ring of queries per segment is kept in flight.
 *
 * Only one timer query can be active at a time per spec, so {@link begin}/{@link end}
 * calls must be strictly sequential (never nested). All methods are no-ops when the
 * extension is unavailable (older browsers, or the WebGPU renderer), so call sites
 * can leave instrumentation in place unconditionally.
 *
 * This is measurement only — it issues no draws and mutates no render state — so it
 * does not affect the rendered result and is safe to leave compiled in behind a flag.
 *
 * @group Rendering
 */
export class GpuTimer {
  private gl: WebGL2RenderingContext;
  private ext: DisjointTimerQueryExt | null;
  private segments = new Map<string, Segment>();
  private pool: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private activeSeg: Segment | null = null;

  /** Whether GPU timing is available in this context. */
  get supported(): boolean {
    return this.ext !== null;
  }

  constructor(renderer: WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.ext = this.gl.getExtension(
      'EXT_disjoint_timer_query_webgl2',
    ) as DisjointTimerQueryExt | null;
  }

  /** Begin timing a segment. No-op if unsupported or another segment is active. */
  begin(label: string) {
    if (!this.ext || this.active) return;
    let seg = this.segments.get(label);
    if (!seg) {
      seg = { inflight: [], ms: -1 };
      this.segments.set(label, seg);
    }
    const q = this.pool.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
    this.activeSeg = seg;
  }

  /** End timing the current segment. */
  end() {
    if (!this.ext || !this.active || !this.activeSeg) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.activeSeg.inflight.push(this.active);
    this.active = null;
    this.activeSeg = null;
  }

  /**
   * Harvest finished queries and update the smoothed timings. Call once per frame
   * (e.g. at the top of the host pass's render). Disjoint frames (GPU context
   * disruption) are discarded.
   */
  poll() {
    if (!this.ext) return;
    const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    for (const seg of this.segments.values()) {
      while (seg.inflight.length > 0) {
        const q = seg.inflight[0];
        const available = this.gl.getQueryParameter(
          q,
          this.gl.QUERY_RESULT_AVAILABLE,
        ) as boolean;
        if (!available) break;
        if (!disjoint) {
          const ns = this.gl.getQueryParameter(
            q,
            this.gl.QUERY_RESULT,
          ) as number;
          const ms = ns / 1e6;
          seg.ms = seg.ms < 0 ? ms : seg.ms * 0.9 + ms * 0.1;
        }
        seg.inflight.shift();
        this.pool.push(q);
      }
    }
  }

  /** Smoothed elapsed milliseconds for a segment, or -1 if no result yet. */
  get(label: string): number {
    return this.segments.get(label)?.ms ?? -1;
  }

  /** Snapshot of every segment's smoothed timing in milliseconds. */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [label, seg] of this.segments) out[label] = seg.ms;
    return out;
  }

  dispose() {
    if (this.active) {
      this.gl.endQuery(this.ext!.TIME_ELAPSED_EXT);
      this.active = null;
      this.activeSeg = null;
    }
    for (const seg of this.segments.values()) {
      for (const q of seg.inflight) this.gl.deleteQuery(q);
    }
    for (const q of this.pool) this.gl.deleteQuery(q);
    this.segments.clear();
    this.pool.length = 0;
  }
}
