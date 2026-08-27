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
  polylineSharpEdges,
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
  /** the raw plan trace of the survey stations (NOT the fence's spline) */
  survey: Vec2[];
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
  sharpTurn: number,
  sharpArm: number,
  tolerance: number,
  simplify: number,
): FenceDebugModel | null {
  return useMemo(() => {
    if (!trajectory || trajectory.length < 3 || rings.length === 0) return null;
    const curve = getSplineCurve(trajectory);
    if (!curve) return null;
    const fence = buildWellboreFence(curve, {
      rings,
      margin,
      sharpTurn: (Math.max(1, sharpTurn) * Math.PI) / 180,
      sharpArm: Math.max(1, sharpArm),
      tolerance,
      simplify,
    });
    if (!fence) return null;
    return {
      fence,
      report: fence.report,
      problems: assertFenceInvariants(fence.report),
      survey: trajectory.map(p => [p[0], p[2]] as Vec2),
      curve,
    };
  }, [trajectory, rings, margin, sharpTurn, sharpArm, tolerance, simplify]);
}

/** One well's health on the current fence. @see useFenceHealth */
export type WellHealth = {
  id: string;
  name: string;
  degenerate: boolean;
  /** worst signed depth of the two sides, in metres (positive = well left on the kept side) */
  burial: number;
  /** true when the well is short of the margin clearance by more than the tolerance */
  buried: boolean;
  /** sharp-edge regions on the two cuts, by the arm-weighted rule */
  sharp: number;
};

/** The per-well facts a build settles that the split does NOT recompute. */
type WellBuild = Omit<WellHealth, 'sharp' | 'buried'> & {
  plus: Vec2[];
  minus: Vec2[];
};

/**
 * Build a fence for EVERY well and record what its health turns on: the worst burial.
 * Heavy — one fence per well, built with the SAME sharp and tolerance the diagnostics
 * use, so a highlighted defect is one the construction actually failed to avoid.
 */
export function computeFenceHealth(
  trajectories: Map<string, Vec3[]>,
  headers: Record<string, { name?: string }>,
  rings: Vec2[][],
  margin: number,
  sharpTurn: number,
  sharpArm: number,
  tolerance: number,
  simplify: number,
): WellBuild[] {
  const out: WellBuild[] = [];
  for (const [id, trajectory] of trajectories) {
    if (trajectory.length < 3) continue;
    const curve = getSplineCurve(trajectory);
    if (!curve) continue;
    const fence = buildWellboreFence(curve, {
      rings,
      margin,
      sharpTurn: (Math.max(1, sharpTurn) * Math.PI) / 180,
      sharpArm: Math.max(1, sharpArm),
      tolerance,
      simplify,
    });
    if (!fence) continue;
    const plus = fence.plus.curve.points;
    const minus = fence.minus.curve.points;
    out.push({
      id,
      name: headers[id]?.name ?? id,
      degenerate: fence.base.degenerate,
      burial: Math.max(
        fence.report.sides.plus.burial,
        fence.report.sides.minus.burial,
      ),
      plus,
      minus,
    });
  }
  return out;
}

/** The two lists the debug view links to. @see useFenceHealth */
export type FenceHealth = {
  healthy: WellHealth[];
  problem: WellHealth[];
  /** true while the per-well builds are still running */
  pending: boolean;
};

/**
 * Split every well into HEALTHY vs PROBLEM (short of the margin clearance, or a sharp
 * turn) on the REAL cut.
 *
 * ⭐ The heavy per-well build runs in an effect off the render path, keyed on every param
 * that shapes the cut (margin, sharp, tolerance) so it stays interactive; the split is a
 * memo over the built curves. Burial is the SAME margin-relative measure the overlay
 * highlights and the sharp test the SAME {@link polylineSharpEdges} rule — and the cut was
 * BUILT against both — so a problem here is exactly what the story highlights.
 */
