import { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useArgs } from 'storybook/preview-api';
import { createWellboreOutline, Vec2, Vec3 } from '../../../sdk';
import { getSplineCurve } from '../../../sdk/geometries/curve/curve-3d';
import {
  fenceBlockTrace,
  fenceCoreInputs,
  prepareFenceTrace,
  sampleTrajectoryPlan,
  WellboreFenceOptions,
} from '../../../sdk/geometries/wellbore-fence';
import { CRS, getProjectionDefFromUtmZone } from '../../../sdk/projection/crs';
import { buildFenceCut, HeadArmPlan, TdArmPlan } from '../../../sdk/utils/fence-run-out';
import {
  FenceSideName,
  oneSidedOffset,
  RodOverlapError,
  TransitionDebug,
} from '../../../sdk/utils/one-sided-offset';
import {
  convexHull2D,
  createPolylineIndex,
  nearestOnPolyline,
  pointAtArcLength,
  polylineArcLengths,
  polylineBounds2D,
  polylineWorstTurn,
} from '../../../sdk/utils/polyline-2d';
import {
  EXTRA_WELLBORE_IDS,
  isExtraWellbore,
  withExtraWellbores,
} from '../../../storybook/data/extra-wellbores';
import storyArgs from '../../../storybook/story-args.json';
import { debugOutlineRings } from './outline-rings';
import { HullShape, syntheticObstacle, syntheticWell } from './synthetic-scene';

type HullPivot = 'centre' | 'start' | 'end';

/**
 * The STIFF ROD — how a cut gets round an obstacle ring, on its own.
 *
 * ⭐ PLAN view of ONE thing: each obstacle transition of the two cores, with the ring path it is
 * seeded from (purple), the anchored span it is settled over (dashed, clamps as white dots) and
 * the rod that ships (red). A synthetic scene gives a clean ring — a well turning by a chosen
 * angle at an obstacle of a chosen shape, length and width — before the same construction is
 * looked at on a real head. Nothing here touches the production fence.
 *
 * Navigation: **drag to brush-zoom**, wheel to zoom at the cursor, middle-drag or shift-drag to
 * pan, double-click to frame the field.
 */

type Header = { id: string; name: string; easting: number; northing: number };

// Storybook drops URL args whose value has a `/`, so the arg is the short name (`F-12`, `F-1 C`).
const shortName = (full: string) => full.replace(/^NO 15\/9-/, '');
const FULL_NAME = new Map(
  Object.values(storyArgs.wellboreOptions as Record<string, string>).map(
    full => [shortName(full), full] as const,
  ),
);
const WELLBORES = [
  ...[...FULL_NAME.keys()].sort((a, b) => a.localeCompare(b)),
  ...EXTRA_WELLBORE_IDS,
];
const OUTLINE = { radius: 1500, feather: 1, smoothing: 2 };

type SceneKind = 'wellbore' | 'synthetic';

function useVolve() {
  const [data, setData] = useState<{
    headers: Record<string, Header>;
    logs: Record<string, number[]>;
  } | null>(null);
  useEffect(() => {
    Promise.all([
      fetch('data/wellbore-headers.json').then(r => r.json()),
      fetch('data/position-logs.json').then(r => r.json()),
    ])
      .then(([headers, logs]) => setData(withExtraWellbores(headers, logs)))
      .catch(() => setData(null));
  }, []);
  return data;
}

type Props = {
  scene: SceneKind;
  wellbore: string;
  margin: number;
  /** leave out the trajectory above this TVD, metres (0 = no limit) */
  tvdFrom: number;
  /** leave out the trajectory below this TVD, metres (0 = no limit) */
  tvdTo: number;
  /** footprint: 0 = the field outline, else a square this many km across at the scene origin */
  crop: number;
  /** the head arm's bearing — see `FenceArmsOptions.headBearing` */
  headBearing: 'opposite-td' | 'free';
  /** the least angle between a free head arm and the TD arm, degrees */
  headMinTdAngle: number;
  /** the synthetic well's turn at the obstacle, degrees: 0 straight through, 90 a right angle */
  wellTurn: number;
  /** the synthetic hull's length along its own axis and width across it, metres */
  diameter: number;
  width: number;
  hull: HullShape;
  hullAngle: number;
  hullPivot: HullPivot;
  side: FenceSideName | 'both';
  rodStiffness: number;
  /** a global multiple on the rod's measured anchor lengths; 1 = as measured */
  anchorScale: number;
  /** diagnostics (candidate): aligned concave clamps */
  anchorBalanced: boolean;
  showWell: boolean;
  showHull: boolean;
  showZone: boolean;
  showCores: boolean;
  showCut: boolean;
  showPath: boolean;
  showSeed: boolean;
  showAnchors: boolean;
  showAnchorLabels: boolean;
  showRod: boolean;
  showFailures: boolean;
  size: number;
  /** injected by the decorator: write a report row's settings into the story args */
  onPick?: (patch: Partial<Props>) => void;
};

const COLOURS = {
  grid: '#12151a',
  footprint: '#2b3a45',
  well: '#eceff1',
  degenerate: '#90a4ae',
  leftCut: '#00e5ff',
  rightCut: '#ffea00',
  hull: '#ffd54f',
  ring: '#ba68c8',
  hug: '#ba68c8',
  seed: '#80d8ff',
  clamp: '#ffffff',
  rod: '#ff5252',
  contact: '#ffffff',
  brush: '#00e5ff',
  runA: '#69f0ae',
  runB: '#f48fb1',
};

/** The plan camera: a world centre and metres-to-pixels. */
type View = { cx: number; cy: number; scale: number };

/** What one scene hands the offset: the trace to offset, the real well, and the obstacles. */
type Scene = {
  /** the curve the cores are offset from — the plan's virtual well when a head is planned */
  trace: Vec2[];
  /** the real well, for the arms' gates and the drawing */
  well: Vec2[];
  obstacles: Vec2[][];
  /** the field outline the arms reach past — none for a synthetic scene */
  rings: Vec2[][];
  headArm: HeadArmPlan | null;
  /** the TD routed round the obstacle over it */
  tdPlan: TdArmPlan | null;
  /** the head lies outside the footprint, so the cut is built with no head arm */
  headOpen: boolean;
  /** the TD lies inside the footprint and gets its run-out */
  tdArm: boolean;
  /** the whole trajectory's plan, when the block trimmed it — drawn as context */
  untrimmed: Vec2[] | null;
  /** the trajectory never enters the block, so nothing is built */
  outside: boolean;
  /** the stretch that ships — the offset's `keep`, which cuts the run-on cores back to the block */
  trim: { head?: Vec2; td?: Vec2 };
  /** the well the TD bearing is read from — the block's trace with the head's run-on in front */
  bearing?: Vec2[];
  /** why the production build rejects this scene before the cores (e.g. an unplannable head) */
  failed: string | null;
  notes: string[];
  /** the scene re-planned with the two hulls of a rod overlap fused, as `buildWellboreFence` does */
  replan?: (hulls: [Vec2[], Vec2[]]) => Scene | null;
};

type SideResult = {
  core: Vec2[] | null;
  transitions: TransitionDebug[];
  error: string | null;
  /** the two hulls whose rods overlapped */
  overlap?: [Vec2[], Vec2[]];
};

type Model = {
  scene: Scene;
  margin: number;
  sides: Record<FenceSideName, SideResult>;
  /** the finished cut with the run-out arms — wellbore scene only */
  cut: { left: Vec2[]; right: Vec2[] } | null;
  /** the cut's gate flags (CROSSES WELL, …) and the error if the arms could not be built */
  cutFlags: string[];
  cutError: string | null;
  notes: string[];
  ms: number;
};

