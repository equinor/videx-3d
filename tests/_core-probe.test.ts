/* THROWAWAY probe — delete after. Reports undesirable-shape metrics on the followed
   CORE (margin 0) per well, to triage which need visual inspection.
   FENCE_PROBE=1 npx vitest run tests/_core-probe.test.ts --disable-console-intercept */
import { describe, it } from 'vitest';
import { Vec2 } from '../src/sdk/types/common';
import {
  countPolylineLoops,
  polylineArcLengths,
  polylineLength,
  polylineMaxTurn,
} from '../src/sdk/utils/polyline-2d';
import { fenceFor, wellboreIds, wellboreName } from './fence-fixtures';

/** Count near-self-approaches: i,j far in arc but close in space (pinch-outs). */
function pinches(pts: Vec2[], gap: number, arcFactor: number): number {
  const arc = polylineArcLengths(pts);
  let n = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 2; j < pts.length; j++) {
      if (arc[j] - arc[i] < arcFactor * gap) continue;
      const d = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
      if (d < gap) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** Sharp corners: turn > thresh between two segments both longer than minLen. */
function sharpCorners(pts: Vec2[], thresholdDeg: number, minLen: number): number {
  let n = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const ax = pts[i][0] - pts[i - 1][0];
    const az = pts[i][1] - pts[i - 1][1];
    const bx = pts[i + 1][0] - pts[i][0];
    const bz = pts[i + 1][1] - pts[i][1];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < minLen || lb < minLen) continue;
    const cos = (ax * bx + az * bz) / (la * lb);
    const turn = (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
    if (turn > thresholdDeg) n++;
  }
  return n;
}

/** Direction-change reversals per km (high-frequency wiggle). */
function wiggle(pts: Vec2[]): number {
  let reversals = 0;
  let prevCross = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const ax = pts[i][0] - pts[i - 1][0];
    const az = pts[i][1] - pts[i - 1][1];
    const bx = pts[i + 1][0] - pts[i][0];
    const bz = pts[i + 1][1] - pts[i][1];
    const cross = ax * bz - az * bx;
    if (cross * prevCross < 0) reversals++;
    if (Math.abs(cross) > 1e-6) prevCross = cross;
  }
  const km = polylineLength(pts) / 1000;
  return km > 0 ? reversals / km : 0;
}

describe.skipIf(!process.env.FENCE_PROBE)('core probe', () => {
  it('undesirable-shape metrics on the followed core', () => {
    console.log(
      '\nwell            vtx  loops  maxTurn  pinch  sharp  wiggle/km',
    );
    const rows: { name: string; score: number; line: string }[] = [];
    for (const id of wellboreIds) {
      const fence = fenceFor(id, 0);
      if (!fence) continue;
      const c = fence.plus.curve.core;
      const loops = countPolylineLoops(c);
      const mt = polylineMaxTurn(c, 200);
      const pin = pinches(c, 60, 4);
      const sharp = sharpCorners(c, 35, 40);
      const wig = wiggle(c);
      const score = loops * 100 + pin * 30 + sharp * 10 + wig;
      rows.push({
        name: wellboreName(id),
        score,
        line: `${wellboreName(id).padEnd(14)} ${String(c.length).padStart(4)} ${String(loops).padStart(5)}  ${((mt * 180) / Math.PI).toFixed(0).padStart(6)}  ${String(pin).padStart(5)}  ${String(sharp).padStart(5)}  ${wig.toFixed(1).padStart(7)}`,
      });
    }
    rows.sort((a, b) => b.score - a.score);
    for (const r of rows) console.log(r.line);
  });
});