export function useFenceHealth(
  trajectories: Map<string, Vec3[]> | null,
  headers: Record<string, { name?: string }>,
  rings: Vec2[][],
  margin: number,
  sharpTurn: number,
  sharpArm: number,
  tolerance: number,
  simplify: number,
): FenceHealth {
  const [builds, setBuilds] = useState<WellBuild[] | null>(null);
  useEffect(() => {
    if (!trajectories || rings.length === 0) {
      setBuilds(null);
      return;
    }
    // ⭐ Debounced ~1 s: every param here reshapes all 26 cuts, so a slider drag would
    // otherwise rebuild the whole field on each tick. The cleanup cancels the pending run,
    // and the previous lists stay on screen until the new build lands (no flicker).
    let cancelled = false;
    const handle = setTimeout(() => {
      const result = computeFenceHealth(
        trajectories,
        headers,
        rings,
        margin,
        sharpTurn,
        sharpArm,
        tolerance,
        simplify,
      );
      if (!cancelled) setBuilds(result);
    }, 1000);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [
    trajectories,
    headers,
    rings,
    margin,
    sharpTurn,
    sharpArm,
    tolerance,
    simplify,
  ]);

  return useMemo(() => {
    if (!builds) return { healthy: [], problem: [], pending: true };
    const turn = (Math.max(1, sharpTurn) * Math.PI) / 180;
    const arm = Math.max(1, sharpArm);
    // The well is short of the margin when its worst signed depth exceeds tolerance - margin.
    const buriedFloor = tolerance - margin;
    const rows: WellHealth[] = builds.map(b => ({
      id: b.id,
      name: b.name,
      degenerate: b.degenerate,
      burial: b.burial,
      buried: b.burial > buriedFloor,
      sharp:
        polylineSharpEdges(b.plus, turn, arm).length +
        polylineSharpEdges(b.minus, turn, arm).length,
    }));
    const isProblem = (r: WellHealth) => r.buried || r.sharp > 0;
    // Worst (least cleared) first — the well's max signed depth, high to low.
    const problem = rows.filter(isProblem).sort((a, b) => b.burial - a.burial);
    const healthy = rows
      .filter(r => !isProblem(r))
      .sort((a, b) => b.burial - a.burial);
    return { healthy, problem, pending: false };
  }, [builds, sharpTurn, sharpArm, tolerance, margin]);
}

const COLOURS = {
  outline: '#3a4a5a',
  survey: '#7a7a7a',
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

/** Stable default so the overlay draws every kind unless a caller narrows it. */
const ALL_DEFECT_KINDS: FenceDefect['kind'][] = [
  'burial',
  'sharp',
  'pinch',
  'wiggle',
];

/** What the plan view frames. @see FencePlanView */
export type FenceFocus = 'fit' | 'wellbore' | 'head' | 'td' | 'curvepos';

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
  showSurvey = true,
  showBase = true,
  showLeft = true,
  showRight = true,
  defectKinds = ALL_DEFECT_KINDS,
  focus = 'fit',
  focusRadius = 600,
  curvePos = 0.5,
  sharpTurn = 30,
  sharpArm = 10,
}: {
  model: FenceDebugModel | null;
  rings: Vec2[][];
  size?: number;
  showSurvey?: boolean;
  showBase?: boolean;
  showLeft?: boolean;
  showRight?: boolean;
  defectKinds?: FenceDefect['kind'][];
  focus?: FenceFocus;
  focusRadius?: number;
  curvePos?: number;
  /** relative turn (DEGREES) that is a sharp edge at the reference arm length. */
  sharpTurn?: number;
  /** reference arm length, in metres — a longer arm makes a smaller turn count as sharp. */
  sharpArm?: number;
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
      // ⭐ Fit the WHOLE fence: both cuts with their run-outs, the footprint and the
      // survey — the view for judging the run-outs and how the two sides converge.
      for (const p of model.fence.plus.curve.points) take(p);
      for (const p of model.fence.minus.curve.points) take(p);
      for (const ring of rings) for (const p of ring) take(p);
      for (const p of model.survey) take(p);
    } else if (focus === 'wellbore') {
      // ⭐ Fit the TRAJECTORY only — the run-outs reach far past the footprint and
      // would shrink the well to a dot, so this is the view for tuning the PATH.
      for (const p of model.survey) take(p);
    } else {
      // ⭐ `curvepos` frames an EXACT position along the 3D spline (0 = head, 1 = TD),
      // read straight off the interpolator so a specific feature can be dialled in.
      let at: Vec2;
      if (focus === 'head') at = model.survey[0];
      else if (focus === 'td') at = model.survey[model.survey.length - 1];
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

    if (showSurvey) stroke(model.survey, COLOURS.survey, 1);
    if (showBase) stroke(model.fence.base.points, COLOURS.base, 2);
    // ⭐ The ACTUAL cut per side — `curve.points`, the smoothed curve WITH run-outs that
    // the field is built from and that burial is measured against. Drawing `core` (the
    // pre-smoothing path) instead put the cut ~0.5 m off the burial highlight. LEFT is
    // side +1, RIGHT side -1; toggled independently. At margin 0 the two coincide.
    if (showLeft) stroke(model.fence.plus.curve.points, COLOURS.plus, 2.5);
    if (showRight) stroke(model.fence.minus.curve.points, COLOURS.minus, 1.5);

    // ⭐ Defect overlay: fat, semi-transparent marks over exactly what the diagnostic
    // flags — burial runs sit on the WELL, the turn kinds on the offending core corner —
    // so what the scorer catches (and misses) is visible at a glance. Each kind can be
    // toggled independently to isolate one class of defect.
    if (defectKinds.length > 0) {
      context.lineCap = 'round';
      context.lineJoin = 'round';
      const drawDefects = (
        defects: FenceDefect[],
        colour?: string,
        lineWidth = 8,
      ) => {
        for (const d of defects) {
          if (d.points.length === 0 || !defectKinds.includes(d.kind)) continue;
          context.strokeStyle =
            colour ?? DEFECT_COLOURS[d.kind] ?? 'rgba(255,255,255,0.5)';
          context.lineWidth = lineWidth;
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
      if (showLeft)
        drawDefects(
          model.report.sides.plus.diagnosis.defects.filter(
            d => d.kind !== 'sharp',
          ),
        );
      if (showRight)
        drawDefects(
          model.report.sides.minus.diagnosis.defects.filter(
            d => d.kind !== 'sharp',
          ),
        );
      // ⭐ Sharp bends recomputed LIVE from the story sliders, so the threshold can be
      // dialled to the eye without a rebuild. Cut sharp in orange, the SPLINE's own
      // doglegs in cyan so a sharp cut can be told apart from a sharp trajectory.
      if (defectKinds.includes('sharp')) {
        const turnRad = (Math.max(1, sharpTurn) * Math.PI) / 180;
        const arm = Math.max(1, sharpArm);
        const toDefects = (pts: Vec2[]): FenceDefect[] =>
          polylineSharpEdges(pts, turnRad, arm).map(points => ({
            kind: 'sharp' as const,
            points,
          }));
        if (showLeft)
          drawDefects(toDefects(model.fence.plus.curve.points), undefined, 8);
        if (showRight)
          drawDefects(toDefects(model.fence.minus.curve.points), undefined, 8);
        drawDefects(
          toDefects(model.fence.base.points),
          'rgba(80, 220, 255, 0.55)',
          4,
        );
      }
      context.lineCap = 'butt';
      context.lineJoin = 'miter';
    }

    // ⭐ The WELLHEAD and TD. A cut can look perfect everywhere and still bury the
    // head, which is the one place a viewer always looks — so mark it rather than
    // leaving it to be inferred from where the red trace happens to start.
    const head = model.survey[0];
    const td = model.survey[model.survey.length - 1];
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
    showSurvey,
    showBase,
    showLeft,
    showRight,
    defectKinds,
    focus,
    focusRadius,
    curvePos,
    sharpTurn,
    sharpArm,
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
        label="bridged L/R"
        value={`${n(report.sides.plus.diagnosis.bridged * 100)}% / ${n(report.sides.minus.diagnosis.bridged * 100)}%`}
      />
      <Row
        label="trace sharp/loops"
        value={`${report.trace.sharpBends} / ${report.trace.loops}`}
        bad={report.trace.loops > 0}
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

/** A clickable well name that switches the debug view to it. */
function HealthRow({
  row,
  selected,
  onSelect,
}: {
  row: WellHealth;
  selected: boolean;
  onSelect: (name: string) => void;
}) {
  const flags = (row.buried ? 'B' : '') + (row.sharp > 0 ? 'S' : '');
  return (
    <button
      type="button"
      onClick={() => onSelect(row.name)}
      title={`burial ${row.burial.toFixed(2)} m \u00b7 sharp ${row.sharp}`}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        font: '11px ui-monospace, monospace',
        color: selected ? '#0f1216' : '#cdd6e0',
        background: selected ? '#4aa3ff' : 'transparent',
        border: 'none',
        borderRadius: 3,
        padding: '2px 6px',
        cursor: 'pointer',
      }}
    >
      <span>
        {row.name}
        {row.degenerate ? ' \u00b7v' : ''}
      </span>
      <span style={{ opacity: 0.75 }}>{flags}</span>
    </button>
  );
}

/**
 * The healthy and problem well lists, as links.
 *
 * ⭐ Click a name to switch the whole view to that well — the fastest way to sweep the
 * healthy list for false passes, then read the problem list for what they share. A
 * problem row is flagged B (burial) and/or S (sharp); its number is the burial, a
 * healthy row's is the tightest clearance. A trailing \u00b7v marks a near-vertical well.
 */
export function FenceHealthLists({
  health,
  selected,
  onSelect,
}: {
  health: FenceHealth;
  selected: string;
  onSelect: (name: string) => void;
}) {
  const { healthy, problem, pending } = health;
  return (
    <div style={{ minWidth: 250, maxHeight: '100vh', overflow: 'auto' }}>
      <div style={{ color: '#66bb6a', margin: '0 0 4px' }}>
        healthy ({healthy.length})
        {pending ? (
          <span style={{ opacity: 0.5 }}> {'\u2014 classifying\u2026'}</span>
        ) : null}
      </div>
      <div style={{ display: 'grid', gap: 1 }}>
        {healthy.map(r => (
          <HealthRow
            key={r.id}
            row={r}
            selected={r.name === selected}
            onSelect={onSelect}
          />
        ))}
      </div>
      <div style={{ color: '#ff7043', margin: '12px 0 4px' }}>
        problem ({problem.length})
      </div>
      <div style={{ display: 'grid', gap: 1 }}>
        {problem.map(r => (
          <HealthRow
            key={r.id}
            row={r}
            selected={r.name === selected}
            onSelect={onSelect}
          />
        ))}
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
          survey: model.survey,
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
