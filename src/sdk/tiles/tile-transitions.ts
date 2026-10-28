import { tileAddress, tileChildren, tileParent } from './tile-keys';

// ⚠️ Free of three.js.

/**
 * A tile drawn with {@link TileTransitions}: what it shows is its source's look mixed into
 * its own by `blend` — `mix(source, own, blend)` — 1 once settled.
 *
 * @group Tiles
 */
export type TileTransitionDraw = {
  key: number;
  /**
   * the tile whose look it blends from — an ancestor, which covers it — or null, to fade in
   * from nothing (or appear, where nothing can fade in)
   */
  from: number | null;
  /** 0: the source's look, 1: its own */
  blend: number;
};

/**
 * What {@link TileTransitions.update} needs to know of the tiles.
 *
 * @group Tiles
 */
export type TileTransitionTiles = {
  /** whether the tile is in: it can be drawn, kept drawn as a stand-in, or sampled as a source */
  isIn: (key: number) => boolean;
  /**
   * whether a chosen tile may be drawn now, as a new tile: in, and fine enough, say (an
   * overlay will not bring in a tile that would only blur). What is drawn already stays as a
   * stand-in whatever this says. Default `isIn`
   */
  drawable?: (key: number) => boolean;
  /**
   * a tile with nothing to draw over its area (an overlay's tile with no shape on it): it
   * counts as covered, by a merge's held tiles and by the tiles replacing a stand-in.
   * Omitted, none is
   */
  isBlank?: (key: number) => boolean;
  /**
   * a tile that must be drawn as chosen, swapped at once — where something else must meet
   * exactly what is drawn (a relief's ground handed to a column). Must hold for every
   * ancestor of a tile it holds for. Omitted, none is
   */
  fixed?: (key: number) => boolean;
};

type Entry = {
  from: number | null;
  /** when the blend started, ms */
  start: number;
  /** held after the choice let it go, blending back toward `from`, which replaces it */
  held: boolean;
};

/**
 * Where a tile lies in an ancestor it blends from: its offset there along its columns and
 * rows (0…1 across the ancestor) and its size (1 / 2^levels). A point `t` across the tile is
 * `offset + t * scale` across the ancestor (`geoTileFrom` in `geo-tile.glsl`).
 *
 * @group Tiles
 */
export function tileOffsetIn(
  key: number,
  ancestor: number,
): [u: number, v: number, scale: number] {
  const [depth, i, j] = tileAddress(key);
  const [from, ai, aj] = tileAddress(ancestor);
  const scale = 1 / 2 ** (depth - from);
  return [
    (i - ai * 2 ** (depth - from)) * scale,
    (j - aj * 2 ** (depth - from)) * scale,
    scale,
  ];
}

/**
 * Soft swaps between a quadtree's levels of detail: instead of a tile popping to its
 * children, or children to their parent, each tile drawn blends from the look it replaces
 * over `duration` ms. The shader mixes the two; nothing is drawn twice, so a see-through
 * layer does not darken and an opaque one does not fight its own depth.
 *
 * - **A split**: each new tile blends from the nearest ancestor drawn last (its source,
 *   whose data it samples at its own place: a geomorph of heights, a fade of colours), up
 *   to its own.
 * - **A merge**: the tiles drawn under the new one stay drawn for `duration`, blending back
 *   toward it, and are then replaced by it, when they look the same. Only when they cover it
 *   all (blank tiles counted as covered): else it replaces them at once.
 * - **A new tile with nothing drawn around it** fades in from nothing (`from` null), or
 *   appears at once with `fadeIn` off.
 * - **Never a hole while loading**: a tile drawn stays drawn — a stand-in — until the tiles
 *   chosen in its place are in and cover all of it (blank tiles counted), whatever the
 *   choice says; those already in wait for the rest, so nothing is drawn twice. Then they
 *   replace it, blending from it. Only where nothing is chosen any more (out of view) does a
 *   drawn tile go at once.
 * - **A change of mind** — a merge undone before it ends — takes the blend on from where it
 *   is.
 *
 * Call {@link update} each frame with the tiles chosen to draw, in or not; while
 * {@link active}, call it every frame even if the choice did not change. Keep {@link keep}
 * in (its tiles are sampled or drawn though no longer chosen).
 *
 * @group Tiles
 */
