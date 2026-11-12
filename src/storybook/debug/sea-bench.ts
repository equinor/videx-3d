// oxlint-disable eslint/no-await-in-loop -- a measurement waits for each timing before the next: one GPU timer is open at a time, and draws timed together would time each other
import { useThree, type RootState } from '@react-three/fiber';
import { useEffect } from 'react';
import type { Material, Mesh, Object3D } from 'three';
import type { CameraManager } from '../../sdk/managers/CameraManager';
import {
  gpuName,
  hookedWebGL,
  indicate,
  median,
  nextFrame,
  round2,
  sleep,
} from './bench-common';
import { profileFrames } from './profile';
import { getStoryArgs, registerVidex3d, setStoryArgs } from './videx3d';

/**
 * Timing the sea on the GPU, from the browser console: `window.videx3d.seaBench` in a story
 * that renders `<SeaBenchBridge />` (the `debug/Ocean/Sea Bench` story). Storybook only.
 *
 * Each draw of the sea is timed apart, in the frame as it runs (`profileFrames`' groups):
 * the stand-alone `Ocean`'s surface, water body and bed; a `SceneryStage`'s surface and
 * seabed; the `Scenery` background's layers. Their sum is `sea`.
 *
 * - {@link SeaBench.frames}: the frame and each sea draw, from the pose as it is.
 * - {@link SeaBench.tour}: {@link SEA_POSES} in turn, rounds interleaved.
 * - {@link SeaBench.ab}: story args against the current ones, interleaved A/B rounds.
 *
 * Every result carries the {@link SeaBenchConditions} it was measured under: compare only
 * results whose conditions match. ⚠️ One GPU timer at a time: no other profiler open
 * meanwhile. documents/ocean.md, "Measuring".
 */
export type SeaBench = {
  conditions: () => SeaBenchConditions;
  /** the poses the story's scene draws water across */
  poses: () => SeaPoseName[];
  /** the camera to a pose of {@link SEA_POSES}, landed in one frame */
  pose: (name: SeaPoseName) => Promise<void>;
  frames: (options?: SeaFramesOptions) => Promise<SeaFramesResult>;
  tour: (options?: SeaTourOptions) => Promise<SeaTourResult>;
  ab: (
    variants: Record<string, Record<string, unknown>>,
    options?: SeaAbOptions,
  ) => Promise<SeaAbResult>;
  /** hold the render loop `seconds` (a laptop's GPU cools, its clock settles) */
  hold: (seconds: number) => Promise<void>;
};

/**
 * The bench's poses: the camera orbiting a point on the sea at the scene's origin, looking
 * south (toward +Z, the sun's side by day in the north), `polar` degrees from straight down
 * and `distance` metres from it, so its height is about `distance × cos(polar)`.
 */
export const SEA_POSES = {
  '2m': { polar: 88.85, distance: 100 },
  '30m': { polar: 84.26, distance: 300 },
  '300m': { polar: 73, distance: 1026 },
  '2km': { polar: 60, distance: 4000 },
  '20km': { polar: 60, distance: 40000 },
  '100km': { polar: 45, distance: 141421 },
  '1000km': { polar: 30, distance: 1154700 },
  down: { polar: 2, distance: 2000 },
} as const;

export type SeaPoseName = keyof typeof SEA_POSES;

/** The azimuth every pose is seen from (degrees from +X toward +Z): from the north. */
export const SEA_POSE_AZIMUTH = -90;

/** What a timing depends on besides the code: compare results only where these match. */
export type SeaBenchConditions = {
  /** the canvas, CSS pixels */
  viewport: [number, number];
  pixelRatio: number;
  drawingBuffer: [number, number];
  pose: ReturnType<CameraManager['pose']> | null;
  /** the story's args: its scene, sea and weather */
  args: Record<string, unknown> | null;
  gpu: string;
  /** WebGL methods something has wrapped (a leftover hook): CPU timings are off while any is */
  hookedWebGL: string[];
};

