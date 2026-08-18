import { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import { createWellboreOutline, Vec2, Vec3 } from '../../../sdk';
import { CRS, getProjectionDefFromUtmZone } from '../../../sdk/projection/crs';
import storyArgs from '../../../storybook/story-args.json';
import {
  debugOutlineRings,
  FenceFocus,
  FenceHud,
  FencePlanView,
  useFenceDebugHandle,
  useFenceDebugModel,
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
  maxTurn: number;
  headTurn: number;
  turnWindow: number;
  focus: FenceFocus;
  focusRadius: number;
  showTrace: boolean;
  showBase: boolean;
  showSides: boolean;
  size: number;
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

  const model = useFenceDebugModel(selected, rings, props.margin, {
    maxTurn: props.maxTurn,
    headTurn: props.headTurn,
    turnWindow: props.turnWindow,
  });
  useFenceDebugHandle(model);

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
        showTrace={props.showTrace}
        showBase={props.showBase}
        showSides={props.showSides}
        focus={props.focus}
        focusRadius={props.focusRadius}
      />
      <div>
        <div style={{ marginBottom: 8, opacity: 0.6 }}>
          {props.wellbore || '(pick a wellbore)'}
        </div>
        <FenceHud model={model} />
        <div style={{ marginTop: 12, opacity: 0.5, lineHeight: 1.6 }}>
          <div>
            <span style={{ color: '#7a7a7a' }}>——</span> raw plan trace
          </div>
          <div>
            <span style={{ color: '#2ecc71' }}>——</span> straightened base curve
          </div>
          <div>
            <span style={{ color: '#4aa3ff' }}>——</span> side +1 cut
          </div>
          <div>
            <span style={{ color: '#ff7043' }}>——</span> side −1 cut
          </div>
          <div>
            <span style={{ color: '#ffd54f' }}>- -</span> run-outs
          </div>
          <div>
            <span style={{ color: '#ffffff' }}>⊕</span> wellhead,{' '}
            <span style={{ color: '#b388ff' }}>■</span> TD
          </div>
        </div>
      </div>
    </div>
  );
};

export default {
  title: 'Debug/Chunk fence',
  component: FenceDebug,
  args: {
    wellbore: 'NO 15/9-F-12',
    margin: 0,
    maxTurn: 60,
    headTurn: 25,
    turnWindow: 300,
    focus: 'fit',
    focusRadius: 600,
    showTrace: true,
    showBase: true,
    showSides: true,
    size: 520,
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
      control: { type: 'range', min: 0, max: 300, step: 5 },
      description:
        'Metres of clearance baked into each side. ⭐ Watch the two side curves separate by twice this — the corridor between them is what both views remove, and it is where casings get room to be drawn.',
      table: { category: 'Fence' },
    },
    maxTurn: {
      control: { type: 'range', min: 10, max: 85, step: 5 },
      description:
        'Degrees the cut may turn within the window at TD. ⭐⭐ Measured over a WINDOW, not between neighbouring segments — a curve turning a few degrees per step for twenty steps passes every per-vertex test and is a near loop, which is what tears the swept face. Anything over budget is cut straight through. ⚠️ Never take this to 90: at a right angle the two faces of the turn are looking at each other.',
      table: { category: 'Angles' },
    },
    headTurn: {
      control: { type: 'range', min: 5, max: 85, step: 5 },
      description:
        'The same budget at the WELLHEAD. ⭐⭐ Deliberately tighter than at TD: near TD the trajectory genuinely bends and the cut has to hug it, while at the head there is nothing to follow but survey scatter and every degree spent there buys a fold. The budget is interpolated between the two by position along the well.',
      table: { category: 'Angles' },
    },
    turnWindow: {
      control: { type: 'range', min: 50, max: 1000, step: 25 },
      description:
        'Metres of arc the turn budget is accumulated over. ⭐ This is the “how far ahead does it look” dial: short sees only local kinks, long treats a wide sweeping bend as one turn.',
      table: { category: 'Angles' },
    },
    focus: {
      control: { type: 'inline-radio' },
      options: ['fit', 'head', 'td'],
      description:
        'What to frame. ⭐⭐ The ENDS are where the run-out joins, and a whole-fence view flattens the junction into a couple of pixels — burial at the head is the failure a viewer notices and it is invisible in an aggregate. The scale bar is the reference for judging it.',
      table: { category: 'View' },
    },
    focusRadius: {
      control: { type: 'range', min: 100, max: 3000, step: 50 },
      description:
        'Half the width of the framed window, in metres. Ignored when focus is `fit`.',
      table: { category: 'View' },
    },
    showTrace: {
      description: 'The raw projected trajectory, before straightening.',
      table: { category: 'View' },
    },
    showBase: {
      description: 'The straightened curve both sides are built from.',
      table: { category: 'View' },
    },
    showSides: {
      description: 'Each side’s finished cut curve.',
      table: { category: 'View' },
    },
    size: {
      control: { type: 'range', min: 320, max: 900, step: 20 },
      table: { category: 'View' },
    },
  },
} satisfies Meta<typeof FenceDebug>;

export const Default: StoryObj<typeof FenceDebug> = {};
