import { Meta, StoryObj } from '@storybook/react-vite';
import {
  useArgs,
  useEffect as useStoryEffect,
  useRef as useStoryRef,
} from 'storybook/preview-api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Vec2, Vec3 } from '../../../sdk';
import { getSplineCurve } from '../../../sdk/geometries/curve/curve-3d';
import {
  fenceFoldSpans,
  fenceObstacles,
  prepareFenceTrace,
  sampleTrajectoryPlan,
} from '../../../sdk/geometries/wellbore-fence';
import {
  TraceProblemSpan,
  traceProblemSpans,
} from '../../../sdk/utils/one-sided-offset';
import { CRS, getProjectionDefFromUtmZone } from '../../../sdk/projection/crs';
import storyArgs from '../../../storybook/story-args.json';
import {
  EXTRA_WELLBORE_IDS,
  withExtraWellbores,
} from '../../../storybook/data/extra-wellbores';
import {
  syntheticTrajectory,
  TRAJECTORY_DEFECTS,
  TRAJECTORY_PRESET_NAMES,
  TRAJECTORY_PRESETS,
  TrajectoryDefect,
} from '../../../storybook/data/synthetic-trajectories';

/**
 * Trace-defect diagnostics — the fence's fold/loop detectors on SYNTHETIC trajectories.
 *
 * ⭐⭐ The point of this story is ground truth. Every detector in the fence was calibrated on
 * Volve, which a survey of four datasets says is the least representative field we hold: its
 * plan-extent ÷ TVD is 0.46 against Troll's 2.08 (2.90 and 5.34 at the extremes), and it contains
 * no plan turn above 120° at all — so the 150° reversal rule effectively never fires there, and
 * the deviated-section plan loops that appear in Troll have no public example. Here the shape is
 * built to order, so what a detector SHOULD say is known before it is asked.
 *
 * ⭐ `mouth` and `at` are the controls that matter. `mouth` is the defect's opening as a fraction
 * of its depth, so sweeping it at a fixed size walks a fold from a gentle excursion to a near
 * loop and shows where a decision boundary really sits; `at` slides the same defect from the head
 * to TD, which is what a head-versus-deviated rule has to get right.
 *
 * Navigation: **drag to brush-zoom**, wheel to zoom at the cursor, middle-drag or shift-drag to
 * pan, double-click to fit.
 */

type Props = {
  source: 'synthetic' | 'volve';
  wellbore: string;
  preset: string;
  defect: TrajectoryDefect;
  featureSize: number;
  mouth: number;
  at: number;
  reach: number;
  kickoffDepth: number;
  totalDepth: number;
  noise: number;
  seed: number;
  spacing: number;
  smoothing: number;
  verticalDrift: number;
  heading: number;
  side: 1 | -1;
  margin: number;
  minRatio: number;
  minSharpness: number;
  showTrace: boolean;
  showStations: boolean;
  showMargin: boolean;
  showProblems: boolean;
  showObstacles: boolean;
  showFoldSpans: boolean;
  showElevation: boolean;
  size: number;
};

const COLOURS = {
  background: '#0b0d10',
  grid: '#161a20',
  trace: '#eceff1',
  station: '#78909c',
  head: '#00e676',
  td: '#e040fb',
  obstacle: '#ffd54f',
  foldSpan: '#ff6e40',
  brush: '#00e5ff',
  axis: '#37474f',
  margin: '#1c313a',
  problemLeft: '#00e5ff',
  problemRight: '#ffea00',
  unthreadable: '#ff1744',
};

type View = { cx: number; cy: number; scale: number };

type Header = { id: string; name: string; easting: number; northing: number };

const WELLBORES = [
  ...Object.values(storyArgs.wellboreOptions as Record<string, string>).sort(
    (a, b) => a.localeCompare(b),
  ),
  ...EXTRA_WELLBORE_IDS,
];