export type SeaFramesOptions = {
  /** frames timed in each of the two passes (the whole frame, then the draws) */
  frames?: number;
  /** frames run before each pass */
  warmup?: number;
};

/** GPU ms, medians over the frames. */
export type SeaTimes = {
  /** the whole frame */
  frame: number;
  /** main-thread ms of the frame */
  cpu: number;
  /** every sea draw's */
  sea: number;
  /** each draw group's ({@link SEA_GROUPS}), those that drew */
  draws: Partial<Record<SeaGroup, number>>;
};

export type SeaFramesResult = SeaTimes & { conditions: SeaBenchConditions };

export type SeaTourOptions = SeaFramesOptions & {
  /** the poses, in order; default every one the scene draws water across */
  poses?: SeaPoseName[];
  /** rounds through all the poses */
  rounds?: number;
  /** seconds the render loop is held first, so every run starts from the same clock */
  hold?: number;
};

export type SeaTourResult = {
  conditions: SeaBenchConditions;
  /** per pose: the medians of its rounds, and `spread`, the sea's highest round over its lowest */
  poses: Partial<Record<SeaPoseName, SeaTimes & { spread: number }>>;
};

export type SeaAbOptions = SeaFramesOptions & {
  /** the pose to time from; default as it is */
  pose?: SeaPoseName;
  rounds?: number;
  /** ms waited after args change and the scene has compiled, before timing */
  settle?: number;
};

export type SeaAbResult = {
  conditions: SeaBenchConditions;
  /** the args put back after */
  base: Record<string, unknown>;
  /** per variant: the sea's ms with the base args and with its own (medians of interleaved
   * rounds), the median of the rounds' ratios, and each draw group's ratio */
  variants: Record<
    string,
    {
      base: number;
      variant: number;
      ratio: number;
      draws: Partial<Record<SeaGroup, number>>;
      rounds: [number, number][];
    }
  >;
};

const materialOf = (object: Object3D): Material | null => {
  const material = (object as Mesh).material;
  return Array.isArray(material) ? (material[0] ?? null) : (material ?? null);
};

const flagged = (object: Object3D, flag: string) =>
  !!(materialOf(object) as unknown as Record<string, unknown> | null)?.[flag];

const defined = (object: Object3D, define: string) => {
  const defines = (materialOf(object) as { defines?: Record<string, unknown> })
    ?.defines;
  return !!defines && define in defines;
};

const named = (object: Object3D, name: string) =>
  materialOf(object)?.name === name;

/**
 * The draws the bench times apart, the first that matches winning. All but `sky` (the
 * background's sky and void, kept to tell the GPU's clock by) are the sea's.
 */
export const SEA_GROUPS = {
  ocean: (o: Object3D) => flagged(o, 'isOceanMaterial'),
  oceanBody: (o: Object3D) => flagged(o, 'isOceanVolumeMaterial'),
  oceanBed: (o: Object3D) => flagged(o, 'isOceanBedMaterial'),
  stageSurface: (o: Object3D) => defined(o, 'STAGE_SURFACE'),
  stageBed: (o: Object3D) => defined(o, 'STAGE_BED'),
  bgSurface: (o: Object3D) => named(o, 'scenery-surface'),
  bgSea: (o: Object3D) => named(o, 'scenery-sea'),
  bgWater: (o: Object3D) => named(o, 'scenery-water'),
  sky: (o: Object3D) =>
    named(o, 'scenery-sky') ||
    named(o, 'scenery-abyss') ||
    (materialOf(o)?.name ?? '').startsWith('scenery-hollow'),
};

export type SeaGroup = keyof typeof SEA_GROUPS;

const SEA_PARTS = (Object.keys(SEA_GROUPS) as SeaGroup[]).filter(
  name => name !== 'sky',
);