/**
 * The synthetic scene: a well turning by `turn` degrees at an obstacle of the given shape,
 * length and width. The hull is DECLARED the obstacle — the well inside it is degenerate by
 * the one rule, so whether it wanders there or not changes nothing.
 */
function syntheticScene(
  turn: number,
  shape: HullShape,
  length: number,
  width: number,
  angle: number,
  pivot: HullPivot = 'centre',
): Scene {
  const reach = Math.max(600, Math.max(length, width) * 4);
  const well = syntheticWell(turn, reach);
  return {
    trace: well,
    well,
    obstacles: [syntheticObstacle(shape, [0, 0], length, width, angle, pivot)],
    rings: [],
    headArm: null,
    tdPlan: null,
    headOpen: false,
    tdArm: true,
    untrimmed: null,
    outside: false,
    trim: {},
    failed: null,
    notes: [
      `well ${turn === 0 ? 'straight through' : `turning ${turn}° at`} a declared ${length}×${width} m ${shape}${angle ? ` turned ${angle}°` : ''}`,
    ],
  };
}

/**
 * A real well with its head planned — the trace the production cores are offset from, trimmed to
 * the block exactly as `buildWellboreFence` trims it.
 */
function wellboreScene(
  trajectory: Vec3[],
  rings: Vec2[][],
  margin: number,
  verticalRange?: [number, number],
  head: Pick<WellboreFenceOptions, 'headBearing' | 'headMinTdAngle'> = {},
  fuse: Vec2[][] = [],
): Scene | null {
  const curve = getSplineCurve(trajectory);
  if (!curve) return null;
  const wholePlan = (): Vec2[] => {
    const s = sampleTrajectoryPlan(curve, undefined);
    return s ? prepareFenceTrace(curve, s, {}).points : [];
  };
  const block = fenceBlockTrace(curve, rings, { margin, verticalRange });
  const bare = {
    obstacles: [],
    rings,
    headArm: null,
    tdPlan: null,
    headOpen: false,
    tdArm: false,
    untrimmed: null,
    trim: {},
  };
  if (!block) {
    const well = wholePlan();
    if (well.length < 2) return null;
    return {
      ...bare,
      trace: well,
      well,
      outside: true,
      failed: null,
      notes: ['never enters the block — no fence is built'],
    };
  }
  const { span } = block;
  const well = prepareFenceTrace(block.curve, block.samples, {}).points;
  const untrimmed = block.curve !== curve ? wholePlan() : null;
  const notes: string[] = [
    `block: ${(span.inside * 100).toFixed(0)}% inside · MD ${span.md[0].toFixed(0)}–${span.md[1].toFixed(0)} m · head ${span.headArm ? 'armed' : 'OPEN'} · TD ${span.tdArm ? 'armed' : 'OPEN'}`,
  ];
  let inputs: ReturnType<typeof fenceCoreInputs>;
  try {
    inputs = fenceCoreInputs(curve, block, well, margin, rings, { ...head, fuse });
  } catch (e) {
    const failed = e instanceof Error ? e.message : String(e);
    notes.push(`✖ ${failed}`);
    return { ...bare, trace: well, well, untrimmed, outside: false, failed, notes };
  }
  const { headArm, reach, tdPlan } = inputs;
  notes.push(`cores run on past the block: head ${reach[0].toFixed(0)} m · TD ${reach[1].toFixed(0)} m`);
  if (fuse.length > 0) notes.push(`rods overlapped: re-planned with ${fuse.length} hull pair(s) fused`);
  if (tdPlan?.divert) {
    notes.push(`TD: diverted ${((tdPlan.divert * 180) / Math.PI).toFixed(0)}° so the head clears the well`);
  } else if (tdPlan) notes.push('TD: routed round the obstacle over it');
  if (!span.headArm) notes.push('head: outside the footprint — no head arm');
  if (headArm) {
    const b = polylineBounds2D(headArm.wrap.ring);
    notes.push(
      `head ring ${Math.round(b[2] - b[0])}×${Math.round(b[3] - b[1])} m · guide ${headArm.guideLength.toFixed(0)} m${headArm.framing ? ` · absorbed pockets framed at their ${headArm.framing === 'loop' ? 'mouths' : 'necks'}` : ''}${headArm.degenerate ? ' · DEGENERATE well' : ''}${headArm.shift !== 0 ? ` · shifted ${Math.abs(headArm.shift).toFixed(0)} m (${headArm.shiftReason})` : ''}${headArm.turnRadius > 0 ? ` · turn laid at R ${headArm.turnRadius.toFixed(0)} m` : ''}`,
    );
  }
  return {
    trace: inputs.trace,
    well,
    obstacles: inputs.route,
    rings,
    headArm,
    tdPlan,
    headOpen: !span.headArm,
    tdArm: span.tdArm,
    untrimmed,
    outside: false,
    trim: inputs.trim,
    bearing: inputs.bearing,
    failed: null,
    notes,
    replan: hulls =>
      wellboreScene(trajectory, rings, margin, verticalRange, head, [
        ...fuse,
        convexHull2D([...hulls[0], ...hulls[1]]),
      ]),
  };
}

function buildModel(
  scene: Scene | null,
  margin: number,
  rodStiffness: number,
  anchorScale: number,
  anchorBalanced = false,
): Model | null {
  if (!scene) return null;
  const t0 = performance.now();
  const notes = [...scene.notes];
  if (scene.outside || scene.failed) {
    const none: SideResult = { core: null, transitions: [], error: null };
    return {
      scene,
      margin,
      sides: { left: none, right: none },
      cut: null,
      cutFlags: [],
      cutError: null,
      notes,
      ms: performance.now() - t0,
    };
  }
  const build = (side: FenceSideName): SideResult => {
    const transitions: TransitionDebug[] = [];
    try {
      const off = oneSidedOffset(scene.trace, side, margin, {
        obstacles: scene.obstacles,
        rodStiffness,
        rodAnchor: { scale: anchorScale, balanced: anchorBalanced },
        keep: scene.trim,
        debug: transitions,
      });
      return { core: off.points, transitions, error: null };
    } catch (e) {
      return {
        core: null,
        transitions,
        error: e instanceof Error ? e.message : String(e),
        overlap: e instanceof RodOverlapError ? e.hulls : undefined,
      };
    }
  };
  const sides: Model['sides'] = { left: build('left'), right: build('right') };
  const overlap = sides.left.overlap ?? sides.right.overlap;
  const replanned = overlap && scene.replan ? scene.replan(overlap) : null;
  if (replanned && (replanned.failed || replanned.obstacles.length < scene.obstacles.length)) {
    return buildModel(replanned, margin, rodStiffness, anchorScale, anchorBalanced);
  }
  for (const side of ['left', 'right'] as const) {
    const s = sides[side];
    const rods = s.transitions.filter(t => t.seed);
    const describe = (t: TransitionDebug) => {
      const shipped = t.seam ?? [];
      const turn = shipped.length >= 3 ? polylineWorstTurn(shipped).turn : 0;
      const bits = [
        t.ring.length >= 3 ? 'ring' : 'no ring',
        `atom ${t.atom?.toFixed(1) ?? '—'} m`,
        `path ${t.traced.length}v`,
      ];
      if (t.anchor) {
        bits.push(
          `anchor A ${t.anchor[0].toFixed(0)} m · B ${t.anchor[1].toFixed(0)} m`,
        );
        bits.push(`seed ${t.seed?.length ?? 0}v`);
        bits.push(`rod ${shipped.length}v · ${t.contacts?.length ?? 0} contact(s)`);
      }
      bits.push(`worst turn ${((turn * 180) / Math.PI).toFixed(0)}°`);
      return bits.join(' · ');
    };
    notes.push(
      `${side}: ${s.core ? `BUILT ${s.core.length}pt` : 'FAILED'} · ${rods.length} transition(s)`,
    );
    for (const t of rods) notes.push(`  ${describe(t)}`);
    if (s.error) notes.push(`  ✖ ${s.error}`);
  }
  let cut: Model['cut'] = null;
  let cutFlags: string[] = [];
  let cutError: string | null = null;
  if ((scene.headArm || scene.headOpen) && sides.left.core && sides.right.core) {
    try {
      const built = buildFenceCut(
        scene.well,
        { left: sides.left.core, right: sides.right.core },
        margin,
        scene.rings,
        {
          wellIndex: createPolylineIndex(scene.well),
          headArm: scene.headArm,
          tdPlan: scene.tdPlan,
          tdArm: scene.tdArm,
          bearingWell: scene.bearing,
          allowDefects: true,
          rodStiffness,
        },
      );
      cut = { left: built.left, right: built.right };
      cutFlags = [
        built.crosses ? 'CROSSES WELL' : '',
        built.selfCrosses ? 'SELF-CROSSES' : '',
        built.steep ? 'STEEP' : '',
        built.buries ? 'BURIES' : '',
      ].filter(Boolean);
      notes.push(
        `cut: worst turn left ${((built.worstTurn.left.turn * 180) / Math.PI).toFixed(0)}° · right ${((built.worstTurn.right.turn * 180) / Math.PI).toFixed(0)}°${cutFlags.length ? ` ⚠ ${cutFlags.join(', ')}` : ''}`,
      );
    } catch (e) {
      cutError = e instanceof Error ? e.message : String(e);
      notes.push(`cut: ${cutError}`);
    }
  }
  return {
    scene,
    margin,
    sides,
    cut,
    cutFlags,
    cutError,
    notes,
    ms: performance.now() - t0,
  };
}

