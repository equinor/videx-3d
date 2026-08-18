import { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import { CRS, getProjectionDefFromUtmZone } from '../../../sdk/projection/crs';
import { createWellboreOutline, Vec2, Vec3 } from '../../../sdk';
import storyArgs from '../../../storybook/story-args.json';
import {
  debugOutlineRings,
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

  const model = useFenceDebugModel(selected, rings, props.margin);
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
    showTrace: true,
    showBase: true,
    showSides: true,
    size: 520,
  },
  argTypes: {
    wellbore: {
      control: { type: 'text' },
      description: 'Wellbore NAME, as it appears in the headers.',
    },
    margin: {
      control: { type: 'range', min: 0, max: 300, step: 5 },
      description:
        'Metres of clearance baked into each side. ⭐ Watch the two side curves separate by twice this — the corridor between them is what both views remove, and it is where casings get room to be drawn.',
    },
    showTrace: {
      description: 'The raw projected trajectory, before straightening.',
    },
    showBase: {
      description: 'The straightened curve both sides are built from.',
    },
    showSides: { description: 'Each side’s finished cut curve.' },
    size: { control: { type: 'range', min: 320, max: 900, step: 20 } },
  },
} satisfies Meta<typeof FenceDebug>;

export const Default: StoryObj<typeof FenceDebug> = {};