export class TileTransitions {
  /** ms a blend takes; 0 swaps at once */
  duration: number;
  /** new tiles with nothing to blend from fade in; else they appear at once */
  fadeIn: boolean;
  private readonly entries = new Map<number, Entry>();
  /** tiles chosen to replace held ones, drawn once those are done */
  private readonly waiting = new Map<number, number>();
  private kept: number[] = [];
  private busy = false;

  constructor(duration = 300, fadeIn = true) {
    this.duration = duration;
    this.fadeIn = fadeIn;
  }

  /** whether a blend is under way: call {@link update} every frame while it is */
  get active(): boolean {
    return this.busy;
  }

  /** the tiles drawn or sampled that the choice no longer holds: keep them in */
  get keep(): readonly number[] {
    return this.kept;
  }

  /** Forget every tile: the next ones drawn appear as new. */
  clear() {
    this.entries.clear();
    this.waiting.clear();
    this.kept = [];
    this.busy = false;
  }

  private progress(entry: Entry, now: number): number {
    if (this.duration <= 0) return entry.held ? 0 : 1;
    const t = Math.min(Math.max((now - entry.start) / this.duration, 0), 1);
    return entry.held ? 1 - t : t;
  }

  /** The nearest ancestor of `key` drawn now (held or not), or null. */
  private drawnAncestor(key: number, isIn: (key: number) => boolean) {
    let depth = tileAddress(key)[0];
    let at = key;
    while (depth > 0) {
      at = tileParent(at);
      depth--;
      if (this.entries.has(at) && isIn(at)) return at;
    }
    return null;
  }