/** The demo field's wellbores, in the same scene frame the app puts them in. */
function useVolve() {
  const [data, setData] = useState<Map<string, Vec3[]> | null>(null);
  useEffect(() => {
    const crs = new CRS(
      getProjectionDefFromUtmZone(storyArgs.utmZone),
      storyArgs.origin as Vec2,
      'utm',
    );
    Promise.all([
      fetch('data/wellbore-headers.json').then(r => r.json()),
      fetch('data/position-logs.json').then(r => r.json()),
    ])
      .then(
        ([host, hostLogs]: [
          Record<string, Header>,
          Record<string, number[]>,
        ]) => {
          const { headers, logs } = withExtraWellbores(host, hostLogs);
          const out = new Map<string, Vec3[]>();
          for (const id of Object.keys(headers)) {
            const header = headers[id];
            const log = logs[id];
            if (!header || !log || log.length < 8) continue;
            const points: Vec3[] = [];
            for (let j = 0; j + 3 < log.length; j += 4) {
              // Scene coordinates, so the plan is a local displacement and never a UTM easting.
              const p = crs.utmToWorld(
                header.easting + log[j],
                header.northing + log[j + 2],
                -log[j + 1],
              );
              points.push([p.x, p.y, p.z]);
            }
            out.set(header.name, points);
          }
          setData(out);
        },
      )
      .catch(() => setData(null));
  }, []);
  return data;
}

