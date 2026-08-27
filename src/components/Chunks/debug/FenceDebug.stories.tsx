import { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import { useArgs } from 'storybook/preview-api';
import { createWellboreOutline, FenceDefect, Vec2, Vec3 } from '../../../sdk';
import { CRS, getProjectionDefFromUtmZone } from '../../../sdk/projection/crs';
import storyArgs from '../../../storybook/story-args.json';
import {
  debugOutlineRings,
  FenceFocus,
  FenceHealthLists,
  FenceHud,
  FencePlanView,
  useFenceDebugHandle,
  useFenceDebugModel,
  useFenceHealth,
} from './fence-debug';

/**
 * Fence diagnostics.
 *
 * ⭐⭐ A PLAN view plus the numbers, because that is what this feature is actually
 * hard in. A fold, a hairpin, a run-out that leaves without crossing the block, or
 * two sides that have quietly diverged are all obvious from above and very nearly
 * invisible in the 3D view.
 *
 * ⭐ Driveable from the URL, like the OIT debug harness:
 * `?id=debug-chunk-fence--default&args=wellbore:NO%2015%2F9-F-12;margin:50`
 *
 * ⭐ `window.__videxFence` carries the report, the curves and a field sampler, so a
 * headless check can read numbers instead of taking a screenshot.
 */

type Header = { id: string; name: string; easting: number; northing: number };

/** Every wellbore the demo data carries, so the control can be a dropdown. */
const WELLBORES = Object.values(
  storyArgs.wellboreOptions as Record<string, string>,
).sort((a, b) => a.localeCompare(b));

/** Stable empty headers so the health effect does not re-run before data loads. */
const NO_HEADERS: Record<string, { name?: string }> = {};

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
      .then(([headers, logs]) => setData({ headers, logs }))
      .catch(() => setData(null));
  }, []);
  return data;
}

type Props = {
  wellbore: string;
  margin: number;
  simplify: number;
  focus: FenceFocus;
  focusRadius: number;
  curvePos: number;
  sharpTurn: number;
  sharpArm: number;
  tolerance: number;
  showSurvey: boolean;
  showBase: boolean;
  showLeft: boolean;
  showRight: boolean;
  size: number;
  defectKinds: FenceDefect['kind'][];
  /** provided by the story render, not a control — switches the selected wellbore */
  onSelectWellbore?: (name: string) => void;
};