  /**
   * The tiles to draw now, from the tiles chosen (`chosen`, in or not), each with its
   * source and blend.
   *
   * @param now ms, as `performance.now()`
   */
  update(
    chosen: Iterable<number>,
    now: number,
    { isIn, drawable = isIn, isBlank, fixed }: TileTransitionTiles,
  ): TileTransitionDraw[] {
    const target = new Set(chosen);
    const entries = this.entries;
    // A chosen tile that can be drawn now.
    const ready = (key: number) => target.has(key) && drawable(key);
    const blank = (key: number) => !!isBlank?.(key);

    // Every ancestor of what is chosen: where chosen tiles may lie under a drawn one.
    const chosenAbove = new Set<number>();
    for (const key of target) {
      let at = key;
      for (let depth = tileAddress(key)[0]; depth > 0; depth--) {
        at = tileParent(at);
        if (chosenAbove.has(at)) break;
        chosenAbove.add(at);
      }
    }
    // Whether the chosen tiles ready under `key` cover all of it that is chosen: where
    // nothing is chosen (out of view), nothing is wanted.
    const chosenCovers = (key: number): boolean => {
      if (target.has(key)) return drawable(key) || blank(key);
      if (!chosenAbove.has(key) || blank(key)) return true;
      return tileChildren(key).every(chosenCovers);
    };
    // Stand-ins: tiles drawn whose area the chosen tiles ready do not yet cover. They stay
    // drawn; the chosen tiles under them wait.
    const standIns = new Set<number>();
    for (const [key, entry] of entries) {
      if (entry.held || !isIn(key) || ready(key)) continue;
      let chosenAncestor: number | null = null;
      let at = key;
      for (let depth = tileAddress(key)[0]; depth > 0; depth--) {
        at = tileParent(at);
        if (target.has(at)) {
          chosenAncestor = at;
          break;
        }
      }
      if (chosenAncestor !== null) {
        // Merging into a tile not in yet.
        if (!drawable(chosenAncestor) && !blank(chosenAncestor))
          standIns.add(key);
      } else if (target.has(key) || chosenAbove.has(key)) {
        // Splitting into tiles not all in yet.
        if (!chosenCovers(key)) standIns.add(key);
      }
    }
    const underStandIn = (key: number) => {
      if (standIns.size === 0) return false;
      let at = key;
      for (let depth = tileAddress(key)[0]; depth > 0; depth--) {
        at = tileParent(at);
        if (standIns.has(at)) return true;
      }
      return false;
    };

    // Every ancestor of what is drawn: where to look for tiles to hold on a merge.
    const above = new Set<number>();
    for (const key of entries.keys()) {
      let at = key;
      for (let depth = tileAddress(key)[0]; depth > 0; depth--) {
        at = tileParent(at);
        if (above.has(at)) break;
        above.add(at);
      }
    }
    // Whether drawn tiles under `key` cover it all.
    const covered = (key: number, levels: number): boolean => {
      if (entries.has(key) && isIn(key)) return true;
      if (blank(key)) return true;
      if (levels === 0 || !above.has(key)) return false;
      return tileChildren(key).every(child => covered(child, levels - 1));
    };
    const heldUnder = (key: number) => {
      const found: number[] = [];
      for (const [drawn, entry] of entries) {
        if (drawn === key || entry.held) continue;
        let at = drawn;
        for (let depth = tileAddress(drawn)[0]; depth > 0; depth--) {
          at = tileParent(at);
          if (at === key) {
            found.push(drawn);
            break;
          }
        }
      }
      return found;
    };

    // New tiles: a split blends from the ancestor drawn; a merge holds what is drawn under.
    for (const key of target) {
      // Not in yet, or waiting for a stand-in's other replacements.
      if (!drawable(key) || standIns.has(key) || underStandIn(key)) continue;
      const known = entries.get(key);
      if (fixed?.(key)) {
        // As chosen, at once.
        this.waiting.delete(key);
        if (known) {
          known.from = null;
          known.start = -Infinity;
          known.held = false;
        } else {
          entries.set(key, { from: null, start: -Infinity, held: false });
        }
        continue;
      }
      if (known) {
        if (known.held) {
          // Chosen again while held: on from where its blend is, toward its own look.
          const t = this.progress(known, now);
          known.held = false;
          known.start = now - t * this.duration;
        }
        continue;
      }
      if (this.waiting.has(key)) continue;
      const ancestor = this.drawnAncestor(key, isIn);
      if (ancestor !== null) {
        entries.set(key, { from: ancestor, start: now, held: false });
        continue;
      }
      const under = above.has(key) ? heldUnder(key) : [];
      if (under.length > 0 && this.duration > 0 && covered(key, 8)) {
        for (const drawn of under) {
          const entry = entries.get(drawn)!;
          entry.from = key;
          entry.start = now;
          entry.held = true;
        }
        this.waiting.set(key, now + this.duration);
        continue;
      }
      entries.set(key, {
        from: null,
        start: this.fadeIn && under.length === 0 ? now : -Infinity,
        held: false,
      });
    }

    // Tiles let go: stand-ins stay until replaced; held ones until their blend is done (or
    // their source goes).
    for (const [key, entry] of entries) {
      if (standIns.has(key)) continue;
      if (ready(key) && !underStandIn(key)) continue;
      if (
        entry.held &&
        entry.from !== null &&
        (target.has(entry.from) || this.waiting.has(entry.from)) &&
        isIn(entry.from) &&
        this.progress(entry, now) > 0
      )
        continue;
      entries.delete(key);
    }
    // Merges done: the tile they waited for is drawn, its own look already.
    for (const [key, until] of this.waiting) {
      if (!target.has(key)) {
        this.waiting.delete(key);
        continue;
      }
      let holding = false;
      for (const entry of entries.values()) {
        if (entry.held && entry.from === key) holding = true;
      }
      if (now >= until || !holding) {
        this.waiting.delete(key);
        entries.set(key, { from: null, start: -Infinity, held: false });
      }
    }

    // What to draw, and what to keep in.
    const draw: TileTransitionDraw[] = [];
    const keep = new Set<number>();
    let busy = this.waiting.size > 0;
    for (const [key, entry] of entries) {
      if (!isIn(key)) continue;
      let blend = this.progress(entry, now);
      let from = entry.from;
      // A source gone: its own look at once.
      if (from !== null && !isIn(from)) {
        from = null;
        blend = 1;
      }
      // A fade-in done, or a blend done: settled.
      if (blend >= 1 && !entry.held) {
        entry.from = null;
        entry.start = -Infinity;
        from = null;
      } else {
        busy = true;
      }
      if (from !== null) keep.add(from);
      if (!ready(key)) keep.add(key);
      draw.push({ key, from, blend });
    }
    this.kept = [...keep];
    this.busy = busy;
    return draw;
  }
}