/** The model the canvas draws: the trace plus what each detector made of it. */
function buildModel(p: Props, volve: Map<string, Vec3[]> | null) {
  const trajectory =
    p.source === 'volve'
      ? (volve?.get(p.wellbore) ?? null)
      : syntheticTrajectory({
          defect: p.defect,
          featureSize: p.featureSize,
          mouth: p.mouth,
          at: p.at,
          reach: p.reach,
          kickoffDepth: p.kickoffDepth,
          totalDepth: p.totalDepth,
          noise: p.noise,
          seed: p.seed,
          spacing: p.spacing,
          smoothing: p.smoothing,
          verticalDrift: p.verticalDrift,
          heading: p.heading,
          side: p.side,
        });
  if (!trajectory || trajectory.length < 3) return null;
  const notes: string[] = [];
  const curve = getSplineCurve(trajectory);
  if (!curve) return null;
  const samples = sampleTrajectoryPlan(curve, undefined);
  if (!samples) return null;
  const base = prepareFenceTrace(curve, samples, {});
  const trace = base.points;

  let obstacles: Vec2[][] = [];
  let spans: Array<[number, number]> = [];
  try {
    obstacles = fenceObstacles(trace, { source: 'fold-spans' });
    spans = fenceFoldSpans(trace);
  } catch (e) {
    notes.push(`obstacles: ${e instanceof Error ? e.message : String(e)}`);
  }
  let problems: TraceProblemSpan[] = [];
  let detectMs = 0;
  try {
    const t0 = performance.now();
    problems = traceProblemSpans(trace, {
      minRatio: p.minRatio,
      minSharpness: p.minSharpness,
      margin: p.margin,
    });
    detectMs = performance.now() - t0;
  } catch (e) {
    notes.push(`problems: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Depth against plan arc — a plan-only view is what hid the whole problem, so the elevation is
  // drawn from the same samples rather than inferred.
  const profile: Vec2[] = [];
  let planArc = 0;
  for (let i = 0; i < samples.plan.length; i++) {
    if (i > 0) {
      planArc += Math.hypot(
        samples.plan[i][0] - samples.plan[i - 1][0],
        samples.plan[i][1] - samples.plan[i - 1][1],
      );
    }
    profile.push([planArc, -samples.y[i]]);
  }

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const q of trace) {
    if (q[0] < minX) minX = q[0];
    if (q[0] > maxX) maxX = q[0];
    if (q[1] < minZ) minZ = q[1];
    if (q[1] > maxZ) maxZ = q[1];
  }

  const planExtent = Math.hypot(maxX - minX, maxZ - minZ);
  // Measured off the trajectory, not the requested depth — a Volve well was never asked for one.
  let tvd = 0;
  for (const s of trajectory) tvd = Math.max(tvd, -s[1]);
  notes.push(
    `trace ${trace.length} pt · plan extent ${planExtent.toFixed(0)} m · TVD ${tvd.toFixed(0)} m · extent/TVD ${(planExtent / Math.max(1, tvd)).toFixed(2)}`,
  );
  notes.push(
    `kickoff ${base.kickoff.found ? `${base.kickoff.y.toFixed(0)} m at MD ${base.kickoff.md.toFixed(0)}` : 'not found (deviates from the wellhead)'}`,
  );
  notes.push(
    problems.length === 0
      ? `traceProblemSpans: clean at pocket ratio ${p.minRatio} / kink sharpness ${p.minSharpness} · ${detectMs.toFixed(1)} ms`
      : `traceProblemSpans @ pocket ratio ${p.minRatio} · kink sharpness ${p.minSharpness}: ${problems.filter(s => s.reason === 'pocket').length} pocket(s), ${problems.filter(s => s.reason === 'kink').length} kink(s) · ${detectMs.toFixed(1)} ms`,
  );
  notes.push(
    `fenceObstacles: ${obstacles.length} hull(s) · fenceFoldSpans: ${spans.length} span(s)${spans.length ? ` ${spans.map(s => `[${s[0]}..${s[1]}]`).join(' ')}` : ''}`,
  );
  return {
    trajectory,
    trace,
    obstacles,
    spans,
    problems,
    profile,
    bounds: [minX, minZ, maxX, maxZ] as [number, number, number, number],
    notes,
  };
}

const TraceDefects = (props: Props) => {
  const volve = useVolve();
  const model = useMemo(() => buildModel(props, volve), [props, volve]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [brush, setBrush] = useState<{
    from: Vec2;
    to: Vec2;
    pan: boolean;
  } | null>(null);

  const width = props.size;
  const height = props.size;
  const elevationHeight = props.showElevation ? 150 : 0;

  /** The view that frames the whole trace, with a margin. */
  const fitted = useCallback((): View | null => {
    if (!model) return null;
    const [minX, minZ, maxX, maxZ] = model.bounds;
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxZ - minZ);
    return {
      cx: (minX + maxX) / 2,
      cy: (minZ + maxZ) / 2,
      scale: Math.min(width / (w * 1.15), height / (h * 1.15)),
    };
  }, [model, width, height]);

  // Re-fit whenever the shape changes, but never while the user is looking somewhere: a control
  // that silently moves the camera makes a sweep impossible to read.
  const shapeKey = `${props.source}|${props.wellbore}|${props.defect}|${props.featureSize}|${props.mouth}|${props.at}|${props.reach}|${props.heading}|${props.side}|${props.seed}|${!!model}`;
  useEffect(() => {
    setView(fitted());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey]);

  const toScreen = useCallback(
    (p: Vec2, v: View): Vec2 => [
      (p[0] - v.cx) * v.scale + width / 2,
      (p[1] - v.cy) * v.scale + height / 2,
    ],
    [width, height],
  );
  const toWorld = useCallback(
    (sx: number, sy: number, v: View): Vec2 => [
      (sx - width / 2) / v.scale + v.cx,
      (sy - height / 2) / v.scale + v.cy,
    ],
    [width, height],
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
    // Hold the world point under the cursor still, which is what makes wheel zoom feel anchored.
    setView({
      cx: view.cx + before[0] - after[0],
      cy: view.cy + before[1] - after[1],
      scale,
    });
  };
  // ⚠️ React registers `wheel` at the ROOT as passive, so `preventDefault` inside an `onWheel` prop
  // warns and does nothing — the page scrolls while the canvas zooms. A native listener can opt out.
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  useEffect(() => {
    const el = canvasRef.current;
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
      setBrush({ ...brush, to: at });
      return;
    }
    setBrush({ ...brush, to: at });
  };

  const onMouseUp = () => {
    if (!brush || !view) return;
    const [x0, y0] = brush.from;
    const [x1, y1] = brush.to;
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    // A click, not a drag — leave the view alone rather than zooming to a sliver.
    if (!brush.pan && w > 12 && h > 12) {
      const a = toWorld(Math.min(x0, x1), Math.min(y0, y1), view);
      const b = toWorld(Math.max(x0, x1), Math.max(y0, y1), view);
      setView({
        cx: (a[0] + b[0]) / 2,
        cy: (a[1] + b[1]) / 2,
        scale: Math.min(width / (b[0] - a[0]), height / (b[1] - a[1])),
      });
    }
    setBrush(null);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !model || !view) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = (height + elevationHeight) * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLOURS.background;
    ctx.fillRect(0, 0, width, height + elevationHeight);

    const S = (p: Vec2) => toScreen(p, view);
    const stroke = (
      points: Vec2[],
      colour: string,
      lineWidth = 1,
      close = false,
    ) => {
      if (points.length < 2) return;
      ctx.strokeStyle = colour;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      const first = S(points[0]);
      ctx.moveTo(first[0], first[1]);
      for (let i = 1; i < points.length; i++) {
        const q = S(points[i]);
        ctx.lineTo(q[0], q[1]);
      }
      if (close) ctx.closePath();
      ctx.stroke();
    };
    const dot = (p: Vec2, colour: string, r = 3) => {
      const q = S(p);
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(q[0], q[1], r, 0, Math.PI * 2);
      ctx.fill();
    };

    // A grid at a round metric step, so the zoom level is always legible.
    const target = 90 / view.scale;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const step = [1, 2, 5, 10].map(m => m * pow).find(v => v >= target) ?? pow;
    const tl = toWorld(0, 0, view);
    const br = toWorld(width, height, view);
    ctx.strokeStyle = COLOURS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(tl[0] / step) * step; x < br[0]; x += step) {
      const q = S([x, tl[1]]);
      ctx.moveTo(q[0], 0);
      ctx.lineTo(q[0], height);
    }
    for (let z = Math.ceil(tl[1] / step) * step; z < br[1]; z += step) {
      const q = S([tl[0], z]);
      ctx.moveTo(0, q[1]);
      ctx.lineTo(width, q[1]);
    }
    ctx.stroke();

    if (props.showMargin) {
      // The corridor a cut needs, drawn as the trace's own width. Where the band closes on itself
      // there is no room to pass, which is the one thing `margin` decides here — the detector's
      // own test is a ratio and has no length in it at all.
      ctx.strokeStyle = COLOURS.margin;
      ctx.lineWidth = Math.max(1, props.margin * 2 * view.scale);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      const first = S(model.trace[0]);
      ctx.moveTo(first[0], first[1]);
      for (let i = 1; i < model.trace.length; i++) {
        const q = S(model.trace[i]);
        ctx.lineTo(q[0], q[1]);
      }
      ctx.stroke();
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'butt';
    }
    if (props.showObstacles) {
      for (const hull of model.obstacles)
        stroke(hull, COLOURS.obstacle, 2, true);
    }
    if (props.showFoldSpans) {
      for (const [a, b] of model.spans) {
        stroke(model.trace.slice(a, b + 1), COLOURS.foldSpan, 4);
      }
    }
    if (props.showProblems) {
      for (const s of model.problems) {
        const colour =
          s.reason === 'pocket' && !s.threadable
            ? COLOURS.unthreadable
            : s.side === 'left'
              ? COLOURS.problemLeft
              : COLOURS.problemRight;
        if (s.reason === 'kink') ctx.setLineDash([4, 4]);
        stroke(s.hull, colour, 2, true);
        ctx.setLineDash([]);
        stroke(model.trace.slice(s.span[0], s.span[1] + 1), colour, 3);
        ctx.fillStyle = colour;
        ctx.font = '11px monospace';
        if (s.reason === 'pocket') {
          // The MOUTH: the gap the trace doubles back through, which IS the measurement the
          // verdict is made of — drawn so a disagreement can be read off rather than argued about.
          stroke(s.bar, colour, 2);
          dot(s.bar[0], colour, 3);
          dot(s.bar[1], colour, 3);
          const mid = S([
            (s.bar[0][0] + s.bar[1][0]) / 2,
            (s.bar[0][1] + s.bar[1][1]) / 2,
          ]);
          ctx.fillText(`${s.ratio.toFixed(1)}x`, mid[0] + 6, mid[1] - 4);
        } else {
          // The turn the trace actually makes, drawn at its measured radius against the one the
          // cut needs — the two circles are the whole argument.
          const c = S(s.at);
          ctx.strokeStyle = colour;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(
            c[0],
            c[1],
            Math.max(2, s.radius * view.scale),
            0,
            Math.PI * 2,
          );
          ctx.stroke();
          dot(s.at, colour, 3);
          ctx.fillText(`r ${s.radius.toFixed(0)}m`, c[0] + 6, c[1] - 4);
        }
      }
    }
    if (props.showTrace) stroke(model.trace, COLOURS.trace, 1.5);
    if (props.showStations) {
      for (const s of model.trajectory) dot([s[0], s[2]], COLOURS.station, 1.2);
    }
    dot(model.trace[0], COLOURS.head, 5);
    dot(model.trace[model.trace.length - 1], COLOURS.td, 5);

    if (brush && !brush.pan) {
      ctx.strokeStyle = COLOURS.brush;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.min(brush.from[0], brush.to[0]),
        Math.min(brush.from[1], brush.to[1]),
        Math.abs(brush.to[0] - brush.from[0]),
        Math.abs(brush.to[1] - brush.from[1]),
      );
      ctx.setLineDash([]);
    }

    // Scale bar — a brush zoom is meaningless without one.
    const barMetres = step;
    const barPx = barMetres * view.scale;
    ctx.strokeStyle = COLOURS.trace;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(12, height - 16);
    ctx.lineTo(12 + barPx, height - 16);
    ctx.moveTo(12, height - 21);
    ctx.lineTo(12, height - 11);
    ctx.moveTo(12 + barPx, height - 21);
    ctx.lineTo(12 + barPx, height - 11);
    ctx.stroke();
    ctx.fillStyle = COLOURS.trace;
    ctx.font = '11px monospace';
    ctx.fillText(`${barMetres} m`, 12, height - 24);

    if (props.showElevation && model.profile.length > 1) {
      const top = height;
      const pad = 26;
      let maxArc = 0;
      let maxDepth = 0;
      for (const q of model.profile) {
        if (q[0] > maxArc) maxArc = q[0];
        if (q[1] > maxDepth) maxDepth = q[1];
      }
      const ex = (a: number) =>
        pad + (a / Math.max(1, maxArc)) * (width - pad * 2);
      const ey = (d: number) =>
        top + 14 + (d / Math.max(1, maxDepth)) * (elevationHeight - 34);
      ctx.strokeStyle = COLOURS.axis;
      ctx.lineWidth = 1;
      ctx.strokeRect(pad, top + 14, width - pad * 2, elevationHeight - 34);
      ctx.strokeStyle = COLOURS.trace;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ex(model.profile[0][0]), ey(model.profile[0][1]));
      for (const q of model.profile) ctx.lineTo(ex(q[0]), ey(q[1]));
      ctx.stroke();
      ctx.fillStyle = COLOURS.station;
      ctx.font = '10px monospace';
      ctx.fillText('plan distance →', pad, top + 10);
      ctx.fillText(`${maxDepth.toFixed(0)} m TVD`, pad, ey(maxDepth) + 12);
      ctx.fillText(`${maxArc.toFixed(0)} m`, width - pad - 50, top + 10);
    }
  }, [
    model,
    view,
    brush,
    props,
    width,
    height,
    elevationHeight,
    toScreen,
    toWorld,
  ]);

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: 12,
        alignItems: 'flex-start',
        background: COLOURS.background,
        fontFamily: 'monospace',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width,
          height: height + elevationHeight,
          background: COLOURS.background,
          cursor: brush?.pan ? 'grabbing' : 'crosshair',
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onDoubleClick={() => setView(fitted())}
        onContextMenu={e => e.preventDefault()}
      />
      <div style={{ color: '#cfd8dc', fontSize: 12, maxWidth: 460 }}>
        <div style={{ color: '#fff', marginBottom: 6 }}>
          {props.source === 'volve'
            ? props.wellbore
            : props.preset === 'custom'
              ? props.defect
              : props.preset}
        </div>
        <div style={{ marginBottom: 10 }}>
          {(model?.problems.length ?? 0) === 0 ? (
            <div
              style={{
                background: '#12291b',
                color: '#69f0ae',
                padding: '6px 8px',
                borderLeft: '3px solid #00e676',
              }}
            >
              no issues detected
            </div>
          ) : (
            model?.problems.map((s, i) => {
              const colour =
                s.reason === 'pocket' && !s.threadable
                  ? COLOURS.unthreadable
                  : s.side === 'left'
                    ? COLOURS.problemLeft
                    : COLOURS.problemRight;
              return (
                <div
                  key={i}
                  style={{
                    background: '#161b22',
                    borderLeft: `3px solid ${colour}`,
                    padding: '5px 8px',
                    marginBottom: 3,
                  }}
                >
                  <span style={{ color: colour, fontWeight: 700 }}>
                    {s.reason.toUpperCase()}
                  </span>{' '}
                  <span style={{ color: '#90a4ae' }}>{s.side}</span>{' '}
                  {s.reason === 'pocket' ? (
                    <>
                      <span style={{ color: '#fff' }}>
                        {s.ratio.toFixed(1)}×
                      </span>{' '}
                      mouth {s.mouth.toFixed(0)} m · traps{' '}
                      {s.trappedArc.toFixed(0)} m (
                      {(s.coverage * 100).toFixed(0)}% of the trace)
                      {s.coverage > 0.5 && (
                        <div style={{ color: '#ffab40' }}>
                          most of the trace — this is the well&apos;s own shape,
                          not an obstacle in it
                        </div>
                      )}
                      {!s.threadable && (
                        <div style={{ color: COLOURS.unthreadable }}>
                          mouth is under 2·margin — no cut fits through
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <span style={{ color: '#fff' }}>
                        r {s.radius.toFixed(0)} m
                      </span>{' '}
                      ·{' '}
                      {s.sharpness > 20
                        ? 'surroundings effectively straight'
                        : `${s.sharpness.toFixed(0)}× tighter than its surroundings (${s.coarseRadius.toFixed(0)} m)`}
                    </>
                  )}
                  <div style={{ color: '#546e7a' }}>
                    vertices {s.span[0]}–{s.span[1]}
                  </div>
                </div>
              );
            })
          )}
        </div>
        {model?.notes.map((n, i) => (
          <div key={i} style={{ marginBottom: 3 }}>
            {n}
          </div>
        ))}
        {!model && <div style={{ color: '#ff5252' }}>no trajectory built</div>}
        <div style={{ marginTop: 12, color: '#78909c', lineHeight: 1.5 }}>
          drag = brush zoom · shift-drag or middle-drag = pan · wheel = zoom at
          cursor · double-click = fit
          <br />
          <br />
          white = plan trace · green = head, magenta = TD · dark band = the
          2·margin corridor a cut needs
          <br />
          <br />
          NEW detector — cyan/yellow = a pocket on the left/right, red = its
          mouth is narrower than 2·margin so no cut fits through at all. The bar
          is the mouth and the number is the arc-to-chord ratio.
          <br />
          <br />
          EXISTING detectors (off by default) — yellow hulls ={' '}
          <code>fenceObstacles</code> · orange = <code>fenceFoldSpans</code>{' '}
          ranges
        </div>
      </div>
    </div>
  );
};

const meta: Meta<Props> = {
  title: 'debug/Chunks/Trace Defects',
  component: TraceDefects,
  /**
   * A preset SEEDS the controls rather than overriding them.
   *
   * ⚠️ It used to be spread over the props, which made exactly the keys a preset happened to set
   * dead while every other control stayed live — and since each preset sets a different subset,
   * which controls responded changed as you switched preset. Writing the values into the args
   * instead means every control is always live and always shows what is drawn.
   *
   * ⚠️⚠️ It has to live in a DECORATOR, and the hooks have to be Storybook's. Preview hooks are
   * only valid in a decorator or the story function; a component passed as `meta.component` is
   * rendered by React, which is neither, and `useArgs` there throws "preview hooks can only be
   * called inside decorators and story functions". Mixing React's hooks into the same function
   * throws the same error, so these are the `storybook/preview-api` ones. `TraceDefects` is an
   * ordinary component with its own render and keeps React's.
   */
  decorators: [
    (Story, context) => {
      const [, updateArgs] = useArgs();
      const applied = useStoryRef<string | null>(null);
      const preset = context.args.preset as string;
      useStoryEffect(() => {
        if (preset === 'custom' || applied.current === preset) return;
        applied.current = preset;
        const values = TRAJECTORY_PRESETS[preset];
        if (values) updateArgs({ ...values });
      }, [preset, updateArgs]);
      return <Story />;
    },
  ],
  argTypes: {
    source: {
      control: 'inline-radio',
      options: ['synthetic', 'volve'],
      table: { category: 'shape' },
      description:
        '`synthetic` builds a shape to order from the controls below; `volve` runs the demo field’s real wellbores through the same detectors',
    },
    wellbore: {
      control: 'select',
      options: WELLBORES,
      table: { category: 'shape' },
      description: 'the demo wellbore, when source = volve',
    },
    preset: {
      control: 'select',
      options: ['custom', ...TRAJECTORY_PRESET_NAMES],
      table: { category: 'shape' },
      description:
        'a named case; `custom` uses the individual controls below. A preset OVERRIDES them',
    },
    defect: {
      control: 'select',
      options: TRAJECTORY_DEFECTS,
      table: { category: 'shape' },
    },
    featureSize: {
      control: { type: 'range', min: 5, max: 1500, step: 5 },
      table: { category: 'shape' },
      description: "the defect's own scale (m) — fold depth, loop diameter",
    },
    mouth: {
      control: { type: 'range', min: 0.05, max: 4, step: 0.05 },
      table: { category: 'shape' },
      description:
        '⭐ the opening as a FRACTION of the depth. Sweeping this at a fixed size walks a fold from a gentle excursion (3) through as-deep-as-wide (1) to a near loop (0.2) — the dimensionless ratio a wrap decision should turn on',
    },
    at: {
      control: { type: 'range', min: 0, max: 1, step: 0.01 },
      table: { category: 'shape' },
      description:
        '⭐ where the defect sits, 0 = at the kickoff (a head hook), 1 = at TD. Depth follows plan arc, so this moves it down the hole as well as along it',
    },
    reach: {
      control: { type: 'range', min: 300, max: 6000, step: 50 },
      table: { category: 'shape' },
    },
    kickoffDepth: {
      control: { type: 'range', min: 0, max: 2500, step: 50 },
      table: { category: 'shape' },
    },
    totalDepth: {
      control: { type: 'range', min: 500, max: 4000, step: 50 },
      table: { category: 'shape' },
      description:
        'extent ÷ TVD runs 0.46 on Volve and 2.08 on Troll — keep both ends of that in the sweep',
    },
    heading: {
      control: { type: 'range', min: -180, max: 180, step: 5 },
      table: { category: 'shape' },
    },
    side: {
      control: 'inline-radio',
      options: [1, -1],
      table: { category: 'shape' },
      description: 'which hand the defect turns to',
    },
    noise: {
      control: { type: 'range', min: 0, max: 10, step: 0.1 },
      table: { category: 'shape' },
      description:
        'survey scatter (m) — a detector that only works on clean curves is not done',
    },
    seed: {
      control: { type: 'range', min: 1, max: 50, step: 1 },
      table: { category: 'shape' },
    },
    spacing: {
      control: { type: 'range', min: 2, max: 60, step: 1 },
      table: { category: 'shape' },
      description:
        'station spacing (m). ⚠️ A plan feature only a few stations wide is smoothed away by the spline before any detector sees it — real surveys are 15–30 m apart',
    },
    smoothing: {
      control: { type: 'range', min: 0, max: 5, step: 1 },
      table: { category: 'shape' },
      description:
        'corner-cutting passes over the waypoints. A real hole cannot be drilled with a corner in it and the trace is splined again downstream, so 0 is a stress test rather than a realistic shape. Matters most for the zigzag, whose teeth are the smallest feature here',
    },
    verticalDrift: {
      control: { type: 'range', min: 0, max: 60, step: 1 },
      table: { category: 'shape' },
      description:
        '⭐ how far the vertical section wanders (m). A few metres is realistic — and it is a GENUINE pocket, so most real traces report one at the head',
    },
    margin: {
      control: { type: 'range', min: 0.1, max: 20, step: 0.1 },
      table: { category: 'detectors' },
      description:
        'the clearance a cut would hold. ⭐ NOT part of the new detector’s test, which is a pure ratio — it only says whether a pocket’s mouth is wide enough to pass through at all (`2·margin`), and draws the corridor band',
    },
    minRatio: {
      control: { type: 'range', min: 1.1, max: 12, step: 0.1 },
      table: { category: 'detectors' },
      description:
        '⭐ the new detector: wrap a pocket when the trace travels this many times the direct distance between its two passes. 1 = a straight line, 1.57 = a semicircle, **3 = as deep as its mouth is wide**, ∞ = a closed loop. Dimensionless, so a 25 m hook and a 900 m loop are judged the same way',
    },
    showTrace: { control: 'boolean', table: { category: 'view' } },
    showStations: {
      control: 'boolean',
      table: { category: 'view' },
      description:
        'the raw survey stations, before splining and simplification',
    },
    showObstacles: { control: 'boolean', table: { category: 'view' } },
    showFoldSpans: { control: 'boolean', table: { category: 'view' } },
    showElevation: {
      control: 'boolean',
      table: { category: 'view' },
      description:
        'depth against plan distance — a plan-only view is what hid this class of problem',
    },
    size: {
      control: { type: 'range', min: 400, max: 1400, step: 20 },
      table: { category: 'view' },
    },
  },
  args: {
    source: 'synthetic',
    wellbore: WELLBORES[0] ?? '',
    preset: 'deviated fold (narrow)',
    defect: 'fold',
    featureSize: 400,
    mouth: 1,
    at: 0.5,
    reach: 2500,
    kickoffDepth: 600,
    totalDepth: 2200,
    heading: 0,
    side: 1,
    noise: 0,
    seed: 1,
    spacing: 15,
    smoothing: 3,
    verticalDrift: 8,
    margin: 1,
    minRatio: 3,
    minSharpness: 3,
    showTrace: true,
    showStations: false,
    showMargin: true,
    showProblems: true,
    showObstacles: false,
    showFoldSpans: false,
    showElevation: true,
    size: 760,
  },
};

export default meta;

export const Default: StoryObj<Props> = {};