const FenceDebug = (props: Props) => {
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

  const rings = useMemo(() => {
    if (!trajectories) return [];
    return debugOutlineRings(
      createWellboreOutline(
        [...trajectories.values()].map(t => t.map(p => [p[0], p[2]] as Vec2)),
        { radius: 1500, feather: 1, smoothing: 2 },
      ),
    );
  }, [trajectories]);

  const selected = useMemo(() => {
    if (!data || !trajectories) return null;
    const byName = Object.keys(data.headers).find(
      id => data.headers[id].name === props.wellbore,
    );
    return trajectories.get(byName ?? props.wellbore) ?? null;
  }, [data, trajectories, props.wellbore]);

  const model = useFenceDebugModel(
    selected,
    rings,
    props.margin,
    props.sharpTurn,
    props.sharpArm,
    props.tolerance,
    props.simplify,
  );
  useFenceDebugHandle(model);

  const health = useFenceHealth(
    trajectories,
    data?.headers ?? NO_HEADERS,
    rings,
    props.margin,
    props.sharpTurn,
    props.sharpArm,
    props.tolerance,
    props.simplify,
  );
  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        padding: 16,
        background: '#0f1216',
        color: '#e0e0e0',
        font: '12px ui-monospace, monospace',
        minHeight: '100vh',
      }}
    >
      <FencePlanView
        model={model}
        rings={rings}
        size={props.size}
        showSurvey={props.showSurvey}
        showBase={props.showBase}
        showLeft={props.showLeft}
        showRight={props.showRight}
        defectKinds={props.defectKinds}
        focus={props.focus}
        focusRadius={props.focusRadius}
        curvePos={props.curvePos}
        sharpTurn={props.sharpTurn}
        sharpArm={props.sharpArm}
      />
      <div>
        <div style={{ marginBottom: 8, opacity: 0.6 }}>
          {props.wellbore || '(pick a wellbore)'}
        </div>
        <FenceHud model={model} />
        <div style={{ marginTop: 12, opacity: 0.5, lineHeight: 1.6 }}>
          <div>
            <span style={{ color: '#7a7a7a' }}>——</span> survey trace
          </div>
          <div>
            <span style={{ color: '#2ecc71' }}>——</span> spline path
          </div>
          <div>
            <span style={{ color: '#4aa3ff' }}>——</span> Left cut
          </div>
          <div>
            <span style={{ color: '#ff7043' }}>——</span> Right cut
          </div>
          <div>
            <span style={{ color: 'rgba(255,60,60,0.9)' }}>▬</span> burial{' '}
            <span style={{ color: 'rgba(255,160,40,0.9)' }}>▬</span> sharp{' '}
            <span style={{ color: 'rgba(255,110,210,0.9)' }}>▬</span> pinch{' '}
            <span style={{ color: 'rgba(255,220,60,0.9)' }}>▬</span> wiggle
          </div>
          <div>
            <span style={{ color: '#ffffff' }}>⊕</span> wellhead,{' '}
            <span style={{ color: '#b388ff' }}>■</span> TD
          </div>
        </div>
        <label
          style={{
            display: 'block',
            marginTop: 14,
            fontSize: 11,
            opacity: 0.6,
          }}
        >
          copy view — paste back with your note
        </label>
        <textarea
          readOnly
          onFocus={e => e.currentTarget.select()}
          value={`fence-view ${JSON.stringify({
            wellbore: props.wellbore,
            margin: props.margin,
            focus: props.focus,
            curvePos: props.curvePos,
            focusRadius: props.focusRadius,
            showSurvey: props.showSurvey,
            showBase: props.showBase,
            showLeft: props.showLeft,
            showRight: props.showRight,
            defectKinds: props.defectKinds,
            size: props.size,
          })}`}
          style={{
            width: '100%',
            height: 54,
            marginTop: 4,
            font: '11px ui-monospace, monospace',
            background: '#11151b',
            color: '#9fb3c8',
            border: '1px solid #2a3441',
            borderRadius: 4,
            padding: 6,
            boxSizing: 'border-box',
            resize: 'vertical',
          }}
        />
      </div>
      <FenceHealthLists
        health={health}
        selected={props.wellbore}
        onSelect={props.onSelectWellbore ?? (() => {})}
      />
    </div>
  );
};