/**
 * The bench for the sea drawn in `get().scene`: `get` the canvas's state (`useThree`'s `get`),
 * `manager` its camera's, `poses` those the story's scene draws water across.
 */
export function createSeaBench(
  get: () => RootState,
  manager: () => CameraManager | undefined,
  poses: SeaPoseName[],
): SeaBench {
  let busy = false;

  const conditions = (): SeaBenchConditions => {
    const gl = get().gl;
    const ctx = gl.getContext() as WebGL2RenderingContext;
    const canvas = gl.domElement;
    return {
      viewport: [canvas.clientWidth, canvas.clientHeight],
      pixelRatio: gl.getPixelRatio(),
      drawingBuffer: [ctx.drawingBufferWidth, ctx.drawingBufferHeight],
      pose: manager()?.pose() ?? null,
      args: getStoryArgs(),
      gpu: gpuName(ctx),
      hookedWebGL: hookedWebGL(),
    };
  };

  // Run `work` alone, the dot red meanwhile; with `held`, the render loop stopped.
  const exclusive = async <T>(held: boolean, work: () => Promise<T>) => {
    if (busy) throw new Error('the sea bench is already measuring');
    busy = true;
    indicate(true);
    const state = get();
    const loop = state.frameloop;
    try {
      if (held) state.setFrameloop('never');
      const hooked = hookedWebGL();
      if (hooked.length > 0)
        console.warn(
          `sea bench: WebGL methods wrapped by something (${hooked.join(', ')}): CPU timings are not to be trusted`,
        );
      return await work();
    } finally {
      if (held) state.setFrameloop(loop);
      busy = false;
      indicate(false);
    }
  };

  // Until no stand-in is drawn in the sky's place (a Scenery compiling), three checks running.
  const compiled = async (timeout = 180000) => {
    const deadline = performance.now() + timeout;
    let steady = 0;
    while (steady < 3 && performance.now() < deadline) {
      let standIn = false;
      get().scene.traverse(object => {
        if (object.visible && named(object, 'scenery-stand-in')) standIn = true;
      });
      steady = standIn ? 0 : steady + 1;
      await sleep(250);
    }
  };

  const pose = async (name: SeaPoseName) => {
    const camera = manager();
    if (!camera) throw new Error('no camera controls yet');
    await camera.orbit({
      ...SEA_POSES[name],
      azimuth: SEA_POSE_AZIMUTH,
      target: [0, 0, 0],
      transition: false,
    });
    // Landed in one frame; one more so the frame drawn is the pose's.
    await nextFrame();
    await nextFrame();
  };

  const measure = async (options: SeaFramesOptions = {}): Promise<SeaTimes> => {
    const { gl, scene } = get();
    const result = await profileFrames(gl, scene, {
      frames: options.frames ?? 90,
      warmup: options.warmup ?? 30,
      groups: SEA_GROUPS,
    });
    const draws: SeaTimes['draws'] = {};
    for (const [name, group] of Object.entries(result.groups))
      if (group.gpu && group.draws > 0)
        draws[name as SeaGroup] = round2(group.gpu.median);
    const sea = SEA_PARTS.reduce((sum, name) => sum + (draws[name] ?? 0), 0);
    return {
      frame: round2(result.gpu?.median ?? 0),
      cpu: round2(result.cpu?.median ?? 0),
      sea: round2(sea),
      draws,
    };
  };

  const frames = (options?: SeaFramesOptions) =>
    exclusive(false, async () => ({
      ...(await measure(options)),
      conditions: conditions(),
    }));

  const tour = (options: SeaTourOptions = {}) =>
    exclusive(false, async () => {
      const names = options.poses ?? poses;
      if (options.hold) {
        const state = get();
        const loop = state.frameloop;
        state.setFrameloop('never');
        await sleep(options.hold * 1000);
        state.setFrameloop(loop);
      }
      const runs: Partial<Record<SeaPoseName, SeaTimes[]>> = {};
      for (let round = 0; round < (options.rounds ?? 2); round++)
        for (const name of names) {
          await pose(name);
          (runs[name] ??= []).push(await measure(options));
        }
      const out: SeaTourResult['poses'] = {};
      for (const [name, times] of Object.entries(runs) as [
        SeaPoseName,
        SeaTimes[],
      ][]) {
        const groups = new Set(times.flatMap(t => Object.keys(t.draws)));
        const draws: SeaTimes['draws'] = {};
        for (const group of groups)
          draws[group as SeaGroup] = round2(
            median(times.map(t => t.draws[group as SeaGroup] ?? 0)),
          );
        const seas = times.map(t => t.sea);
        out[name] = {
          frame: round2(median(times.map(t => t.frame))),
          cpu: round2(median(times.map(t => t.cpu))),
          sea: round2(median(seas)),
          draws,
          spread: round2(Math.max(...seas) / Math.max(Math.min(...seas), 1e-6)),
        };
      }
      return { conditions: conditions(), poses: out };
    });

  const ab = (
    variants: Record<string, Record<string, unknown>>,
    options: SeaAbOptions = {},
  ) =>
    exclusive(false, async () => {
      const current = getStoryArgs() ?? {};
      const keys = new Set(Object.values(variants).flatMap(Object.keys));
      const base: Record<string, unknown> = {};
      for (const key of keys) base[key] = current[key];
      const settle = options.settle ?? 2500;
      const apply = async (args: Record<string, unknown>) => {
        await setStoryArgs(args);
        await compiled();
        await sleep(settle);
      };
      if (options.pose) await pose(options.pose);
      const out: SeaAbResult['variants'] = {};
      try {
        for (const [label, args] of Object.entries(variants)) {
          const pairs: [SeaTimes, SeaTimes][] = [];
          for (let round = 0; round < (options.rounds ?? 3); round++) {
            await apply(base);
            const a = await measure(options);
            await apply({ ...base, ...args });
            const b = await measure(options);
            pairs.push([a, b]);
          }
          const ratio = (pick: (t: SeaTimes) => number | undefined) =>
            round2(
              median(
                pairs
                  .filter(([a]) => (pick(a) ?? 0) > 0)
                  .map(([a, b]) => (pick(b) ?? 0) / (pick(a) as number)),
              ),
            );
          const groups = new Set(
            pairs.flatMap(([a, b]) => [
              ...Object.keys(a.draws),
              ...Object.keys(b.draws),
            ]),
          ) as Set<SeaGroup>;
          const draws: Partial<Record<SeaGroup, number>> = {};
          for (const group of groups) draws[group] = ratio(t => t.draws[group]);
          out[label] = {
            base: round2(median(pairs.map(([a]) => a.sea))),
            variant: round2(median(pairs.map(([, b]) => b.sea))),
            ratio: ratio(t => t.sea),
            draws,
            rounds: pairs.map(([a, b]) => [a.sea, b.sea]),
          };
        }
      } finally {
        await apply(base);
      }
      return { conditions: conditions(), base, variants: out };
    });

  const hold = (seconds: number) =>
    exclusive(true, () => sleep(seconds * 1000));

  return {
    conditions,
    poses: () => [...poses],
    pose,
    frames,
    tour,
    ab,
    hold,
  };
}

/**
 * Publishes {@link SeaBench} as `window.videx3d.seaBench` for the sea in this canvas. Render it
 * inside the canvas, with the poses the story's scene draws water across.
 */
export const SeaBenchBridge = ({ poses }: { poses: SeaPoseName[] }) => {
  const get = useThree(state => state.get);
  const key = poses.join(',');
  useEffect(
    () =>
      registerVidex3d({
        seaBench: createSeaBench(
          get,
          () => window.videx3d?.camera as CameraManager | undefined,
          key.split(',') as SeaPoseName[],
        ),
      }),
    [get, key],
  );
  return null;
};
