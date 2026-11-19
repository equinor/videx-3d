import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import type { Camera } from 'three';
import {
  reliefContourLabelPoints,
  type ReliefContourLabelPoint,
} from '../../sdk/geometries/relief-contour-labels';
import {
  RELIEF_CONTOUR_LABEL_FADE,
  reliefContourLabelClass,
  reliefContourLabelClassReach,
  reliefContourLineGap,
} from '../Layers/relief-contour-label-reach';
import type { ResolvedReliefContourLabels } from '../Scenery/scenery-relief-look';
import { LabelLayer } from './LabelLayer';
import type { Label } from './types';

/**
 * How much contour labels are wanted where labels meet on screen (`LabelLayer`'s
 * `priority`): below data labels (`GeoLabels`, 0), above the graticule's names (−1).
 */
export const RELIEF_CONTOUR_LABEL_PRIORITY = -0.5;

/** The least a contour label reads whole at, CSS pixels as seen (`LabelStyle.minPixels`): a 9 px one on a moderate slope. */
export const RELIEF_CONTOUR_LABEL_MIN_PIXELS = 6;

/** How squarely a contour label must face the camera to be whole (`LabelStyle.minFacing`): none toward the horizon. */
export const RELIEF_CONTOUR_LABEL_MIN_FACING = 0.3;

/** A contour label's lift toward the camera for each metre of its distance (`LabelStyle.liftPerDistance`). */
export const RELIEF_CONTOUR_LABEL_LIFT = 0.02;

/** The contour lines a look labels (`ReliefContours.labels`). */
export type ContourLabelLook = {
  /** the heights between the lines labelled, from 0 */
  step: number;
  labels: ResolvedReliefContourLabels;
};

/**
 * A tile's heights as drawn (see {@link ContourLabelTile}): `(cells + 3)²` nodes, a border of
 * one round its own, row by row (`reliefContourLabelPoints`).
 */
export type ContourLabelGround = {
  cells: number;
  heights: ArrayLike<number>;
  /** each node's look, laid out as `heights`; none: look 0 everywhere */
  looks?: ArrayLike<number>;
  /** the least and most height its labels' lines may be at */
  low: number;
  high: number;
};

/** One of the tiles drawn, as a {@link ContourLabelSource} gives it this frame. */
export type ContourLabelTile = {
  key: number;
  /** what its labels are found from: found again when any of these is another */
  from: readonly unknown[];
  /** its nearest to the camera, world units */
  away: number;
  /** a row's length on the ground, world units */
  rowMetres: number;
  /** a column's width over a row's on the ground */
  aspect: number;
  /** 0 for the coarsest tiles, one more each halving of their rows */
  depth: number;
  /** its heights as drawn: asked for once, as its labels are first found */
  ground: () => ContourLabelGround | null;
};

/** The tiles drawn this frame (see {@link ContourLabelsProps.source}). */
export type ContourLabelFrame = {
  /** another whenever the tiles drawn change */
  version: number;
  /** how many are drawn */
  count: number;
  /** a depth-0 tile's row on the ground, world units */
  rootRow: number;
  keys: () => Iterable<number>;
  /** one of them as now, or null to pass it over */
  tile: (key: number) => ContourLabelTile | null;
};

/** @internal */
export type ContourLabelsProps<L extends ContourLabelLook> = {
  /** per look (as the tiles mark their nodes): what it labels, or null */
  looks: (L | null)[];
  visible: boolean;
  /** the most a tile's cell spans on screen before it is split */
  cellPixels: number;
  /** the tiles drawn, seen from `camera` (`focal` CSS pixels a metre across at a metre's distance); null for none */
  source: (camera: Camera, focal: number) => ContourLabelFrame | null;
  /** a label where `point` lies on `tile` */
  place: (
    tile: ContourLabelTile,
    cells: number,
    point: ReliefContourLabelPoint,
  ) => Label;
  /** a line's level not labelled, by the look that would */
  refuse?: (level: number, look: L) => boolean;
  /** a style's labels shown now, as `camera` is: default always */
  shownAt?: (
    style: Omit<ResolvedReliefContourLabels, 'lines'>,
    camera: Camera,
  ) => boolean;
  /** all found again when any of these is another */
  refresh?: readonly unknown[];
};

