import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  buildFenceRibbons,
  fenceContour,
  FenceRibbon,
  StackSectionSource,
  Vec2,
} from '../../sdk';
import { ChunkFenceState, ChunkLayer } from './chunk-defs';
import { ChunkSectionFace } from './useChunkSection';

/**
 * Build a chunk's cut faces along a **fence**, as ribbons following the curve.
 *
 * ⭐⭐ The face is built from the CURVE, not from the tessellation's cells. Cutting
 * cells makes the face inherit the TIN's resolution — tens of metres on a
 * field-sized stack — and worse, it systematically pulls the face toward the well
 * wherever the trajectory bends, because a distance field is convex there and
 * interpolating it linearly across a triangle overestimates it. A ribbon is
 * sampled at whatever spacing is asked for and takes only its HEIGHTS from the
 * tessellation, so it meets the caps exactly while following the well smoothly.
 *
 * ⚠️ Rebuilt from the FRAME loop, because the fence state is a stable object whose
 * sampler is swapped in place (so that changing wellbore does not re-render every
 * chunk). The rebuild publishes through state, which costs one render per fence —
 * not per frame.
 *
 * @param source the chunk's section channels, from its build
 * @param fence the stack's live fence, or `null` for none
 * @param layers the caller's layers, read for `ChunkLayer.section`
 *
 * @group Components
 */
export function useChunkFenceFace(
  source: StackSectionSource | undefined,
  fence: ChunkFenceState | null | undefined,
  layers?: ChunkLayer[],
): ChunkSectionFace[] | null {
  const [faces, setFaces] = useState<ChunkSectionFace[] | null>(null);

  const last = useRef<{
    source: unknown;
    sample: unknown;
    width: number;
    side: number;
    resolution: number;
    offset: number;
    taper: unknown;
    on: boolean;
  }>({
    source: null,
    sample: null,
    width: NaN,
    side: NaN,
    resolution: NaN,
    offset: NaN,
    taper: undefined,
    on: false,
  });

  useFrame(() => {
    const state = last.current;
    const off = !source || !fence || !fence.enabled || !fence.field;
    if (off) {
      if (state.on || state.source !== source) {
        state.on = false;
        state.source = source;
        state.sample = null;
        setFaces(null);
      }
      return;
    }
    if (
      state.on &&
      state.source === source &&
      state.sample === fence.sample &&
      state.width === fence.width &&
      state.side === fence.side &&
      state.resolution === fence.resolution &&
      state.offset === fence.offset &&
      state.taper === fence.taper
    ) {
      return;
    }
    state.on = true;
    state.source = source;
    state.sample = fence.sample;
    state.width = fence.width;
    state.side = fence.side;
    state.resolution = fence.resolution;
    state.offset = fence.offset;
    state.taper = fence.taper;

    const chains = fenceContour(fence.field!, {
      width: fence.width,
      side: fence.side,
      resolution: fence.resolution,
      taper: fence.taper,
    });

    const built: ChunkSectionFace[] = [];
    for (const chain of chains) {
      if (chain.length < 2) continue;
      // Which way the face looks, decided ONCE per chain from the field itself:
      // stepping off the curve must lower `side * s` to be heading into what the
      // fence removed. Per vertex it could flip on noise; per chain it cannot.
      const mid = chain[chain.length >> 1] as Vec2;
      const prev = chain[Math.max(0, (chain.length >> 1) - 1)];
      const tx = mid[0] - prev[0];
      const tz = mid[1] - prev[1];
      const len = Math.hypot(tx, tz) || 1;
      const probe = Math.max(fence.resolution, 1);
      const nx = (-tz / len) * probe;
      const nz = (tx / len) * probe;
      const outward: boolean =
        fence.side * fence.sample(mid[0] + nx, mid[1] + nz) <
        fence.side * fence.sample(mid[0] - nx, mid[1] - nz);

      const ribbons: FenceRibbon[] = buildFenceRibbons(source!, chain, {
        along: fence.sampleAlong,
        offset: fence.offset,
        flip: !outward,
      });
      for (const ribbon of ribbons) {
        const layer = source!.layers?.[ribbon.interval] ?? ribbon.interval;
        if (layers?.[layer]?.section === false) {
          ribbon.geometry.dispose();
          continue;
        }
        built.push({
          interval: ribbon.interval,
          layer,
          wall: built.length,
          geometry: ribbon.geometry,
        });
      }
    }
    setFaces(built.length > 0 ? built : null);
  });

  useEffect(() => {
    return () => faces?.forEach(face => face.geometry.dispose());
  }, [faces]);

  return faces;
}
