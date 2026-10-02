import { useEffect, useMemo, useRef, useState } from 'react';
import { colorRampPalette } from '../../common/color-ramps';
import { createSeismicTexture } from '../../common/seismic-texture';
import { useData } from '../../hooks/useData';
import {
  FIELD_COLUMN_SEISMIC_SECTION,
  FieldColumnSeismicSection,
  FieldColumnSeismicSectionQuery,
  FencePathSamples,
  FenceSideName,
  sampleFencePath,
  Vec2,
  WellboreFence,
} from '../../sdk';
import {
  ChunkFenceOverlay,
  FenceOverlayTexture,
  FenceSideInfo,
} from './chunk-defs';

/** Default {@link FenceSeismicOverlayOptions.step}, in metres. @group Components */
export const DEFAULT_FENCE_SEISMIC_STEP = 5;

/** Default {@link FenceSeismicOverlayOptions.delay}, in milliseconds. @group Components */
export const DEFAULT_FENCE_SEISMIC_DELAY = 250;

/** {@link useFenceSeismicOverlay} options. @group Components */
export type FenceSeismicOverlayOptions = {
  /**
   * Metres between seismic columns along the cut. Default {@link DEFAULT_FENCE_SEISMIC_STEP}.
   * Changing it reloads. ⚠️ Widened if the cut would need more than `maxColumns`.
   */
  step?: number;
  /**
   * Milliseconds the fence and side must settle before querying. Default
   * {@link DEFAULT_FENCE_SEISMIC_DELAY}. A newer request cancels a waiting one, and a superseded
   * response is dropped.
   */
  delay?: number;
  /** built-in colour ramp, as `WellboreSeismicSection`'s. Default 6 (seismic). Free to change. */
  colorRampIndex?: number;
  /** widen (+) or narrow (-) the colour range, as a fraction of the largest amplitude. Default 0. Free to change. */
  rangeOffset?: number;
  /** most columns per side, i.e. the texture's width. Default 4096. */
  maxColumns?: number;
};

/** What {@link useFenceSeismicOverlay} returns: a `ChunkFenceOverlay` short of its look. */
export type FenceSeismicOverlay = Pick<
  ChunkFenceOverlay,
  'left' | 'right' | 'palette' | 'range'
>;

type Loaded = {
  fence: WellboreFence;
  step: number;
  sides: Partial<Record<FenceSideName, FenceOverlayTexture>>;
};

const NONE: Loaded['sides'] = {};

/** Placed half a sample past the outermost samples, so texel centres land on them. */
function toOverlayTexture(
  section: FieldColumnSeismicSection,
  path: FencePathSamples,
): FenceOverlayTexture | null {
  const [columns, rows] = section.samples;
  if (!(columns >= 2 && rows >= 2)) return null;
  if (section.values.length < columns * rows) return null;
  const values = createSeismicTexture(
    section.values,
    columns,
    rows,
    Math.max(Math.abs(section.valueRange[0]), Math.abs(section.valueRange[1])),
  );
  const du = (path.along[1] - path.along[0]) / (columns - 1) / 2;
  const [top, bottom] = section.depthRange;
  const dv = (bottom - top) / (rows - 1) / 2;
  return {
    values,
    along: [path.along[0] - du, path.along[1] + du],
    // Row 0 is the top, and TVD is down while scene Y is up.
    y: [-(top - dv), -(bottom + dv)],
  };
}

/**
 * Seismic for a fence's cut face: hand it `ChunkStackProps.onFenceSide`'s info and pass the
 * result on as `ChunkFence.overlay`, with a `mix` and `shading` of your own.
 *
 * Queries the store's `'field-column-seismic-section'` (see {@link FieldColumnSeismicSection})
 * with the UTM positions along the shown side's curve, over the fence's TVD window. Each side is
 * queried the first time it is shown, `delay` ms after the fence and side settle, and kept until
 * the fence is rebuilt.
 *
 * ⭐ The values are kept, not their colours: the face colours them after filtering, so the ramp
 * and range are free to change and a magnified view interpolates the data.
 *
 * @param info the shown side, or `null` to load nothing (and release what was loaded)
 *
 * @group Components
 */
export function useFenceSeismicOverlay(
  info: FenceSideInfo | null,
  options: FenceSeismicOverlayOptions = {},
): FenceSeismicOverlay {
  const store = useData();
  const step = options.step ?? DEFAULT_FENCE_SEISMIC_STEP;
  const delay = options.delay ?? DEFAULT_FENCE_SEISMIC_DELAY;
  const colorRampIndex = options.colorRampIndex ?? 6;
  const rangeOffset = options.rangeOffset ?? 0;
  const maxColumns = options.maxColumns ?? 4096;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Mirrors `loaded`, so effects can tell what is held without waiting for a render.
  const owned = useRef<Loaded | null>(null);

  const fence = info?.fence ?? null;

  // Keyed on what the textures were sampled for, not read by it.
  useEffect(() => {
    return () => {
      const stale = owned.current;
      owned.current = null;
      setLoaded(null);
      if (stale)
        for (const t of Object.values(stale.sides)) t?.values.dispose();
    };
  }, [fence, step]);

  useEffect(() => {
    if (!info || !store || !info.verticalRange) return;
    const { side, curve, rings, verticalRange, toUtm } = info;
    const built = info.fence;
    const held = owned.current;
    if (held?.fence === built && held.step === step && held.sides[side]) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      const path = sampleFencePath(curve, rings, step, maxColumns);
      if (!path) return;
      const utm: number[] = [];
      for (const [x, z] of path.points) {
        const [easting, northing] = toUtm(x, z);
        utm.push(easting, northing);
      }
      const query: FieldColumnSeismicSectionQuery = {
        path: utm,
        // Scene Y is up and TVD is down, so the window's highest Y is its top.
        depthRange: [-verticalRange[1], -verticalRange[0]] as Vec2,
      };
      store
        .get<FieldColumnSeismicSection>(
          FIELD_COLUMN_SEISMIC_SECTION,
          built.report.wellbore ?? '',
          query,
        )
        .then(section => {
          if (cancelled || !section) return;
          const texture = toOverlayTexture(section, path);
          if (!texture) return;
          const current = owned.current;
          const next: Loaded =
            current?.fence === built && current.step === step
              ? { ...current, sides: { ...current.sides, [side]: texture } }
              : { fence: built, step, sides: { [side]: texture } };
          owned.current = next;
          setLoaded(next);
        })
        .catch(error => {
          if (!cancelled)
            console.warn(`fence seismic ${built.report.wellbore}:`, error);
        });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [info, step, delay, store, maxColumns]);

  const sides =
    loaded && loaded.fence === fence && loaded.step === step
      ? loaded.sides
      : NONE;
  const palette = useMemo(
    () => colorRampPalette(colorRampIndex),
    [colorRampIndex],
  );
  const extent = Math.max(1 + rangeOffset, 1e-6);

  return useMemo(
    () => ({
      left: sides.left ?? null,
      right: sides.right ?? null,
      palette,
      // Reversed, as `WellboreSeismicSection` reads its ramp.
      range: [extent, -extent] as Vec2,
    }),
    [sides, palette, extent],
  );
}
