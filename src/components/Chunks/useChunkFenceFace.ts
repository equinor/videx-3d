import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  buildFenceRibbons,
  FenceRibbon,
  FenceSideName,
  fenceSideSign,
  StackSectionSource,
} from '../../sdk';
import { ChunkFenceState, ChunkLayer } from './chunk-defs';
import { ChunkSectionFace } from './useChunkSection';

/** One side's faces, and what they were built from. */
type SideFaces = {
  source: unknown;
  curve: unknown;
  inside: unknown;
  offset: number;
  gaps: boolean;
  voids: boolean;
  faces: ChunkSectionFace[] | null;
};

const disposeFaces = (faces: ChunkSectionFace[] | null) =>
  faces?.forEach(face => face.geometry.dispose());

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
 * ⭐ Each SIDE keeps the faces it last built, so a swap back — which `auto` does
 * whenever the camera crosses the cut — reuses them instead of rebuilding.
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
  const sideFaces = useRef(new Map<FenceSideName, SideFaces>());
  const retired = useRef<(ChunkSectionFace[] | null)[]>([]);

  const last = useRef<{
    source: unknown;
    curve: unknown;
    inside: unknown;
    side: FenceSideName | null;
    offset: number;
    gaps: boolean;
    voids: boolean;
    on: boolean;
  }>({
    source: null,
    curve: null,
    inside: null,
    side: null,
    offset: NaN,
    gaps: false,
    voids: false,
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
        sideFaces.current.forEach(entry => retired.current.push(entry.faces));
        sideFaces.current.clear();
        setFaces(null);
      }
      return;
    }
    if (
      state.on &&
      state.source === source &&
      state.curve === fence.curve &&
      state.inside === fence.inside &&
      state.side === fence.side &&
      state.offset === fence.offset &&
      state.gaps === fence.gaps &&
      state.voids === fence.voids
    ) {
      return;
    }
    state.on = true;
    state.source = source;
    state.curve = fence.curve;
    state.inside = fence.inside;
    state.side = fence.side;
    state.offset = fence.offset;
    state.gaps = fence.gaps;
    state.voids = fence.voids;

    // Anything but the side and its curve invalidates BOTH sides.
    for (const [side, entry] of sideFaces.current) {
      if (
        entry.source !== source ||
        entry.inside !== fence.inside ||
        entry.offset !== fence.offset ||
        entry.gaps !== fence.gaps ||
        entry.voids !== fence.voids
      ) {
        retired.current.push(entry.faces);
        sideFaces.current.delete(side);
      }
    }
    const kept = sideFaces.current.get(fence.side);
    if (kept && kept.curve === fence.curve) {
      setFaces(kept.faces);
      return;
    }
    if (kept) retired.current.push(kept.faces);

    // The face looks INTO the half being removed. `side` names that half; the ribbon
    // builds from the same normal, so the flip is just the side's own sign.
    const ribbons: FenceRibbon[] = buildFenceRibbons(source!, fence.curve!, {
      alongOffset: fence.alongOffset,
      offset: fence.offset,
      flip: fenceSideSign(fence.side) < 0,
      inside: fence.inside ?? undefined,
      gaps: fence.gaps,
      voids: fence.voids,
    });

    const built: ChunkSectionFace[] = [];
    for (const ribbon of ribbons) {
      const layer = source!.layers?.[ribbon.interval] ?? ribbon.interval;
      // A gap holds no unit, so there is nothing for `section: false` to keep whole.
      if (!ribbon.gap && layers?.[layer]?.section === false) {
        ribbon.geometry.dispose();
        continue;
      }
      built.push({
        interval: ribbon.interval,
        layer,
        wall: built.length,
        geometry: ribbon.geometry,
        gap: ribbon.gap,
      });
    }
    const next = built.length > 0 ? built : null;
    sideFaces.current.set(fence.side, {
      source,
      curve: fence.curve,
      inside: fence.inside,
      offset: fence.offset,
      gaps: fence.gaps,
      voids: fence.voids,
      faces: next,
    });
    setFaces(next);
  });

  // Retired faces may be on screen until the state that replaced them commits.
  useEffect(() => {
    retired.current.splice(0).forEach(disposeFaces);
  }, [faces]);

  useEffect(() => {
    const cache = sideFaces.current;
    const queue = retired.current;
    return () => {
      cache.forEach(entry => disposeFaces(entry.faces));
      cache.clear();
      queue.splice(0).forEach(disposeFaces);
    };
  }, []);

  return faces;
}
