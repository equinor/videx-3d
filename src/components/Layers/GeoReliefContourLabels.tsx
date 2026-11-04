import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import { Vector3 } from 'three';
import {
  reliefContourLabelPoints,
  type ReliefContourLabelPoint,
} from '../../sdk/geometries/relief-contour-labels';
import type { ReliefTile } from '../../sdk/geometries/relief-tiles';
import type { Globe } from '../../sdk/projection/globe';
import {
  GEO_TILE_ROOT_SPAN,
  geoTileRegion,
} from '../../sdk/tiles/geo-tile-keys';
import { LabelLayer } from '../Labels/LabelLayer';
import type { Label } from '../Labels/types';
import { useSceneryOcean } from '../Scenery/scenery-context';
import type { SceneryReliefHub } from '../Scenery/scenery-relief-hub';
import type { ResolvedReliefContourLabels } from '../Scenery/scenery-relief-look';
import { layerShownAt } from './layer-globe';
import {
  RELIEF_CONTOUR_LABEL_FADE,
  reliefContourLabelClass,
  reliefContourLabelClassReach,
  reliefContourLineGap,
} from './relief-contour-label-reach';

/**
 * How much a relief's contour labels are wanted where labels meet on screen
 * (`LabelLayer`'s `priority`): below data labels (`GeoLabels`, 0), above the graticule's
 * names (−1).
 */
export const RELIEF_CONTOUR_LABEL_PRIORITY = -0.5;

/** The least a contour label reads whole at, CSS pixels as seen (`LabelStyle.minPixels`): a 9 px one on a moderate slope. */
export const RELIEF_CONTOUR_LABEL_MIN_PIXELS = 6;

/** How squarely a contour label must face the camera to be whole (`LabelStyle.minFacing`): none toward the horizon. */
export const RELIEF_CONTOUR_LABEL_MIN_FACING = 0.3;

/** A contour label's lift toward the camera for each metre of its distance (`LabelStyle.liftPerDistance`). */
export const RELIEF_CONTOUR_LABEL_LIFT = 0.02;

/** The contour lines one of a relief's looks labels (`ReliefContours.labels`). */
export type ReliefContourLabelLook = {
  /** metres between the lines labelled, from the sea's level */
  step: number;
  /** under the sea's level too */
  seabed: boolean;
  labels: ResolvedReliefContourLabels;
};

const DEG = Math.PI / 180;
const EARTH_RADIUS = 6371000;
// Milliseconds a frame for finding labels; seconds between looking again at the tiles
// drawn (which ranks each needs) and between handing the labels on.
const BUDGET = 3;
const EVERY = 0.2;
// Ranks found this much farther off than they show, so they are in as they fade in; and
// the closest a rank's labels come, in rows along their line, and the most ranks.
const AHEAD = 1.25;
const LEAST_STEP = 0.5;
const MOST_RANKS = 8;

const here = new Vector3();
const up = new Vector3();
const eastward = new Vector3();
const northward = new Vector3();
const normal = new Vector3();
const direction = new Vector3();

// A height as a label writes it: in metres, as few decimals as it has.
const levelText = (level: number) => String(Math.round(level * 1000) / 1000);

// A row's height on the ground, metres, of a tile `span` degrees across in `cells`.
const rowMetres = (span: number, cells: number) =>
  (span / cells) * DEG * EARTH_RADIUS;

// A geographic tile's depth from its span.
const depthOf = (span: number) =>
  Math.round(Math.log2(GEO_TILE_ROOT_SPAN / span));

// Its label on the globe: lying on the ground at its line's height, tilted with it, reading
// along it.
function contourLabel(
  key: number,
  cells: number,
  point: ReliefContourLabelPoint,
  globe: Globe,
): Label {
  const [west, north, span] = geoTileRegion(key);
  const longitude = west + (point.column / cells) * span;
  const latitude = north - (point.row / cells) * span;
  // On the ground as drawn, on its triangle.
  const h = point.height;
  globe.geodetic(latitude, longitude, h, here);
  globe.upAt(here, up);
  globe
    .geodetic(latitude, longitude + 1e-4, h, eastward)
    .sub(here)
    .normalize();
  globe
    .geodetic(latitude + 1e-4, longitude, h, northward)
    .sub(here)
    .normalize();
  // Metres a row (south) and a column (east).
  const row = rowMetres(span, cells);
  const column = row * Math.cos(latitude * DEG);
  // Up, leaning against the ground's rise east and north.
  normal
    .copy(up)
    .addScaledVector(eastward, -point.rise[0] / column)
    .addScaledVector(northward, point.rise[1] / row)
    .normalize();
  direction
    .copy(eastward)
    .multiplyScalar(point.along[0] * column)
    .addScaledVector(northward, -point.along[1] * row)
    .normalize();
  return {
    text: levelText(point.level),
    position: here.toArray(),
    normal: normal.toArray(),
    direction: direction.toArray(),
    id: `${key}:${point.level}:${Math.round(point.column * 8)}:${Math.round(point.row * 8)}`,
  };
}