function RodPlanView({
  model,
  size,
  fitKey,
  side,
  layers,
}: {
  model: Model | null;
  size: number;
  /** changes when a different subject is being looked at — the only thing that re-frames the view */
  fitKey: string;
  side: FenceSideName | 'both';
  layers: Pick<
    Props,
    | 'showWell'
    | 'showHull'
    | 'showZone'
    | 'showCores'
    | 'showCut'
    | 'showPath'
    | 'showSeed'
    | 'showAnchors'
    | 'showAnchorLabels'
    | 'showRod'
    | 'showFailures'
  >;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [brush, setBrush] = useState<{
    from: Vec2;
    to: Vec2;
    pan: boolean;
  } | null>(null);

  /** The view that frames the footprint — one scale for every wellbore; a synthetic scene frames its rings, else the well. */
  const fitted = useCallback((): View | null => {
    if (!model) return null;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    const take = (p: Vec2) => {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1];
      if (p[1] > maxZ) maxZ = p[1];
    };
    let pad = 1.1;
    for (const ring of model.scene.rings) for (const p of ring) take(p);
    if (!(maxX > minX)) {
      for (const s of Object.values(model.sides)) {
        for (const t of s.transitions) {
          for (const p of t.ring) take(p);
          for (const p of t.seed ?? []) take(p);
        }
      }
      if (maxX > minX) pad = 1.6;
      else for (const p of model.scene.well) take(p);
    }
    if (!(maxX > minX) || !(maxZ > minZ)) return null;
    const span = Math.max(maxX - minX, maxZ - minZ) * pad;
    return {
      cx: (minX + maxX) / 2,
      cy: (minZ + maxZ) / 2,
      scale: (size - 24) / span,
    };
  }, [model, size]);

  const shapeKey = `${fitKey}|${size}|${!!model}`;
  useEffect(() => {
    setView(fitted());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey]);

  const toWorld = useCallback(
    (sx: number, sy: number, v: View): Vec2 => [
      (sx - size / 2) / v.scale + v.cx,
      (sy - size / 2) / v.scale + v.cy,
    ],
    [size],
  );

  const pointerAt = (e: React.MouseEvent): Vec2 => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const onWheel = (e: WheelEvent) => {
    if (!view) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = toWorld(sx, sy, view);
    const scale = view.scale * Math.exp(-e.deltaY * 0.0015);
    const after = toWorld(sx, sy, { ...view, scale });
    setView({
      cx: view.cx + before[0] - after[0],
      cy: view.cy + before[1] - after[1],
      scale,
    });
  };
  // React registers `wheel` as passive at the root, so only a native listener can stop the page scrolling.
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const handler = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!view) return;
    const at = pointerAt(e);
    setBrush({ from: at, to: at, pan: e.button !== 0 || e.shiftKey });
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!brush || !view) return;
    const at = pointerAt(e);
    if (brush.pan) {
      setView({
        ...view,
        cx: view.cx - (at[0] - brush.to[0]) / view.scale,
        cy: view.cy - (at[1] - brush.to[1]) / view.scale,
      });
    }
    setBrush({ ...brush, to: at });
  };
  const onMouseUp = () => {
    if (!brush || !view) return;
    const [x0, y0] = brush.from;
    const [x1, y1] = brush.to;
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    if (!brush.pan && w > 12 && h > 12) {
      const a = toWorld(Math.min(x0, x1), Math.min(y0, y1), view);
      const b = toWorld(Math.max(x0, x1), Math.max(y0, y1), view);
      setView({
        cx: (a[0] + b[0]) / 2,
        cy: (a[1] + b[1]) / 2,
        scale: Math.min(size / (b[0] - a[0]), size / (b[1] - a[1])),
      });
    }
    setBrush(null);
  };

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    context.fillStyle = COLOURS.grid;
    context.fillRect(0, 0, size, size);
    if (!model || !view) return;

    const span = size / view.scale;
    const scale = view.scale;
    const toX = (x: number) => (x - view.cx) * scale + size / 2;
    const toY = (z: number) => (z - view.cy) * scale + size / 2;

    const stroke = (
      points: Vec2[],
      colour: string,
      lineWidth = 1.5,
      close = false,
      dash: number[] = [],
    ) => {
      if (points.length < 2) return;
      context.strokeStyle = colour;
      context.lineWidth = lineWidth;
      context.setLineDash(dash);
      context.beginPath();
      context.moveTo(toX(points[0][0]), toY(points[0][1]));
      for (let i = 1; i < points.length; i++) {
        context.lineTo(toX(points[i][0]), toY(points[i][1]));
      }
      if (close) context.closePath();
      context.stroke();
      context.setLineDash([]);
    };
    const dot = (p: Vec2, colour: string, r = 2.5) => {
      context.fillStyle = colour;
      context.beginPath();
      context.arc(toX(p[0]), toY(p[1]), r, 0, Math.PI * 2);
      context.fill();
    };

    const shown = (s: FenceSideName) => side === 'both' || side === s;

    for (const ring of model.scene.rings) {
      stroke(ring, COLOURS.footprint, 1, true);
    }
    if (layers.showHull) {
      for (const hull of model.scene.obstacles) {
        stroke(hull, COLOURS.hull, 1.5, true);
      }
    }
    for (const s of ['left', 'right'] as const) {
      for (const t of model.sides[s].transitions) {
        if (layers.showZone && t.ring.length >= 3) {
          stroke(t.ring, COLOURS.ring, 1, true, [5, 4]);
        }
      }
    }
    if (layers.showWell) {
      // the trajectory the block left out, then the well the cut is built around
      if (model.scene.untrimmed) {
        stroke(model.scene.untrimmed, COLOURS.degenerate, 1, false, [2, 4]);
      }
      // the well is drawn whole; the virtual guide of a planned head is the trace's extra stretch
      stroke(model.scene.well, COLOURS.well, 1.25);
      if (model.scene.headArm) {
        stroke(model.scene.headArm.guide, COLOURS.degenerate, 1.25, false, [
          4, 3,
        ]);
      }
      if (model.scene.tdPlan) {
        stroke(
          [...(model.scene.tdPlan.lead ?? []), ...[...model.scene.tdPlan.guide].reverse()],
          COLOURS.degenerate,
          1.25,
          false,
          [4, 3],
        );
      }
    }
    for (const s of ['left', 'right'] as const) {
      const result = model.sides[s];
      if (!shown(s)) continue;
      const cutColour = s === 'left' ? COLOURS.leftCut : COLOURS.rightCut;
      if (layers.showCores && result.core) stroke(result.core, cutColour, 1.5);
      for (const t of result.transitions) {
        if (!t.seed) continue;
        if (layers.showPath && t.ring.length >= 3 && t.traced.length >= 2) {
          stroke(t.traced, COLOURS.hug, 3.5);
          for (const p of t.traced) dot(p, COLOURS.hug, 2);
        }
        if (layers.showSeed && t.seed && t.seed.length >= 2) {
          stroke(t.seed, COLOURS.seed, 1, false, [3, 3]);
          for (const p of t.seed) dot(p, COLOURS.seed, 1.5);
          const n = t.seed.length;
          for (const k of [0, 1, n - 2, n - 1]) {
            if (t.seed[k]) dot(t.seed[k], COLOURS.clamp, 3.5);
          }
        }
        if ((layers.showAnchors || layers.showAnchorLabels) && t.turn && t.seed && t.seed.length >= 4) {
          for (const end of ['A', 'B'] as const) {
            const k = end === 'A' ? 0 : 1;
            const g = t.turn[k];
            const seed = t.seed;
            const n = seed.length;
            const clamp = end === 'A' ? seed[1] : seed[n - 2];
            const anchor = t.anchor ? t.anchor[k] : 0;
            const atom = t.atom ?? 1;
            const colour = end === 'A' ? COLOURS.runA : COLOURS.runB;
            // the anchor is measured along the seed from the run end, towards the clamp
            const arcs = polylineArcLengths(seed);
            const atEnd = nearestOnPolyline(seed, g.runEnd[0], g.runEnd[1])?.along ?? 0;
            const sign = end === 'A' ? -1 : 1;
            const laid = end === 'A' ? atEnd : arcs[n - 1] - atEnd;
            const short = anchor - laid > 0.25 * atom;
            if (layers.showAnchors) {
              const on = (d: number): Vec2 => pointAtArcLength(seed, arcs, atEnd + sign * Math.min(d, laid));
              // past the seed's end, the stretch the rule wanted but the seed did not get
              const tip = end === 'A' ? seed[0] : seed[n - 1];
              const prev = end === 'A' ? seed[1] : seed[n - 2];
              const tl = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]) || 1;
              const out: Vec2 = [(tip[0] - prev[0]) / tl, (tip[1] - prev[1]) / tl];
              const at = (d: number): Vec2 =>
                d <= laid ? on(d) : [tip[0] + out[0] * (d - laid), tip[1] + out[1] * (d - laid)];
              const steps = Math.max(2, Math.ceil((4 * laid) / atom));
              stroke(Array.from({ length: steps + 1 }, (_, s) => on((laid * s) / steps)), colour, 1, false, [2, 4]);
              if (short) {
                context.globalAlpha = 0.4;
                stroke([tip, at(anchor)], colour, 1, false, [2, 4]);
                context.globalAlpha = 1;
              }
              context.strokeStyle = colour;
              context.fillStyle = colour;
              context.lineWidth = 1;
              context.font = '10px monospace';
              const reach = Math.max(laid, anchor);
              for (let i = 1; i * atom <= reach + 1e-6 && i <= 200; i++) {
                const d = i * atom;
                const a = at(Math.max(0, d - 0.01 * atom));
                const b = at(d + 0.01 * atom);
                const bl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
                const nx = -(b[1] - a[1]) / bl;
                const ny = (b[0] - a[0]) / bl;
                const q = at(d);
                const qx = toX(q[0]);
                const qy = toY(q[1]);
                const len = i % 5 === 0 ? 7 : 3;
                context.globalAlpha = d > laid + 1e-6 ? 0.4 : 1;
                context.beginPath();
                context.moveTo(qx - nx * len, qy - ny * len);
                context.lineTo(qx + nx * len, qy + ny * len);
                context.stroke();
                if (i % 5 === 0) context.fillText(String(i), qx + nx * 12 - 6, qy + ny * 12 + 4);
              }
              context.globalAlpha = 1;
              stroke(
                [g.runEnd, [g.runEnd[0] + g.flankDir[0] * atom, g.runEnd[1] + g.flankDir[1] * atom]],
                colour,
                2,
              );
              dot(g.runEnd, colour, 4.5);
              context.lineWidth = 2;
              for (const p of end === 'A' ? [seed[0], seed[1]] : [seed[n - 2], seed[n - 1]]) {
                context.beginPath();
                context.arc(toX(p[0]), toY(p[1]), 5, 0, Math.PI * 2);
                context.stroke();
              }
              if (short) {
                const w = at(anchor);
                context.globalAlpha = 0.4;
                context.setLineDash([2, 2]);
                context.beginPath();
                context.arc(toX(w[0]), toY(w[1]), 5, 0, Math.PI * 2);
                context.stroke();
                context.setLineDash([]);
                context.globalAlpha = 1;
              }
            }
            if (!layers.showAnchorLabels) continue;
            context.font = 'bold 12px monospace';
            context.fillStyle = colour;
            const lx = toX(clamp[0]) + 10;
            const ly = toY(clamp[1]) + (end === 'A' ? -12 : 20);
            const floor = g.atoms < anchor / atom - 1e-6 ? ` (floor: ${(anchor / atom).toFixed(0)} atoms)` : '';
            const size = short
              ? `anchor wanted ${(anchor / atom).toFixed(1)} · laid ${(laid / atom).toFixed(1)} atoms (run too short, extension refused)`
              : `anchor ${anchor.toFixed(0)} m = ${(anchor / atom).toFixed(1)} atoms${floor}`;
            context.fillText(`clamp ${end} ${g.convex ? 'convex' : 'concave'}: ${size}`, lx, ly);
            context.fillText(
              `φ ${((g.phi * 180) / Math.PI).toFixed(0)}° · φ/θ ${(g.atoms / (g.multiple || 1)).toFixed(1)} × c ${g.multiple}`,
              lx,
              ly + 14,
            );
          }
        }
        if (layers.showRod && t.seam && t.seam.length >= 2) {
          stroke(t.seam, COLOURS.rod, 2.5);
          for (const p of t.seam) dot(p, COLOURS.rod, 2);
          for (const p of t.contacts ?? []) {
            context.strokeStyle = COLOURS.contact;
            context.lineWidth = 1.5;
            context.beginPath();
            context.arc(toX(p[0]), toY(p[1]), 5, 0, Math.PI * 2);
            context.stroke();
          }
        }
      }
    }
    if (layers.showCut && model.cut) {
      if (shown('left')) stroke(model.cut.left, COLOURS.leftCut, 2);
      if (shown('right')) stroke(model.cut.right, COLOURS.rightCut, 2);
    }

    // FAILURE INDICATOR: a red banner per failed side, and a red ✖ on EVERY spot the gate tripped
    // on (recorded by `finish`); a failure thrown elsewhere marks the rod's worst turn instead.
    let bannerY = 22;
    for (const s of ['left', 'right'] as const) {
      const result = model.sides[s];
      if (!layers.showFailures || !shown(s)) continue;
      if (result.error) {
        context.fillStyle = 'rgba(200, 40, 40, 0.85)';
        context.fillRect(size - 14 - 220, bannerY - 16, 220, 22);
        context.fillStyle = '#ffffff';
        context.font = 'bold 13px monospace';
        context.fillText(`✖ ${s.toUpperCase()} FAILED`, size - 14 - 212, bannerY);
        bannerY += 26;
      }
      for (const t of result.transitions) {
        let spots = t.failures ?? [];
        if (result.error && spots.length === 0 && t.seam && t.seam.length >= 3) {
          const w = polylineWorstTurn(t.seam);
          spots = [{ point: t.seam[w.index], reason: `worst turn ${((w.turn * 180) / Math.PI).toFixed(0)}°` }];
        }
        for (const { point: p, reason } of spots) {
          const cx = toX(p[0]);
          const cy = toY(p[1]);
          context.strokeStyle = '#ff3b3b';
          context.lineWidth = 3;
          context.beginPath();
          context.moveTo(cx - 9, cy - 9);
          context.lineTo(cx + 9, cy + 9);
          context.moveTo(cx + 9, cy - 9);
          context.lineTo(cx - 9, cy + 9);
          context.stroke();
          context.beginPath();
          context.arc(cx, cy, 14, 0, Math.PI * 2);
          context.stroke();
          context.fillStyle = '#ff3b3b';
          context.font = 'bold 12px monospace';
          context.fillText(reason, cx + 18, cy + 4);
        }
      }
    }

    // Scale bar: a round distance ≈ a quarter of the view.
    const nice = (x: number) => {
      const p = Math.pow(10, Math.floor(Math.log10(x)));
      const f = x / p;
      return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
    };
    const barM = nice(span / 4);
    const barPx = barM * scale;
    const bx = 16;
    const by = size - 18;
    context.strokeStyle = '#e0e0e0';
    context.fillStyle = '#e0e0e0';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(bx, by);
    context.lineTo(bx + barPx, by);
    context.moveTo(bx, by - 4);
    context.lineTo(bx, by + 4);
    context.moveTo(bx + barPx, by - 4);
    context.lineTo(bx + barPx, by + 4);
    context.stroke();
    context.font = '12px monospace';
    context.fillText(
      barM >= 1000 ? `${barM / 1000} km` : `${barM} m`,
      bx,
      by - 7,
    );

    if (brush && !brush.pan) {
      context.strokeStyle = COLOURS.brush;
      context.setLineDash([4, 3]);
      context.lineWidth = 1;
      context.strokeRect(
        Math.min(brush.from[0], brush.to[0]),
        Math.min(brush.from[1], brush.to[1]),
        Math.abs(brush.to[0] - brush.from[0]),
        Math.abs(brush.to[1] - brush.from[1]),
      );
      context.setLineDash([]);
    }
  }, [model, size, view, brush, side, layers]);

  return (
    <div>
      <canvas
        ref={canvas}
        width={size}
        height={size}
        style={{
          display: 'block',
          border: '1px solid #333',
          borderRadius: 4,
          cursor: brush?.pan ? 'grabbing' : 'crosshair',
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onDoubleClick={() => setView(fitted())}
        onContextMenu={e => e.preventDefault()}
      />
      <div style={{ color: '#78909c', fontSize: 11, marginTop: 4 }}>
        drag = brush zoom · shift-drag or middle-drag = pan · wheel = zoom at
        cursor · double-click = fit
      </div>
    </div>
  );
}

/** One build of the report: a subject at a margin, bucketed by outcome. */
type ReportRow = {
  margin: number;
  label: string;
  ms: number;
  bucket: 'built' | 'rod' | 'runaway' | 'arms' | 'flags' | 'other' | 'outside';
  detail: string;
  /** the args that reproduce this build */
  pick: Partial<Props>;
};

const BUCKET_ORDER: ReportRow['bucket'][] = [
  'built',
  'rod',
  'runaway',
  'arms',
  'flags',
  'other',
  'outside',
];
const BUCKET_COLOURS: Record<ReportRow['bucket'], string> = {
  built: '#69f0ae',
  rod: '#ff5252',
  runaway: '#ff8a65',
  arms: '#ffd54f',
  flags: '#ffab40',
  other: '#b0bec5',
  outside: '#546e7a',
};

/** Bucket one model: the rod gates first, then the arms, then the cut's flags. */
function bucketOf(m: Model | null): Pick<ReportRow, 'bucket' | 'detail'> {
  if (!m) return { bucket: 'other', detail: 'no scene' };
  if (m.scene.outside) return { bucket: 'outside', detail: 'never enters the block' };
  if (m.scene.failed) return { bucket: 'other', detail: m.scene.failed.slice(0, 90) };
  const rodBits: string[] = [];
  for (const s of ['left', 'right'] as const) {
    const err = m.sides[s].error;
    if (!err) continue;
    const short = err.replace('oneSidedOffset: ', '').replace(/^the (left|right) stiff rod round a /, '');
    rodBits.push(`${s[0].toUpperCase()}: ${short.slice(0, 90)}`);
  }
  if (rodBits.some(b => /ran away/.test(b))) return { bucket: 'runaway', detail: rodBits.join(' · ') };
  if (rodBits.length > 0) {
    return { bucket: rodBits.some(b => /stiff rod/.test(b) || /obstacle ring fails/.test(b)) ? 'rod' : 'other', detail: rodBits.join(' · ') };
  }
  if (m.cutError) return { bucket: 'arms', detail: m.cutError.slice(0, 90) };
  if (m.cutFlags.length > 0) return { bucket: 'flags', detail: m.cutFlags.join(', ') };
  const turns = (['left', 'right'] as const).map(s => {
    const rods = m.sides[s].transitions.filter(t => t.seam && t.seam.length >= 3);
    const worst = rods.reduce((w, t) => Math.max(w, polylineWorstTurn(t.seam!).turn), 0);
    const contacts = rods.reduce((c, t) => c + (t.contacts?.length ?? 0), 0);
    return `${s[0].toUpperCase()} ${((worst * 180) / Math.PI).toFixed(0)}°/${contacts}c`;
  });
  return { bucket: 'built', detail: turns.join(' ') };
}

const linkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'inherit',
  font: 'inherit',
  fontWeight: 700,
  textDecoration: 'underline dotted',
  cursor: 'pointer',
};