// Milliseconds a frame for finding labels; seconds between looking again at the tiles
// drawn (which ranks each needs) and between handing the labels on.
const BUDGET = 3;
const EVERY = 0.2;
// Ranks found this much farther off than they show, so they are in as they fade in; and
// the closest a rank's labels come, in rows along their line, and the most ranks.
const AHEAD = 1.25;
const LEAST_STEP = 0.5;
const MOST_RANKS = 8;
const NONE: readonly unknown[] = [];

/** A height as a contour label writes it: in metres, as few decimals as it has. */
export const contourLevelText = (level: number) =>
  String(Math.round(level * 1000) / 1000);

// A label found on a tile: its style's group, its reach class (`reliefContourLabelClass`:
// those of one class are whole within the same distance) and its rank.
type Found = { group: number; reach: number; rank: number; label: Label };

// A tile's labels found, to the rank it needed last, from what it was drawn from then.
type TileFound = {
  from: readonly unknown[];
  ground: ContourLabelGround | null;
  rank: number;
  found: Found[];
};

// One `LabelLayer`: a style's group's labels of one reach class.
type Handed = { key: string; group: number; reach: number; labels: Label[] };

const same = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * Contour lines' labels on tiles of heights (`ReliefContours.labels`): found on each tile
 * drawn from its own heights (`reliefContourLabelPoints`), each by the look that gave its
 * node, a few tiles a frame as they come in, and handed on as the tiles drawn change. A
 * relief's (`GeoReliefContourLabels`) and a `Surface`'s are this, their tiles and where a
 * label lies on them their own.
 *
 * Kept about `spacing` apart along their lines on screen at any distance: a tile's rank-0
 * labels are `2 · spacing / cellPixels` of its rows apart — `spacing` on screen as its
 * cells are drawn half `cellPixels` across, about the least they are before its parent is
 * drawn instead — and nearer, where its cells grow (the finest tiles, or flat ground,
 * which is not split), finer ranks halve that, found on a tile once the camera nears it.
 * And only where their lines are apart on screen: each label is whole within the nearer
 * of where its rank's spacing is `spacing` on screen and where the next line labelled is
 * `RELIEF_CONTOUR_LABEL_LINE_PIXELS` off (by the ground's slope under it), fading out to
 * `1 / RELIEF_CONTOUR_LABEL_FADE` of that — whatever the data's resolution, with no
 * distance of its own. A `LabelLayer` for each reach class (`reliefContourLabelClass`:
 * powers of two), its `maxDistance` that of the class at the camera's focal length.
 *
 * @internal
 */
export function ContourLabels<L extends ContourLabelLook>({
  looks,
  visible,
  cellPixels,
  source,
  place,
  refuse,
  shownAt,
  refresh = NONE,
}: ContourLabelsProps<L>) {
  // Each look's labels in a layer of their style, looks of one style in one: with how far
  // apart its rank-0 labels are in rows, and its finest rank.
  const groups = useMemo(() => {
    const keys: string[] = [];
    const ofLook = looks.map(look => {
      if (!look) return -1;
      // Its style: all but which lines.
      const { lines: _lines, ...style } = look.labels;
      const key = JSON.stringify(style);
      let group = keys.indexOf(key);
      if (group < 0) group = keys.push(key) - 1;
      return group;
    });
    const styles = keys.map(
      key => JSON.parse(key) as Omit<ResolvedReliefContourLabels, 'lines'>,
    );
    const steps = styles.map(
      style => (2 * Math.max(style.spacing, 1)) / Math.max(cellPixels, 0.25),
    );
    const ranks = steps.map(step =>
      Math.min(
        Math.max(Math.floor(Math.log2(step / LEAST_STEP)), 0),
        MOST_RANKS,
      ),
    );
    return { styles, keys, ofLook, steps, ranks };
  }, [looks, cellPixels]);

  // Each tile's labels, by its key: found once a tile and rank, again when the looks or
  // `refresh` change.
  const cache = useRef(new Map<number, TileFound>());
  const state = useRef({
    groups: null as unknown,
    refresh: NONE,
    version: -1,
    pending: false,
    dirty: false,
    looked: -Infinity,
    handed: -Infinity,
  });
  const [handed, setHanded] = useState<Handed[]>([]);
  const [shown, setShown] = useState<boolean[]>([]);
  // The camera's focal length, CSS pixels, and a depth-0 tile's row: the classes' reach.
  const [view, setView] = useState({ focal: 0, rootRow: 0 });

  // A depth-0 tile's row on the ground times `2 / cellPixels`: a reach class's unit
  // (`reliefContourLabelClass`).
  const reachUnit = (rootRow: number) =>
    (2 * rootRow) / Math.max(cellPixels, 0.25);

  // A tile's labels of ranks `from` to `to` (each look's no finer than its finest), on its
  // heights as drawn.
  const tileLabels = (
    tile: ContourLabelTile,
    ground: ContourLabelGround,
    rootRow: number,
    from: number,
    to: number,
  ): Found[] => {
    const out: Found[] = [];
    const { cells, heights, looks: marks, low, high } = ground;
    const nodes = cells + 3;
    const unit = reachUnit(rootRow);
    // The looks its own nodes take.
    const present = new Set<number>();
    if (marks) {
      for (let row = 0; row <= cells; row++)
        for (let column = 0; column <= cells; column++)
          present.add(marks[(1 + row) * nodes + 1 + column]);
    } else present.add(0);
    for (const at of present) {
      const look = looks[at] ?? null;
      if (!look) continue;
      const group = groups.ofLook[at];
      const ranks = Math.min(to, groups.ranks[group]);
      if (from > ranks) continue;
      const levels: number[] = [];
      for (let n = Math.ceil(low / look.step); n * look.step <= high; n++) {
        const level = n * look.step;
        if (!refuse?.(level, look)) levels.push(level);
      }
      if (!levels.length) continue;
      const keep =
        marks && present.size > 1
          ? (column: number, row: number) =>
              marks[(1 + row) * nodes + 1 + column] === at
          : undefined;
      for (const point of reliefContourLabelPoints(
        { cells, heights },
        levels,
        groups.steps[group],
        { aspect: tile.aspect, ranks, from, keep },
      )) {
        const reach = reliefContourLabelClass(
          unit,
          tile.depth + point.rank,
          reliefContourLineGap(
            point.rise,
            look.step,
            tile.rowMetres * tile.aspect,
            tile.rowMetres,
          ),
        );
        if (!Number.isFinite(reach)) continue;
        out.push({
          group,
          reach,
          rank: point.rank,
          label: place(tile, cells, point),
        });
      }
    }
    return out;
  };

  // The finest rank a tile needs, its nearest `away` from the camera: the finest shown
  // there (its spacing on screen at least `RELIEF_CONTOUR_LABEL_FADE` of `spacing`),
  // looking a little ahead. A rank's spacing on the ground is `2 · spacing / cellPixels`
  // rows halved by it, so this is the same for every style.
  const rankFor = (rowM: number, away: number, focal: number) => {
    const reach =
      (2 * rowM * focal * AHEAD) / (RELIEF_CONTOUR_LABEL_FADE * cellPixels);
    if (away <= 0) return MOST_RANKS;
    return Math.min(
      Math.max(Math.floor(Math.log2(reach / away)), 0),
      MOST_RANKS,
    );
  };

  useFrame(({ camera, clock, size }) => {
    // Each style's layer, shown as its own rules say.
    const on = groups.styles.map(
      style => visible && (shownAt?.(style, camera) ?? true),
    );
    if (on.join() !== shown.join()) setShown(on);
    if (!on.some(Boolean)) return;
    // CSS pixels on screen a metre across at a metre's distance, head on.
    const focal = (camera.projectionMatrix.elements[5] * size.height) / 2;
    const drawn = source(camera, focal);
    if (!drawn) return;
    if (
      drawn.rootRow !== view.rootRow ||
      Math.abs(focal - view.focal) > 0.02 * view.focal
    )
      setView({ focal, rootRow: drawn.rootRow });
    const s = state.current;
    if (s.groups !== groups || !same(s.refresh, refresh)) {
      cache.current.clear();
      s.groups = groups;
      s.refresh = refresh;
      s.version = -1;
    }
    const now = clock.elapsedTime;
    if (s.pending || drawn.version !== s.version || now - s.looked >= EVERY) {
      s.looked = now;
      const until = performance.now() + BUDGET;
      let pending = false;
      for (const key of drawn.keys()) {
        const tile = drawn.tile(key);
        if (!tile) continue;
        const rank = rankFor(tile.rowMetres, tile.away, focal);
        let found = cache.current.get(key);
        if (found && !same(found.from, tile.from)) found = undefined;
        if (found && found.rank >= rank) {
          // Ranks no longer near let go, a rank late.
          if (found.rank > rank + 1) {
            found.found = found.found.filter(f => f.rank <= rank);
            found.rank = rank;
            s.dirty = true;
          }
          continue;
        }
        if (performance.now() > until) {
          pending = true;
          break;
        }
        if (!found) {
          found = {
            from: tile.from,
            ground: tile.ground(),
            rank: -1,
            found: [],
          };
          cache.current.set(key, found);
        }
        if (found.ground)
          found.found.push(
            ...tileLabels(
              tile,
              found.ground,
              drawn.rootRow,
              found.rank + 1,
              rank,
            ),
          );
        found.rank = rank;
        s.dirty = true;
      }
      if (drawn.version !== s.version) s.dirty = true;
      s.version = drawn.version;
      s.pending = pending;
      // Tiles long not drawn let go.
      if (cache.current.size > 4 * drawn.count + 64) {
        const kept = new Set(drawn.keys());
        for (const key of [...cache.current.keys()])
          if (!kept.has(key)) cache.current.delete(key);
      }
    }
    if (!s.dirty || now - s.handed < EVERY) return;
    s.dirty = false;
    s.handed = now;
    // Each layer's labels: the same list kept where none of them changed, so it is not
    // written again.
    const lists = new Map<string, Handed>();
    for (const key of drawn.keys()) {
      const found = cache.current.get(key);
      if (!found) continue;
      for (const f of found.found) {
        const id = `${f.group}:${f.reach}`;
        let list = lists.get(id);
        if (!list) {
          list = { key: id, group: f.group, reach: f.reach, labels: [] };
          lists.set(id, list);
        }
        list.labels.push(f.label);
      }
    }
    const was = new Map(handed.map(h => [h.key, h]));
    const next = [...lists.values()]
      .sort((a, b) => a.group - b.group || a.reach - b.reach)
      .map(list => {
        const old = was.get(list.key);
        return old &&
          old.labels.length === list.labels.length &&
          old.labels.every((label, i) => label === list.labels[i])
          ? old
          : list;
      });
    if (
      next.length !== handed.length ||
      next.some((list, i) => list !== handed[i])
    )
      setHanded(next);
  });

  return (
    <>
      {handed.map(({ key, group, reach, labels }) => {
        const style = groups.styles[group];
        if (!style || !view.focal || !view.rootRow) return null;
        // Whole nearer than its class reaches, gone at `1 / RELIEF_CONTOUR_LABEL_FADE` of
        // that; or, nearer still, within the style's own `maxDistance`, fading over its last
        // quarter.
        const [whole, gone] = reliefContourLabelClassReach(
          reachUnit(view.rootRow),
          reach,
          view.focal,
        );
        const cap = style.maxDistance;
        const [maxDistance, fadeDistance] =
          cap !== undefined && cap < gone
            ? [cap, cap / 4]
            : [gone, gone - whole];
        return (
          <LabelLayer
            key={key}
            labels={labels}
            visible={shown[group] ?? false}
            size={style.size}
            sizing="screen"
            fontFamily={style.fontFamily}
            fontWeight={style.fontWeight}
            letterSpacing={0}
            color={style.color}
            opacity={style.opacity}
            haloColor={style.haloColor}
            haloWidth={style.haloWidth}
            // Barely there: never grown at a slant, only whole where they read and face the
            // camera well.
            slantGrowth={1}
            minPixels={RELIEF_CONTOUR_LABEL_MIN_PIXELS}
            minFacing={RELIEF_CONTOUR_LABEL_MIN_FACING}
            maxDistance={maxDistance}
            fadeDistance={fadeDistance}
            flip={style.flip}
            baseline={style.baseline}
            priority={RELIEF_CONTOUR_LABEL_PRIORITY}
            // Lying on the ground as drawn, lifted toward the camera about their own size (a
            // 9 px label is about 2 % of its distance across): clear of the triangles round
            // them, which they cross far off. A move along the view, so they stay where they
            // are on screen.
            lift={5}
            liftPerDistance={RELIEF_CONTOUR_LABEL_LIFT}
          />
        );
      })}
    </>
  );
}
