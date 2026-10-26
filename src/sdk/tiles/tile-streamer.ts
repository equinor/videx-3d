import { tileAddress } from './tile-keys';

/**
 * Where a {@link TileStreamer}'s tiles come from.
 *
 * @group Tiles
 */
export type TileSource<T> = {
  /** the tile, or null where there is none (it is not asked for again for a while) */
  load(key: number): Promise<T | null>;
  /** what a tile in holds, for the budget */
  bytes(tile: T): number;
};

/**
 * How a {@link TileStreamer} loads and keeps tiles.
 *
 * @group Tiles
 */
export type TileStreamerOptions<T> = {
  /** loads at a time. Default 4 */
  concurrency?: number;
  /** what the tiles in may hold together, in bytes. Default 48 MB */
  budget?: number;
  /** tiles no deeper than this are never let go. Default 2 */
  keepDepth?: number;
  /** updates before a tile that came back empty, or failed, is asked for again. Default 120 */
  retryAfter?: number;
  /** a tile has come in */
  onLoad?: (key: number, tile: T) => void;
  /** a tile has been let go */
  onEvict?: (key: number, tile: T) => void;
};

type Resident<T> = { tile: T; bytes: number; used: number };

/**
 * Loads the tiles wanted, the most wanted first and a few at a time, and keeps those in
 * under a budget, letting go of the least recently used first. Not tied to what a tile
 * holds.
 *
 * Call {@link TileStreamer.update} once per frame with the tiles used and the tiles
 * wanted (see `selectQuadtreeTiles`).
 *
 * @group Tiles
 */
export class TileStreamer<T> {
  private readonly source: TileSource<T>;
  private readonly concurrency: number;
  private readonly budget: number;
  private readonly keepDepth: number;
  private readonly retryAfter: number;
  private readonly onLoad?: (key: number, tile: T) => void;
  private readonly onEvict?: (key: number, tile: T) => void;

  private resident = new Map<number, Resident<T>>();
  private loading = new Set<number>();
  private failed = new Map<number, number>();
  private queue: { key: number; priority: number }[] = [];
  private frame = 0;
  private held = 0;
  private disposed = false;

  constructor(source: TileSource<T>, options: TileStreamerOptions<T> = {}) {
    this.source = source;
    this.concurrency = options.concurrency ?? 4;
    this.budget = options.budget ?? 48 * 1024 * 1024;
    this.keepDepth = options.keepDepth ?? 2;
    this.retryAfter = options.retryAfter ?? 120;
    this.onLoad = options.onLoad;
    this.onEvict = options.onEvict;
  }

  /** The tile, if it is in. */
  get(key: number): T | undefined {
    return this.resident.get(key)?.tile;
  }

  /** What it holds and does now. */
  get stats() {
    return {
      resident: this.resident.size,
      bytes: this.held,
      loading: this.loading.size,
      queued: this.queue.length,
    };
  }

  /**
   * One frame: marks `used` — the tiles drawn, and the ones the selection went through
   * to reach them (`split`), without which it cannot reach them again — replaces what is
   * wanted with `wanted` (the most wanted first), starts loading what it can, and lets go
   * of the least recently used tiles over the budget.
   */
  update(used: Iterable<number>, wanted: { key: number; priority: number }[]) {
    if (this.disposed) return;
    this.frame++;
    for (const key of used) {
      const entry = this.resident.get(key);
      if (entry) entry.used = this.frame;
    }
    this.queue = wanted
      .filter(({ key }) => {
        if (this.resident.has(key) || this.loading.has(key)) return false;
        const at = this.failed.get(key);
        return at === undefined || this.frame - at > this.retryAfter;
      })
      .sort((a, b) => b.priority - a.priority);
    this.pump();
    this.evict();
  }

  /** Let go of every tile; loads still out are dropped when they come back. */
  dispose() {
    this.disposed = true;
    for (const [key, entry] of this.resident) this.onEvict?.(key, entry.tile);
    this.resident.clear();
    this.queue = [];
    this.held = 0;
  }

  private pump() {
    while (this.loading.size < this.concurrency && this.queue.length) {
      const { key } = this.queue.shift()!;
      if (this.resident.has(key) || this.loading.has(key)) continue;
      this.loading.add(key);
      this.source
        .load(key)
        .then(tile => {
          this.loading.delete(key);
          if (this.disposed) return;
          if (!tile) {
            this.failed.set(key, this.frame);
          } else {
            const bytes = this.source.bytes(tile);
            this.resident.set(key, { tile, bytes, used: this.frame });
            this.held += bytes;
            this.failed.delete(key);
            this.onLoad?.(key, tile);
          }
          this.pump();
        })
        .catch(error => {
          this.loading.delete(key);
          if (this.disposed) return;
          this.failed.set(key, this.frame);
          console.warn(`TileStreamer: tile ${tileAddress(key)} failed`, error);
          this.pump();
        });
    }
  }

  private evict() {
    if (this.held <= this.budget) return;
    const candidates: [number, Resident<T>][] = [];
    for (const item of this.resident) {
      if (item[1].used >= this.frame) continue;
      if (tileAddress(item[0])[0] <= this.keepDepth) continue;
      candidates.push(item);
    }
    candidates.sort((a, b) => a[1].used - b[1].used);
    for (const [key, entry] of candidates) {
      if (this.held <= this.budget) break;
      this.resident.delete(key);
      this.held -= entry.bytes;
      this.onEvict?.(key, entry.tile);
    }
  }
}