/** The report panel: buckets per margin; click a name to load that build into the controls. */
function ReportView({
  rows,
  running,
  total,
  subject,
  onPick,
}: {
  rows: ReportRow[];
  running: boolean;
  total: number;
  /** set when the report builds ONE subject: its rows are listed by bucket, by margin */
  subject?: string;
  onPick?: (patch: Partial<Props>) => void;
}) {
  const margins = [...new Set(rows.map(r => r.margin))];
  const link = (r: ReportRow, text: string | number = r.label) => (
    <button type="button" style={linkStyle} onClick={() => onPick?.(r.pick)} title={JSON.stringify(r.pick)}>
      {text}
    </button>
  );
  const name = (r: ReportRow) => link(r);
  const ms = rows.reduce((s, r) => s + r.ms, 0);
  if (subject) {
    return (
      <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 8, maxHeight: '50vh', overflowY: 'auto', scrollbarWidth: 'thin' }}>
        <div style={{ fontWeight: 700 }}>
          {subject}: built {rows.filter(r => r.bucket === 'built').length}/{rows.length}
        </div>
        <div style={{ opacity: 0.6, marginBottom: 4 }}>
          {running ? `running… ${rows.length}/${total}` : `${(ms / 1000).toFixed(1)} s`}
        </div>
        {BUCKET_ORDER.map(b => {
          const in_ = rows.filter(r => r.bucket === b);
          if (in_.length === 0) return null;
          return (
            <div key={b} style={{ marginLeft: 8, marginBottom: 4 }}>
              <span style={{ color: BUCKET_COLOURS[b] }}>
                {b} ({in_.length})
              </span>
              {b === 'built' ? (
                <span>
                  :{' '}
                  {in_.map((r, i) => (
                    <span key={r.margin}>
                      {i > 0 && ', '}
                      {link(r, r.margin)}
                    </span>
                  ))}
                </span>
              ) : (
                in_.map(r => (
                  <div key={r.margin} style={{ marginLeft: 12 }}>
                    {link(r, `m${r.margin}`)} — {r.detail}
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 8, maxHeight: '50vh', overflowY: 'auto', scrollbarWidth: 'thin' }}>
      <div style={{ opacity: 0.6, marginBottom: 4 }}>
        {running ? `running… ${rows.length}/${total}` : `${rows.length} builds · ${ms.toFixed(0)} ms`}
      </div>
      {margins.map(margin => {
        const at = rows.filter(r => r.margin === margin);
        return (
          <div key={margin} style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>
              margin {margin}: built {at.filter(r => r.bucket === 'built').length}/{at.length}
            </div>
            {BUCKET_ORDER.map(b => {
              const in_ = at.filter(r => r.bucket === b);
              if (in_.length === 0) return null;
              return (
                <div key={b} style={{ marginLeft: 8, marginBottom: 4 }}>
                  <span style={{ color: BUCKET_COLOURS[b] }}>
                    {b} ({in_.length})
                  </span>
                  {b === 'built' ? (
                    <span>
                      :{' '}
                      {in_.map((r, i) => (
                        <span key={r.label}>
                          {i > 0 && ', '}
                          {name(r)}
                        </span>
                      ))}
                    </span>
                  ) : (
                    in_.map(r => (
                      <div key={r.label} style={{ marginLeft: 12 }}>
                        {name(r)} — {r.detail}
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Margins the sweep button runs, on top of the current settings. */
const SWEEP_MARGINS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 2, 4, 8, 10, 20];

/** Margins the one-subject sweep runs: 0.1 to 20 by 0.1, from integers so there is no float drift. */
const SUBJECT_SWEEP_MARGINS = Array.from({ length: 200 }, (_, k) => (k + 1) / 10);

const buttonStyle: React.CSSProperties = {
  background: '#263238',
  color: '#e0e0e0',
  border: '1px solid #455a64',
  borderRadius: 4,
  padding: '4px 10px',
  fontFamily: 'monospace',
  fontSize: 12,
  cursor: 'pointer',
};

const StiffRodDebug = (props: Props) => {
  const data = useVolve();
  const crs = useMemo(
    () =>
      new CRS(
        getProjectionDefFromUtmZone(storyArgs.utmZone),
        storyArgs.origin as Vec2,
        'utm',
      ),
    [],
  );
  const trajectories = useMemo(() => {
    if (!data) return null;
    const out = new Map<string, Vec3[]>();
    for (const id of Object.keys(data.headers)) {
      const header = data.headers[id];
      const log = data.logs[id];
      if (!header || !log || log.length < 8) continue;
      const points: Vec3[] = [];
      for (let j = 0; j + 3 < log.length; j += 4) {
        const p = crs.utmToWorld(
          header.easting + log[j],
          header.northing + log[j + 2],
          -log[j + 1],
        );
        points.push([p.x, p.y, p.z]);
      }
      out.set(id, points);
    }
    return out;
  }, [data, crs]);
  const hostPlans = useMemo(
    () =>
      trajectories
        ? [...trajectories]
          .filter(([id]) => !isExtraWellbore(id))
          .map(([, t]) => t.map(p => [p[0], p[2]] as Vec2))
        : [],
    [trajectories],
  );
  const rings = useMemo(
    () =>
      hostPlans.length > 0
        ? debugOutlineRings(createWellboreOutline(hostPlans, OUTLINE))
        : [],
    [hostPlans],
  );
  // an extra is cut out of the field outline grown by itself; the field's own wells keep theirs
  const ringsFor = useMemo(() => {
    const cache = new Map<string, Vec2[][]>();
    return (id: string): Vec2[][] => {
      const trajectory = trajectories?.get(id);
      if (!isExtraWellbore(id) || !trajectory) return rings;
      let hit = cache.get(id);
      if (!hit) {
        const plan = trajectory.map(p => [p[0], p[2]] as Vec2);
        hit = debugOutlineRings(createWellboreOutline([...hostPlans, plan], OUTLINE));
        cache.set(id, hit);
      }
      return hit;
    };
  }, [trajectories, hostPlans, rings]);
  const selected = useMemo(() => {
    if (!data || !trajectories) return null;
    const full = FULL_NAME.get(props.wellbore) ?? props.wellbore;
    const id = Object.keys(data.headers).find(
      k => data.headers[k].name === full,
    );
    const trajectory = id ? trajectories.get(id) : undefined;
    return id && trajectory ? { id, trajectory } : null;
  }, [data, trajectories, props.wellbore]);

  // The block: a crop square replaces the field outline, and a TVD window bounds it vertically.
  const footprintFor = useMemo(() => {
    if (!(props.crop > 0)) return ringsFor;
    const h = (props.crop * 1000) / 2;
    const square: Vec2[][] = [
      [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ],
    ];
    return () => square;
  }, [props.crop, ringsFor]);
  const verticalRange = useMemo<[number, number] | undefined>(
    () =>
      props.tvdFrom > 0 || props.tvdTo > 0
        ? [
          props.tvdTo > 0 ? -props.tvdTo : -Infinity,
          props.tvdFrom > 0 ? -props.tvdFrom : Infinity,
        ]
        : undefined,
    [props.tvdFrom, props.tvdTo],
  );
  const head = useMemo(
    () => ({ headBearing: props.headBearing, headMinTdAngle: props.headMinTdAngle }),
    [props.headBearing, props.headMinTdAngle],
  );

  const scene = useMemo<Scene | null>(() => {
    if (props.scene !== 'wellbore') {
      return syntheticScene(
        props.wellTurn,
        props.hull,
        props.diameter,
        props.width,
        props.hullAngle,
        props.hullPivot,
      );
    }
    return selected
      ? wellboreScene(
        selected.trajectory,
        footprintFor(selected.id),
        props.margin,
        verticalRange,
        head,
      )
      : null;
  }, [
    props.scene,
    props.wellTurn,
    props.hull,
    props.diameter,
    props.width,
    props.hullAngle,
    props.hullPivot,
    selected,
    footprintFor,
    verticalRange,
    head,
    props.margin,
  ]);

  const model = useMemo(
    () => buildModel(scene, props.margin, props.rodStiffness, props.anchorScale, props.anchorBalanced),
    [scene, props.margin, props.rodStiffness, props.anchorScale, props.anchorBalanced],
  );

  // ⭐ THE REPORT — on demand, never as a control: every subject of the current scene kind (all
  // wells, or the synthetic obstacle at every angle) built with the current settings through the
  // SAME `buildModel` as the view, one build per tick so the page keeps painting.
  const [report, setReport] = useState<{
    rows: ReportRow[];
    running: boolean;
    total: number;
    subject?: string;
  } | null>(null);
  const runReport = (margins: number[], only?: string) => {
    type Subject = {
      label: string;
      scene: (margin: number) => Scene | null;
      pick: (margin: number) => Partial<Props>;
    };
    const subjects: Subject[] = [];
    if (props.scene === 'wellbore') {
      if (!data || !trajectories) return;
      for (const [id, traj] of trajectories) {
        if (only && id !== selected?.id) continue;
        const name = shortName(data.headers[id]?.name ?? id);
        subjects.push({
          label: name,
          scene: m => wellboreScene(traj, footprintFor(id), m, verticalRange, head),
          pick: margin => ({ scene: 'wellbore', wellbore: name, margin }),
        });
      }
    } else {
      for (let angle = -90; angle <= 90; angle += 5) {
        if (only && angle !== props.hullAngle) continue;
        subjects.push({
          label: `${angle}°`,
          scene: () => syntheticScene(props.wellTurn, props.hull, props.diameter, props.width, angle, props.hullPivot),
          pick: margin => ({ hullAngle: angle, margin }),
        });
      }
    }
    if (subjects.length === 0) return;
    const jobs = margins.flatMap(m => subjects.map(s => ({ margin: m, subject: s })));
    const rows: ReportRow[] = [];
    setReport({ rows: [], running: true, total: jobs.length, subject: only });
    let k = 0;
    const step = () => {
      if (k >= jobs.length) {
        setReport({ rows: [...rows], running: false, total: jobs.length, subject: only });
        return;
      }
      const { margin, subject } = jobs[k++];
      const m = buildModel(subject.scene(margin), margin, props.rodStiffness, props.anchorScale, props.anchorBalanced);
      rows.push({ margin, label: subject.label, ms: m?.ms ?? 0, pick: subject.pick(margin), ...bucketOf(m) });
      setReport({ rows: [...rows], running: true, total: jobs.length, subject: only });
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  };

  const layers = useMemo(
    () => ({
      showWell: props.showWell,
      showHull: props.showHull,
      showZone: props.showZone,
      showCores: props.showCores,
      showCut: props.showCut,
      showPath: props.showPath,
      showSeed: props.showSeed,
      showAnchors: props.showAnchors,
      showAnchorLabels: props.showAnchorLabels,
      showRod: props.showRod,
      showFailures: props.showFailures,
    }),
    [
      props.showWell,
      props.showHull,
      props.showZone,
      props.showCores,
      props.showCut,
      props.showPath,
      props.showSeed,
      props.showAnchors,
      props.showAnchorLabels,
      props.showRod,
      props.showFailures,
    ],
  );

  const subject =
    props.scene === 'wellbore'
      ? (FULL_NAME.get(props.wellbore) ?? props.wellbore)
      : `well ${props.wellTurn}° · ${props.hull} ${props.diameter}×${props.width} m`;
  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        fontFamily: 'monospace',
        color: '#e0e0e0',
        background: '#12151a',
        padding: 12,
        borderRadius: 6,
        alignItems: 'flex-start',
      }}
    >
      <RodPlanView
        model={model}
        size={props.size}
        fitKey={`${props.scene}|${props.wellbore}|${props.hull}|${props.hullPivot}|${props.wellTurn}|${props.crop}|${props.tvdFrom}|${props.tvdTo}`}
        side={props.side}
        layers={layers}
      />
      <div style={{ fontSize: 12, maxWidth: 400 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>
          {subject} · margin {props.margin} m · stiffness ×{props.rodStiffness} · anchor ×{props.anchorScale}
          {props.anchorBalanced ? ' · balanced' : ''}
        </div>
        <div style={{ opacity: 0.6, marginBottom: 6 }}>
          {model ? `${model.ms.toFixed(1)} ms` : 'loading…'}
        </div>
        {model?.notes.map((n, i) => (
          <div key={i} style={{ marginBottom: 3, whiteSpace: 'pre-wrap' }}>
            {n}
          </div>
        ))}
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <button
            type="button"
            disabled={report?.running}
            onClick={() => runReport([props.margin])}
            style={buttonStyle}
            title={`every ${props.scene === 'wellbore' ? 'well' : 'angle'} at margin ${props.margin}, stiffness ×${props.rodStiffness}`}
          >
            report @ margin {props.margin}
          </button>
          <button
            type="button"
            disabled={report?.running}
            onClick={() => runReport(SWEEP_MARGINS)}
            style={buttonStyle}
            title={`every ${props.scene === 'wellbore' ? 'well' : 'angle'} at margins ${SWEEP_MARGINS.join(', ')}`}
          >
            sweep margins
          </button>
          <button
            type="button"
            disabled={report?.running}
            onClick={() =>
              runReport(
                SUBJECT_SWEEP_MARGINS,
                props.scene === 'wellbore' ? subject : `${subject} · angle ${props.hullAngle}°`,
              )
            }
            style={buttonStyle}
            title={`${subject} only, at margins 0.1–20 by 0.1`}
          >
            sweep {props.scene === 'wellbore' ? props.wellbore : `${props.hullAngle}°`}
          </button>
        </div>
        {report && (
          <ReportView
            rows={report.rows}
            running={report.running}
            total={report.total}
            subject={report.subject}
            onPick={props.onPick}
          />
        )}
        <div style={{ marginTop: 10, opacity: 0.5 }}>
          white = well (dashed grey = the planned head's virtual guide) · yellow
          hull = obstacle · dashed purple = the ZONE, the points within the margin of the
          hull (drawn rounded, within 2% of the margin outside it): the ring path follows the
          line, the runs stop at the zone and the rod keeps out of it by distance ·
          thick purple = the ring PATH (the flank the rod must pass on) · dashed
          light blue = the anchored seed, white dots = the clamped vertices ·
          red = the rod that ships, the least-bending shape that holds the margin — white rings
          = contacts, where it presses on the margin of a hull or of the well · thin cyan/yellow
          = the left/right cores, thick = the finished cut with arms
        </div>
      </div>
    </div>
  );
};

const meta: Meta<Props> = {
  title: 'debug/Chunks/Stiff Rod (prototype)',
  component: StiffRodDebug,
  // `useArgs` is a preview hook — only valid in a decorator, not inside the React component.
  decorators: [
    (Story, context) => {
      const [, updateArgs] = useArgs();
      return <Story args={{ ...context.args, onPick: updateArgs }} />;
    },
  ],
  argTypes: {
    scene: {
      control: 'inline-radio',
      options: ['synthetic', 'wellbore'],
      table: { category: 'scene' },
      description:
        'a synthetic well turning at a declared obstacle, or a real well with its head planned',
    },
    wellbore: {
      control: { type: 'select', labels: Object.fromEntries(FULL_NAME) },
      options: WELLBORES,
      table: { category: 'scene' },
      description: 'the arg value is the short name — Storybook drops URL args containing `/`',
      if: { arg: 'scene', eq: 'wellbore' },
    },
    onPick: { table: { disable: true } },
    wellTurn: {
      control: { type: 'range', min: 0, max: 135, step: 15 },
      table: { category: 'scene' },
      description: 'the synthetic well’s turn at the obstacle, degrees: 0 straight through, 90 a right angle',
      if: { arg: 'scene', neq: 'wellbore' },
    },
    diameter: {
      control: { type: 'range', min: 5, max: 500, step: 5 },
      table: { category: 'scene' },
      description: 'the synthetic obstacle’s length along its own axis, metres',
      if: { arg: 'scene', neq: 'wellbore' },
    },
    width: {
      control: { type: 'range', min: 5, max: 300, step: 5 },
      table: { category: 'scene' },
      description: 'the synthetic obstacle’s width across its axis, metres — stretches the shape, not just its scale',
      if: { arg: 'scene', neq: 'wellbore' },
    },
    hull: {
      control: 'inline-radio',
      options: ['disc', 'blob', 'sliver', 'wedge'],
      table: { category: 'scene' },
      description:
        'the synthetic obstacle’s shape — a round disc, a lopsided head-like blob, a pointed sliver, a hook-like wedge',
      if: { arg: 'scene', neq: 'wellbore' },
    },
    hullAngle: {
      control: { type: 'range', min: -90, max: 90, step: 5 },
      table: { category: 'scene' },
      description: 'turn the synthetic obstacle against the well, in degrees',
      if: { arg: 'scene', neq: 'wellbore' },
    },
    hullPivot: {
      control: 'inline-radio',
      options: ['centre', 'start', 'end'],
      table: { category: 'scene' },
      description:
        'the point of the synthetic obstacle that sits at the well’s turn and that it turns about: its centre, or the start / end of its axis (the wedge’s apex / base)',
      if: { arg: 'scene', neq: 'wellbore' },
    },
    margin: {
      control: { type: 'range', min: 0.1, max: 20, step: 0.1 },
      table: { category: 'rod' },
      description: 'cut clearance (m)',
    },
    tvdFrom: {
      control: { type: 'number', min: 0, step: 10 },
      table: { category: 'block' },
      description:
        'leave out the trajectory ABOVE this TVD, metres below MSL (0 = no limit) — the top of the units a fence may cut, as `ChunkStack` derives it',
      if: { arg: 'scene', eq: 'wellbore' },
    },
    tvdTo: {
      control: { type: 'number', min: 0, step: 10 },
      table: { category: 'block' },
      description:
        'leave out the trajectory BELOW this TVD, metres below MSL (0 = no limit)',
      if: { arg: 'scene', eq: 'wellbore' },
    },
    crop: {
      control: { type: 'number', min: 0, step: 0.5 },
      table: { category: 'block' },
      description:
        'footprint: 0 = the field outline, else a square this many km across centred on the scene origin — ends outside it get no run-out',
      if: { arg: 'scene', eq: 'wellbore' },
    },
    headBearing: {
      control: 'inline-radio',
      options: ['opposite-td', 'free'],
      table: { category: 'block' },
      description:
        'the head arm: exactly opposite the TD arm, or free — through the head, from where the well enters the head frame through its hull’s centroid, turned only as far as it takes to stay `headMinTdAngle` off the TD arm',
      if: { arg: 'scene', eq: 'wellbore' },
    },
    headMinTdAngle: {
      control: { type: 'range', min: 45, max: 180, step: 5 },
      table: { category: 'block' },
      description: 'the least angle between a free head arm and the TD arm, degrees',
      if: { arg: 'headBearing', eq: 'free' },
    },
    side: {
      control: 'inline-radio',
      options: ['both', 'left', 'right'],
      table: { category: 'rod' },
    },
    rodStiffness: {
      control: { type: 'range', min: 0, max: 5, step: 0.1 },
      table: { category: 'rod' },
      description:
        'the rod’s bending length as a multiple of the ring’s diameter: 0 = taut string (straight chords between contacts), larger = leaves the runs earlier and rounds every corner over a longer stretch',
    },
    anchorScale: {
      control: { type: 'range', min: 0.25, max: 3, step: 0.25 },
      table: { category: 'rod' },
      description:
        'a global multiple on the rod’s anchor lengths. Each clamp sits max(3, c·φ/θ, 2·(Ψ − 90°)/θ) atoms back along its run, φ the turn from the run onto the ring path, c the measured optimum by convexity (4 for a rod wrapping the outside of the well’s turn, 2 on the inside) and Ψ the well’s turn between the two runs; this scales both multiples',
    },
    anchorBalanced: {
      control: 'boolean',
      table: { category: 'rod' },
      description:
        'CANDIDATE, for a rod with both clamps on the inside of the turn: both clamps at the same height along the bisector of the two runs, max(3, 2·mean φ/θ) atoms beyond the farther run end — instead of each clamp from its own run end and its own φ',
    },
    showWell: { control: 'boolean', table: { category: 'view' } },
    showHull: { control: 'boolean', table: { category: 'view' } },
    showZone: {
      control: 'boolean',
      table: { category: 'view' },
      description:
        'the zone: the points within the margin of the hull, drawn as hull + margin rounded to within 2% of the margin outside it. The ring path follows the drawn line; the runs stop, and the rod and every gate keep the margin, by distance to the hull',
    },
    showCores: { control: 'boolean', table: { category: 'view' } },
    showCut: {
      control: 'boolean',
      table: { category: 'view' },
      description: 'the finished cut with run-out arms (wellbore scene only)',
    },
    showPath: {
      control: 'boolean',
      table: { category: 'view' },
      description: 'the ring path the rod is seeded from',
    },
    showSeed: {
      control: 'boolean',
      table: { category: 'view' },
      description: 'the anchored span and its clamps',
    },
    showAnchors: {
      control: 'boolean',
      table: { category: 'view' },
      description:
        'per clamp, in its run’s colour (green = run A, pink = run B): the anchor’s reference point (the run’s clipped end on the ring, solid dot), the heading φ is read against (a solid atom-long stroke from it: the path’s first atom, or the ring’s where the path is shorter), the anchor measured ALONG THE SEED from it (dotted, a tick per atom, a number per 5) and the two clamp vertices (rings). Where the run was shorter than the anchor and the straight extension past its end was refused, the rest of the wanted anchor is drawn faded, ending in a dashed ring where the rule wanted the clamp',
    },
    showAnchorLabels: {
      control: 'boolean',
      table: { category: 'view' },
      description: 'per clamp: convexity, the anchor in metres and atoms, φ, φ/θ and the multiple',
    },
    showRod: {
      control: 'boolean',
      table: { category: 'view' },
      description: 'the rod that ships',
    },
    showFailures: {
      control: 'boolean',
      table: { category: 'view' },
      description:
        'red banner per failed side and a red ✖ on every spot the gate tripped on (ring entry, margin dip, well crossing, over-turned vertex, runaway)',
    },
    size: {
      control: { type: 'range', min: 320, max: 1500, step: 20 },
      table: { category: 'view' },
    },
  },
  args: {
    scene: 'synthetic',
    wellbore: 'F-12',
    margin: 2,
    tvdFrom: 0,
    tvdTo: 0,
    crop: 0,
    headBearing: 'opposite-td',
    headMinTdAngle: 90,
    wellTurn: 90,
    diameter: 100,
    width: 60,
    hull: 'blob',
    hullAngle: 0,
    hullPivot: 'centre',
    side: 'both',
    rodStiffness: 1,
    anchorScale: 1,
    anchorBalanced: false,
    showWell: true,
    showHull: true,
    showZone: true,
    showCores: true,
    showCut: false,
    showPath: true,
    showSeed: true,
    showAnchors: true,
    showAnchorLabels: false,
    showRod: true,
    showFailures: true,
    size: 900,
  },
};
export default meta;

export const Default: StoryObj<Props> = {};
