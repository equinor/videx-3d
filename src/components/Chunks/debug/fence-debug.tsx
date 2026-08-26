import { useEffect, useMemo, useRef, useState } from 'react';
import {
  assertFenceInvariants,
  buildWellboreFence,
  Curve3D,
  FenceDefect,
  FenceReport,
  fenceSideAt,
  getSplineCurve,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  Vec2,
  Vec3,
  WellboreFence,
} from '../../../sdk';

/**
 * Everything the fence debug views need, derived once.
 *
 * ⭐ Built around {@link FenceReport} rather than around a second set of
 * measurements. The HUD, the plan overlay and the tests all read the SAME object,
 * so they cannot drift into disagreeing about what the fence did.
 */
export type FenceDebugModel = {
  fence: WellboreFence;
  report: FenceReport;
  problems: string[];
  /** the raw plan trace of the survey stations */
  trace: Vec2[];
  /** the 3D spline, so a view can frame an exact curve position */
  curve: Curve3D;
};

/** Every ring of an outline in absolute scene XZ. */
export function debugOutlineRings(
  outline: PlanarPolygonGeometry | null,
): Vec2[][] {
  if (!outline) return [];
  const [ox, oz] = outline.offset;
  const rings: Vec2[][] = [];
  for (const polygon of outline.coordinates as PlanarPolygonCoordinates) {
    for (const ring of polygon) {
      rings.push(ring.map(p => [p[0] + ox, p[1] + oz] as Vec2));
    }
  }
  return rings;
}

/** Build the model, or `null` while the trajectory has not resolved. */
export function useFenceDebugModel(
  trajectory: Vec3[] | null,
  rings: Vec2[][],
  margin: number,
): FenceDebugModel | null {
  return useMemo(() => {
    if (!trajectory || trajectory.length < 3 || rings.length === 0) return null;
    const curve = getSplineCurve(trajectory);
    if (!curve) return null;
    const fence = buildWellboreFence(curve, { rings, margin });
    if (!fence) return null;
    return {
      fence,
      report: fence.report,
      problems: assertFenceInvariants(fence.report),
      trace: trajectory.map(p => [p[0], p[2]] as Vec2),
      curve,
    };
  }, [trajectory, rings, margin]);
}

const COLOURS = {
  outline: '#3a4a5a',
  trace: '#7a7a7a',
  base: '#2ecc71',
  plus: '#4aa3ff',
  minus: '#ff7043',
  arm: '#ffd54f',
  head: '#ffffff',
  td: '#b388ff',
  grid: '#1a1f26',
};

/** Fat semi-transparent overlay colours for each defect the diagnostic flags. */
const DEFECT_COLOURS: Record<string, string> = {
  burial: 'rgba(255, 60, 60, 0.5)',
  sharp: 'rgba(255, 160, 40, 0.5)',
  pinch: 'rgba(255, 110, 210, 0.5)',
  wiggle: 'rgba(255, 220, 60, 0.5)',
};

/** What the plan view frames. @see FencePlanView */
export type FenceFocus = 'fit' | 'head' | 'td' | 'curvepos';

/**
 * Draw the whole fence in PLAN.
 *
 * ⭐⭐ The single most legible view of this feature. A fold, a hairpin, a run-out
 * that leaves without crossing the block, or two sides that have diverged are all
 * obvious here and very nearly invisible in the 3D view.
 *
 * ⭐ `focus` frames the head or TD instead of the whole fence. Whole-fence views and
 * aggregate numbers both hide what happens over the last few hundred metres, which
 * is where the run-out joins and where a viewer always looks.
 */
