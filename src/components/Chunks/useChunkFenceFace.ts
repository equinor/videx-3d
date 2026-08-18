import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { buildFenceRibbons, FenceRibbon, StackSectionSource } from '../../sdk';
import { ChunkFenceState, ChunkLayer } from './chunk-defs';
import { ChunkSectionFace } from './useChunkSection';

/**
 * Build a chunk's cut faces along a **fence**, as ribbons following the curve.
 *
 * ⭐⭐ The face IS the fence curve, swept vertically. The curve was already offset
 * by the caller's clearance and is the zero set of the field the shader cuts by, so
 * the drawn face and the removed block agree by construction — there is nothing to
 * contour, root-find or reconcile here.
 *
 * ⭐ The curve comes from the STACK, not from this chunk. It is identical for every
 * chunk, and only the heights differ; all this does is drape it over the chunk's own
 * tessellation.
 *
 * ⚠️ Rebuilt from the FRAME loop, because the fence state is a stable object whose
 * contents are swapped in place (so that changing wellbore does not re-render every
 * chunk). The rebuild publishes through state, which costs one render per change —
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
    curve: unknown;
    side: number;
    offset: number;
    on: boolean;
  }>({
    source: null,
    curve: null,
    side: NaN,
    offset: NaN,
    on: false,
  });

  useFrame(() => {
    const state = last.current;
    const off = !source || !fence || !fence.enabled || !fence.curve;
    if (off) {
      if (state.on || state.source !== source) {
        state.on = false;
        state.source = source;
        state.curve = null;
        setFaces(null);
      }
      return;
    }
    if (
      state.on &&
      state.source === source &&
      state.curve === fence.curve &&
      state.side === fence.side &&
      state.offset === fence.offset
    ) {
      return;
    }
    state.on = true;
    state.source = source;
    state.curve = fence.curve;
    state.side = fence.side;
    state.offset = fence.offset;

    // The face looks INTO the half being removed. `side` names that half relative
    // to the curve's left normal, which is the same normal the ribbon builds from.
    const ribbons: FenceRibbon[] = buildFenceRibbons(source!, fence.curve!, {
      alongOffset: fence.alongOffset,
      offset: fence.offset,
      flip: fence.side < 0,
    });

    const built: ChunkSectionFace[] = [];
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
    setFaces(built.length > 0 ? built : null);
  });

  useEffect(() => {
    return () => faces?.forEach(face => face.geometry.dispose());
  }, [faces]);

  return faces;
}