export default {
  title: 'Debug/Chunk fence',
  component: FenceDebug,
  args: {
    wellbore: 'NO 15/9-F-12',
    margin: 0,
    simplify: 0,
    focus: 'fit',
    focusRadius: 600,
    curvePos: 0.5,
    sharpTurn: 30,
    sharpArm: 10,
    tolerance: 0.1,
    showSurvey: false,
    showBase: true,
    showLeft: true,
    showRight: true,
    size: 520,
    defectKinds: ['burial', 'sharp', 'pinch', 'wiggle'],
  },
  argTypes: {
    wellbore: {
      control: { type: 'select' },
      options: WELLBORES,
      description:
        'Wellbore NAME, as it appears in the headers. ⭐ Cycle through these — a rule that looks right on one well is routinely wrong on the next, and the ends are where they differ.',
      table: { category: 'Fence' },
    },
    margin: {
      control: { type: 'range', min: 0, max: 10, step: 0.5 },
      description:
        'Metres of hard clearance baked into each side. ⭐ Watch the two side curves separate by twice this — the corridor between them is what both views remove, and it is where casings get room to be drawn.',
      table: { category: 'Fence' },
    },
    simplify: {
      control: { type: 'range', min: 0, max: 10, step: 0.5 },
      description:
        'Metres a NON-defect cut vertex may be simplified (chorded) away by. 0 keeps the cut hugging every real bend and only bridges defects (loops, zig-zags, pinches); larger coarsens the smooth stretches too. A longer segment only ever leaves a LARGER clearance gap, never a smaller one.',
      table: { category: 'Fence' },
    },
    focus: {
      control: { type: 'inline-radio' },
      options: ['fit', 'wellbore', 'head', 'td', 'curvepos'],
      description:
        'What to frame. `fit` shows the WHOLE fence including its run-outs; `wellbore` fits just the trajectory (run-outs off-screen) for tuning the path; `head`/`td` centre on the ends; `curvepos` centres on an EXACT position along the spline set by `curvePos`. `head`/`td`/`curvepos` use `focusRadius` for the zoom window.',
      table: { category: 'View' },
    },
    focusRadius: {
      control: { type: 'range', min: 1, max: 3000, step: 1 },
      description:
        'Half the width of the framed window, in metres. Ignored when focus is `fit` or `wellbore`.',
      table: { category: 'View' },
    },
    curvePos: {
      control: { type: 'range', min: 0, max: 1, step: 0.001 },
      description:
        'Position along the spline to centre on when focus is `curvepos`: 0 = wellhead, 1 = TD. Read off the 3D interpolator, so e.g. 0.042 lands exactly on that point of the curve.',
      table: { category: 'View' },
    },
    showSurvey: {
      description: 'The raw projected trajectory (survey stations).',
      table: { category: 'View' },
    },
    showBase: {
      description: 'The dense, simplified spline path the fence follows.',
      table: { category: 'View' },
    },
    showLeft: {
      description:
        'The LEFT cut — the half to the left of the well’s tangent (head→TD). Blue.',
      table: { category: 'View' },
    },
    showRight: {
      description:
        'The RIGHT cut — the half to the right of the tangent. Orange.',
      table: { category: 'View' },
    },
    size: {
      control: { type: 'range', min: 320, max: 900, step: 20 },
      table: { category: 'View' },
    },
    defectKinds: {
      control: { type: 'check' },
      options: ['burial', 'sharp', 'pinch', 'wiggle'],
      description:
        'Which defect classes to overlay — toggle each on/off to isolate one class. burial (red) sits on the WELL wherever the cut leaves it buried; sharp (orange) / pinch (pink) / wiggle (yellow) sit on the offending cut corner.',
      table: { category: 'Defects' },
    },
    sharpTurn: {
      control: { type: 'range', min: 5, max: 90, step: 1 },
      description:
        'Sharp-edge threshold: the RELATIVE turn (DEGREES) between two segments that counts as a sharp edge at the reference arm length `sharpArm`. The turn is weighted by the LONGER arm, so a hard angle between long straights flags while the same angle between short segments (a densely sampled curve) does not. A 90° relative turn is always flagged. Recomputed live. Cut = orange, spline doglegs = cyan.',
      table: { category: 'Defects' },
    },
    sharpArm: {
      control: { type: 'range', min: 2, max: 60, step: 1 },
      description:
        'Arm length (metres) each side is CAPPED at for the sharp-edge test, then the two capped arms are averaged. Caps a very long straight (a run-out) so a slight turn on it is not an edge, and needs length on BOTH sides. LARGER = stricter (turns need longer arms or a bigger angle); SMALLER flags slighter turns.',
      table: { category: 'Defects' },
    },
    tolerance: {
      control: { type: 'range', min: 0, max: 2, step: 0.01 },
      description:
        'Render-radius slack, in metres, used for BOTH construction and diagnostics. The cut is built to clear the well by `margin − tolerance`, and the well counts as BURIED — highlighted, and a problem in the lists — wherever it comes closer than that. Larger = more slack. The same value the burial highlight and the health split use.',
      table: { category: 'Defects' },
    },
    onSelectWellbore: { table: { disable: true }, control: false },
  },
} satisfies Meta<typeof FenceDebug>;

export const Default: StoryObj<typeof FenceDebug> = {
  render: args => {
    const [, updateArgs] = useArgs();
    return (
      <FenceDebug
        {...args}
        onSelectWellbore={name => updateArgs({ wellbore: name })}
      />
    );
  },
};