// A label found on a tile: its style's group, its reach class (`reliefContourLabelClass`:
// those of one class are whole within the same distance) and its rank.
type Found = { group: number; reach: number; rank: number; label: Label };

// A tile's labels found, to the rank it needed last.
type TileFound = { tile: ReliefTile; rank: number; found: Found[] };

// One `LabelLayer`: a style's group's labels of one reach class.
type Handed = { key: string; group: number; reach: number; labels: Label[] };

/**
 * GeoReliefContourLabels props
 * @internal
 */
type GeoReliefContourLabelsProps = {
  /** the relief's tiles as drawn */
  hub: SceneryReliefHub;
  globe: Globe;
  /** per look (0 the relief's, 1 + i its layer i's, as its tiles mark their nodes): what it labels, or null */
  looks: (ReliefContourLabelLook | null)[];
  /** the sea's water over the seabed: no labels under the sea's level */
  water: boolean;
  visible: boolean;
  /** the most a relief tile's cell spans on screen before it is split (`GeoRelief`'s `cellPixels`) */
  cellPixels: number;
};

/**
 * A relief's contour lines' labels (`ReliefContours.labels`): found on each relief tile
 * drawn from its own heights (`reliefContourLabelPoints`), each by the look that gave its
 * node, a few tiles a frame as they come in, and handed on as the tiles drawn change.
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
export const GeoReliefContourLabels = ({
  hub,
  globe,
  looks,
  water,
  visible,
  cellPixels,
}: GeoReliefContourLabelsProps) => {
  const ocean = useSceneryOcean();
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

  // Each tile's labels, by its key: found once a tile and rank, again when the looks, the
  // sea or the globe change.
  const cache = useRef(new Map<number, TileFound>());
  const state = useRef({
    groups: null as unknown,
    water: false,
    location: null as unknown,
    version: -1,
    pending: false,
    dirty: false,
    looked: -Infinity,
    handed: -Infinity,
  });
  const [handed, setHanded] = useState<Handed[]>([]);
  const [shown, setShown] = useState<boolean[]>([]);
  // The camera's focal length, CSS pixels, and the relief tiles' cells: the classes' reach.
  const [view, setView] = useState({ focal: 0, cells: 0 });

  // A tile's labels of ranks `from` to `to` (each look's no finer than its finest).
  const tileLabels = (
    key: number,
    tile: ReliefTile,
    from: number,
    to: number,
  ): Found[] => {
    const out: Found[] = [];
    const { cells, layers } = tile;
    const nodes = cells + 3;
    const [, north, span] = geoTileRegion(key);
    const depth = depthOf(span);
    const aspect = Math.cos((north - span / 2) * DEG);
    const rowM = rowMetres(span, cells);
    const unit = reachUnit(cells);
    // The looks its own nodes take.
    const present = new Set<number>();
    for (let row = 0; row <= cells; row++)
      for (let column = 0; column <= cells; column++)
        present.add(layers[(1 + row) * nodes + 1 + column]);
    for (const at of present) {
      const look = looks[at] ?? null;
      if (!look) continue;
      const group = groups.ofLook[at];
      const ranks = Math.min(to, groups.ranks[group]);
      if (from > ranks) continue;
      const dry = water || !look.seabed;
      const levels: number[] = [];
      for (
        let n = Math.ceil(tile.min / look.step);
        n * look.step <= tile.max;
        n++
      ) {
        const level = n * look.step;
        // Not on the coastline, nor under the sea where it is not labelled.
        if (level === 0 || (level < 0 && dry)) continue;
        levels.push(level);
      }
      if (!levels.length) continue;
      const keep =
        present.size > 1
          ? (column: number, row: number) =>
              layers[(1 + row) * nodes + 1 + column] === at
          : undefined;
      for (const point of reliefContourLabelPoints(
        tile,
        levels,
        groups.steps[group],
        { aspect, ranks, from, keep },
      )) {
        const reach = reliefContourLabelClass(
          unit,
          depth + point.rank,
          reliefContourLineGap(point.rise, look.step, rowM * aspect, rowM),
        );
        if (!Number.isFinite(reach)) continue;
        out.push({
          group,
          reach,
          rank: point.rank,
          label: contourLabel(key, cells, point, globe),
        });
      }
    }
    return out;
  };

  // A depth-0 tile's row on the ground times `2 / cellPixels`: a reach class's unit
  // (`reliefContourLabelClass`).
  const reachUnit = (cells: number) =>
    (2 * rowMetres(GEO_TILE_ROOT_SPAN, cells)) / Math.max(cellPixels, 0.25);

  // The finest rank a tile needs, its nearest `away` metres from the camera: the finest
  // shown there (its spacing on screen at least `RELIEF_CONTOUR_LABEL_FADE` of `spacing`),
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
    // Each style's layer, shown on the ground below its height.
    const on = groups.styles.map(
      style =>
        visible &&
        layerShownAt(
          camera.position,
          globe,
          ocean,
          { maxHeight: style.maxHeight },
          'ground',
        ) > 0,
    );
    if (on.join() !== shown.join()) setShown(on);
    const drawn = hub.current;
    if (!drawn || !on.some(Boolean) || !globe.frame) return;
    // CSS pixels on screen a metre across at a metre's distance, head on.
    const focal = (camera.projectionMatrix.elements[5] * size.height) / 2;
    if (
      drawn.cells !== view.cells ||
      Math.abs(focal - view.focal) > 0.02 * view.focal
    )
      setView({ focal, cells: drawn.cells });
    const s = state.current;
    if (
      s.groups !== groups ||
      s.water !== water ||
      s.location !== globe.location
    ) {
      cache.current.clear();
      s.groups = groups;
      s.water = water;
      s.location = globe.location;
      s.version = -1;
    }
    const now = clock.elapsedTime;
    if (
      s.pending ||
      drawn.keysVersion !== s.version ||
      now - s.looked >= EVERY
    ) {
      s.looked = now;
      const until = performance.now() + BUDGET;
      let pending = false;
      for (const key of drawn.index.keys()) {
        const tile = drawn.tileAt(key);
        if (!tile) continue;
        // Its nearest to the camera: from its middle, less half its diagonal and its rise.
        const [west, north, span] = geoTileRegion(key);
        const rowM = rowMetres(span, tile.cells);
        const middle = north - span / 2;
        globe.geodetic(
          middle,
          west + span / 2,
          (tile.min + tile.max) / 2,
          here,
        );
        const across = tile.cells * rowM;
        const half =
          Math.hypot(across, across * Math.cos(middle * DEG)) / 2 +
          (tile.max - tile.min) / 2;
        const away = Math.max(here.distanceTo(camera.position) - half, 0);
        const rank = rankFor(rowM, away, focal);
        let found = cache.current.get(key);
        if (found && found.tile !== tile) found = undefined;
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
        const from = found ? found.rank + 1 : 0;
        const more = tileLabels(key, tile, from, rank);
        if (found) {
          found.found.push(...more);
          found.rank = rank;
        } else cache.current.set(key, { tile, rank, found: more });
        s.dirty = true;
      }
      if (drawn.keysVersion !== s.version) s.dirty = true;
      s.version = drawn.keysVersion;
      s.pending = pending;
      // Tiles long not drawn let go.
      if (cache.current.size > 4 * drawn.index.size + 64)
        for (const key of [...cache.current.keys()])
          if (!drawn.index.has(key)) cache.current.delete(key);
    }
    if (!s.dirty || now - s.handed < EVERY) return;
    s.dirty = false;
    s.handed = now;
    // Each layer's labels: the same list kept where none of them changed, so it is not
    // written again.
    const lists = new Map<string, Handed>();
    for (const key of drawn.index.keys()) {
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
        if (!style || !view.focal || !view.cells) return null;
        // Whole nearer than its class reaches, gone at `1 / RELIEF_CONTOUR_LABEL_FADE` of
        // that; or, nearer still, within the style's own `maxDistance`, fading over its last
        // quarter.
        const [whole, gone] = reliefContourLabelClassReach(
          reachUnit(view.cells),
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
};