export function FencePlanView({
  model,
  rings,
  size = 460,
  showTrace = true,
  showBase = true,
  showLeft = true,
  showRight = true,
  showDefects = true,
  focus = 'fit',
  focusRadius = 600,
  curvePos = 0.5,
}: {
  model: FenceDebugModel | null;
  rings: Vec2[][];
  size?: number;
  showTrace?: boolean;
  showBase?: boolean;
  showLeft?: boolean;
  showRight?: boolean;
  showDefects?: boolean;
  focus?: FenceFocus;
  focusRadius?: number;
  curvePos?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    const width = size;
    const height = size;
    context.fillStyle = COLOURS.grid;
    context.fillRect(0, 0, width, height);
    if (!model) return;

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
    if (focus === 'fit') {
      // ⭐ Fit the TRAJECTORY, not the fence with its run-outs — the run-outs reach
      // far past the footprint and would shrink the well to a dot. Their off-screen
      // tails are what we are deliberately ignoring while the path is tuned.
      for (const p of model.trace) take(p);
    } else {
      // ⭐ `curvepos` frames an EXACT position along the 3D spline (0 = head, 1 = TD),
      // read straight off the interpolator so a specific feature can be dialled in.
      let at: Vec2;
      if (focus === 'head') at = model.trace[0];
      else if (focus === 'td') at = model.trace[model.trace.length - 1];
      else {
        const p = model.curve.getPointAt(Math.min(1, Math.max(0, curvePos)));
        at = [p[0], p[2]];
      }
      const r = Math.max(focusRadius, 1);
      minX = at[0] - r;
      maxX = at[0] + r;
      minZ = at[1] - r;
      maxZ = at[1] + r;
    }
    const span = Math.max(maxX - minX, maxZ - minZ) || 1;
    const pad = 12;
    const scale = (width - pad * 2) / span;
    // Plan view looks DOWN, so +Z runs down the canvas.
    const toX = (x: number) => pad + (x - minX) * scale;
    const toY = (z: number) => pad + (z - minZ) * scale;

    const stroke = (points: Vec2[], colour: string, lineWidth = 1.5) => {
      if (points.length < 2) return;
      context.strokeStyle = colour;
      context.lineWidth = lineWidth;
      context.beginPath();
      context.moveTo(toX(points[0][0]), toY(points[0][1]));
      for (let i = 1; i < points.length; i++) {
        context.lineTo(toX(points[i][0]), toY(points[i][1]));
      }
      context.stroke();
    };

    for (const ring of rings) {
      context.strokeStyle = COLOURS.outline;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(toX(ring[0][0]), toY(ring[0][1]));
      for (const p of ring) context.lineTo(toX(p[0]), toY(p[1]));
      context.closePath();
      context.stroke();
    }

    if (showTrace) stroke(model.trace, COLOURS.trace, 1);
    if (showBase) stroke(model.fence.base.points, COLOURS.base, 2);
    // ⭐ The followed path per side, WITHOUT run-outs. LEFT is the half to the left of
    // the well's tangent (side +1); RIGHT is side -1. Toggled independently so one side
    // can be read alone. At margin 0 the two coincide.
    if (showLeft) stroke(model.fence.plus.curve.core, COLOURS.plus, 2.5);
    if (showRight) stroke(model.fence.minus.curve.core, COLOURS.minus, 1.5);

    // ⭐ Defect overlay: fat, semi-transparent marks over exactly what the diagnostic
    // flags — burial runs sit on the WELL, the turn kinds on the offending core corner —
    // so what the scorer catches (and misses) is visible at a glance.
    if (showDefects) {
      context.lineCap = 'round';
      context.lineJoin = 'round';
      const drawDefects = (defects: FenceDefect[]) => {
        for (const d of defects) {
          if (d.points.length === 0) continue;
          context.strokeStyle =
            DEFECT_COLOURS[d.kind] ?? 'rgba(255,255,255,0.5)';
          context.lineWidth = 8;
          context.beginPath();
          context.moveTo(toX(d.points[0][0]), toY(d.points[0][1]));
          for (let i = 1; i < d.points.length; i++) {
            context.lineTo(toX(d.points[i][0]), toY(d.points[i][1]));
          }
          // A single-point run still renders as a dot under the round cap.
          if (d.points.length === 1) {
            context.lineTo(toX(d.points[0][0]), toY(d.points[0][1]));
          }
          context.stroke();
        }
      };
      if (showLeft) drawDefects(model.report.sides.plus.diagnosis.defects);
      if (showRight) drawDefects(model.report.sides.minus.diagnosis.defects);
      context.lineCap = 'butt';
      context.lineJoin = 'miter';
    }

    // ⭐ The WELLHEAD and TD. A cut can look perfect everywhere and still bury the
    // head, which is the one place a viewer always looks — so mark it rather than
    // leaving it to be inferred from where the red trace happens to start.
    const head = model.trace[0];
    const td = model.trace[model.trace.length - 1];
    context.strokeStyle = COLOURS.head;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(toX(head[0]), toY(head[1]), 7, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(toX(head[0]) - 10, toY(head[1]));
    context.lineTo(toX(head[0]) + 10, toY(head[1]));
    context.moveTo(toX(head[0]), toY(head[1]) - 10);
    context.lineTo(toX(head[0]), toY(head[1]) + 10);
    context.stroke();
    context.fillStyle = COLOURS.td;
    context.fillRect(toX(td[0]) - 4, toY(td[1]) - 4, 8, 8);

    // ⭐ A metre reference. Zoomed in on a head, "the cut is close to the well" is
    // not a judgement anyone can make without one.
    const rough = span / 4;
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const bar =
      [1, 2, 5, 10].map(m => m * power).find(v => v >= rough) ?? rough;
    const barPixels = bar * scale;
    const y = height - pad;
    context.strokeStyle = COLOURS.outline;
    context.fillStyle = COLOURS.outline;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(pad, y);
    context.lineTo(pad + barPixels, y);
    context.moveTo(pad, y - 4);
    context.lineTo(pad, y + 4);
    context.moveTo(pad + barPixels, y - 4);
    context.lineTo(pad + barPixels, y + 4);
    context.stroke();
    context.font = '10px ui-monospace, monospace';
    context.fillText(`${bar} m`, pad + barPixels + 6, y + 3);
  }, [
    model,
    rings,
    size,
    showTrace,
    showBase,
    showLeft,
    showRight,
    showDefects,
    focus,
    focusRadius,
    curvePos,
  ]);

  return (
    <canvas
      ref={canvas}
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: 4 }}
    />
  );
}

function Row({
  label,
  value,
  bad,
}: {
  label: string;
  value: string;
  bad?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span style={{ color: bad ? '#ff5252' : '#e0e0e0' }}>{value}</span>
    </div>
  );
}

/**
 * The numbers, as text.
 *
 * ⭐ The primary check. Reading these out of the DOM costs a fraction of a
 * screenshot and covers everything except genuine look-and-feel judgement.
 */
export function FenceHud({ model }: { model: FenceDebugModel | null }) {
  if (!model) return <div style={{ color: '#888' }}>no fence</div>;
  const { report, problems } = model;
  const n = (v: number, digits = 0) =>
    Number.isFinite(v) ? v.toFixed(digits) : '\u221e';
  const total = Object.values(report.timings).reduce((a, b) => a + b, 0);
  return (
    <div
      data-testid="fence-hud"
      style={{
        font: '11px ui-monospace, monospace',
        color: '#e0e0e0',
        display: 'grid',
        gap: 2,
        minWidth: 280,
      }}
    >
      <Row
        label="samples"
        value={`${report.sampling.count} (+${report.sampling.inserted})`}
      />
      <Row
        label="max plan turn"
        value={`${n(report.sampling.maxTurn)}\u00b0`}
      />
      <Row
        label="kickoff"
        value={report.kickoff.found ? `${n(report.kickoff.md)} m MD` : 'none'}
      />
      <Row label="clearance" value={`${n(report.clearance)} m`} />
      <Row
        label="run-out clearance"
        value={`${n(report.extensions.startClearance)}\u00b0 / ${n(report.extensions.endClearance)}\u00b0`}
      />
      <Row
        label="evenness"
        value={`${n(report.extensions.evenness * 100)}% of ${report.extensions.scored} pairs`}
      />
      <Row
        label="removed L/R"
        value={`${n(report.sides.plus.removedShare * 100)}% / ${n(report.sides.minus.removedShare * 100)}%`}
      />
      <Row
        label="buried L/R"
        value={`${n(report.sides.plus.burial)} / ${n(report.sides.minus.burial)} m`}
        bad={Math.max(report.sides.plus.burial, report.sides.minus.burial) > 15}
      />
      <Row
        label="bridges L/R"
        value={`${report.sides.plus.bridges} / ${report.sides.minus.bridges}`}
      />
      <Row
        label="opening L"
        value={report.sides.plus.opening.map(v => `${n(v)}\u00b0`).join(' ')}
      />
      <Row
        label="opening R"
        value={report.sides.minus.opening.map(v => `${n(v)}\u00b0`).join(' ')}
      />
      <Row
        label="loops L/R"
        value={`${report.sides.plus.loops} / ${report.sides.minus.loops}`}
        bad={report.sides.plus.loops + report.sides.minus.loops > 0}
      />
      <Row
        label="max turn L/R"
        value={`${n(report.sides.plus.maxTurn)}\u00b0 / ${n(report.sides.minus.maxTurn)}\u00b0`}
      />
      <Row
        label="diag burial L/R"
        value={`${n(report.sides.plus.diagnosis.burial, 1)} / ${n(report.sides.minus.diagnosis.burial, 1)} m`}
        bad={
          Math.max(
            report.sides.plus.diagnosis.burial,
            report.sides.minus.diagnosis.burial,
          ) > report.sides.plus.diagnosis.tolerance
        }
      />
      <Row
        label="sharp/pinch/wiggle L"
        value={`${report.sides.plus.diagnosis.sharpTurns} / ${report.sides.plus.diagnosis.pinches} / ${report.sides.plus.diagnosis.wiggle}`}
        bad={
          report.sides.plus.diagnosis.sharpTurns +
            report.sides.plus.diagnosis.pinches +
            report.sides.plus.diagnosis.wiggle >
          0
        }
      />
      <Row
        label="sharp/pinch/wiggle R"
        value={`${report.sides.minus.diagnosis.sharpTurns} / ${report.sides.minus.diagnosis.pinches} / ${report.sides.minus.diagnosis.wiggle}`}
        bad={
          report.sides.minus.diagnosis.sharpTurns +
            report.sides.minus.diagnosis.pinches +
            report.sides.minus.diagnosis.wiggle >
          0
        }
      />
      <Row
        label="bridged L/R"
        value={`${n(report.sides.plus.diagnosis.bridged * 100)}% / ${n(report.sides.minus.diagnosis.bridged * 100)}%`}
      />
      <Row
        label="verdict L"
        value={
          report.sides.plus.diagnosis.clean
            ? 'clean'
            : report.sides.plus.diagnosis.issues.join('; ')
        }
        bad={!report.sides.plus.diagnosis.clean}
      />
      <Row
        label="verdict R"
        value={
          report.sides.minus.diagnosis.clean
            ? 'clean'
            : report.sides.minus.diagnosis.issues.join('; ')
        }
        bad={!report.sides.minus.diagnosis.clean}
      />
      <Row
        label="sides"
        value={report.shared ? 'shared curve' : 'tailored per side'}
      />
      <Row
        label="field"
        value={`${report.sides.plus.field.nx}x${report.sides.plus.field.ny} @ ${n(report.sides.plus.field.cell, 1)} m`}
      />
      <Row label="build" value={`${n(total)} ms`} />
      <div
        style={{ marginTop: 6, color: problems.length ? '#ff5252' : '#66bb6a' }}
      >
        {problems.length === 0
          ? 'invariants ok'
          : problems.map(p => <div key={p}>! {p}</div>)}
      </div>
    </div>
  );
}

/** Expose the model for headless probing, so numbers need no screenshot. */
export function useFenceDebugHandle(model: FenceDebugModel | null) {
  const [, force] = useState(0);
  useEffect(() => {
    const target = window as unknown as Record<string, unknown>;
    target.__videxFence = model
      ? {
          report: model.report,
          problems: model.problems,
          base: model.fence.base.points,
          plus: model.fence.plus.curve.points,
          minus: model.fence.minus.curve.points,
          plusCore: model.fence.plus.curve.core,
          minusCore: model.fence.minus.curve.core,
          sampleField: (side: 1 | -1) => {
            const at = side > 0 ? model.fence.plus : model.fence.minus;
            return (x: number, z: number) =>
              fenceSideAt(at.index, at.field, x, z);
          },
        }
      : null;
    force(v => v + 1);
    return () => {
      delete target.__videxFence;
    };
  }, [model]);
}
