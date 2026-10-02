import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { DataTexture } from 'three';
import { colorRampTexture } from '../../common/color-ramps';
import { createSeismicTexture } from '../../common/seismic-texture';
import {
  FIELD_COLUMN_SEISMIC_SECTION,
  FieldColumnSeismicSection,
  FieldColumnSeismicSectionQuery,
  FenceSideName,
  sampleFenceSeismicPath,
  Store,
  Vec2,
} from '../../sdk';
import {
  ChunkFenceSeismic,
  ChunkSeismicShading,
  DEFAULT_FENCE_SEISMIC_DELAY,
  DEFAULT_FENCE_SEISMIC_STEP,
} from './chunk-defs';
import { ChunkSeismicUniforms, createSeismicUniforms } from './chunk-material';
import { StackFenceBuilt } from './useStackFence';

type AreaToUtm = (
  x: number,
  y: number,
  z: number,
) => { easting: number; northing: number };

/** One side's loaded seismic, its values divided by their largest amplitude. */
type SeismicEntry = {
  texture: DataTexture;
  along: Vec2;
  /** TVD of the map's top and bottom rows, then of the window it is drawn in */
  depth: [number, number, number, number];
  size: Vec2;
};

type SeismicLook = {
  mix: number;
  colorRampIndex: number;
  rangeOffset: number;
  shading: ChunkSeismicShading;
};

const SHADING_MODE: Record<ChunkSeismicShading, number> = {
  flat: 0,
  lit: 1,
  facing: 2,
};

function writeSeismic(
  uniforms: ChunkSeismicUniforms,
  entry: SeismicEntry | null,
  look: SeismicLook,
) {
  uniforms.map.value = entry?.texture ?? null;
  const params = uniforms.params.value;
  params.x = entry ? Math.min(Math.max(look.mix, 0), 1) : 0;
  if (!entry) return;
  params.y = entry.along[0];
  params.z = entry.along[1];
  params.w = SHADING_MODE[look.shading] ?? SHADING_MODE.lit;
  uniforms.depth.value.fromArray(entry.depth);
  uniforms.size.value.fromArray(entry.size);
  const range = Math.max(1 + look.rangeOffset, 1e-6);
  const ramp = uniforms.ramp.value;
  ramp.x = -range;
  ramp.y = range;
  ramp.z = look.colorRampIndex;
}

/**
 * Load seismic along a stack's fence and publish it to the cut faces through shared uniforms.
 *
 * Each side is queried the first time it is shown, `delay` ms after the fence and side settle,
 * and kept until the fence is rebuilt. A newer request cancels a waiting one and drops a
 * superseded response; the face shows the formations alone until its side has loaded.
 *
 * @param seismic the fence's seismic options, or `undefined` for none
 * @param enabled whether the fence is cutting; while it is not, nothing loads or shows
 * @param built the stack's built fence, or `null` while there is none
 * @param side the side currently cut away
 * @param store where the seismic is queried from
 * @param areaToUtm the stack's scene→UTM mapping
 * @returns the shared uniforms, or `null` when seismic is off
 *
 * @group Components
 */
export function useStackFenceSeismic(
  seismic: ChunkFenceSeismic | undefined,
  enabled: boolean,
  built: StackFenceBuilt | null,
  side: FenceSideName,
  store: Store | null,
  areaToUtm: AreaToUtm | undefined,
): ChunkSeismicUniforms | null {
  const hasSeismic = !!seismic;
  const uniforms = useMemo(() => {
    if (!hasSeismic) return null;
    const created = createSeismicUniforms();
    created.rampTexture.value = colorRampTexture;
    created.ramp.value.w = colorRampTexture.height;
    return created;
  }, [hasSeismic]);
  const maxColumns = useThree(s => s.gl.capabilities.maxTextureSize);

  const step = seismic?.step ?? DEFAULT_FENCE_SEISMIC_STEP;
  const delay = seismic?.delay ?? DEFAULT_FENCE_SEISMIC_DELAY;
  const mix = seismic?.mix ?? 1;
  const colorRampIndex = seismic?.colorRampIndex ?? 6;
  const rangeOffset = seismic?.rangeOffset ?? 0;
  const shading = seismic?.shading ?? 'lit';

  const look = useRef<SeismicLook>({
    mix,
    colorRampIndex,
    rangeOffset,
    shading,
  });
  look.current = { mix, colorRampIndex, rangeOffset, shading };
  const shown = useRef<SeismicEntry | null>(null);
  const cache = useRef(new Map<FenceSideName, SeismicEntry>());

  const fence = built?.fence ?? null;
  const rings = built?.rings;
  const curves = built?.curves;

  // Keyed on what the cached values were sampled for, not read by it.
  useEffect(() => {
    const held = cache.current;
    return () => {
      held.forEach(entry => entry.texture.dispose());
      held.clear();
    };
  }, [fence, step, hasSeismic]);

  useEffect(() => {
    if (!uniforms) return;
    const show = (entry: SeismicEntry | null) => {
      shown.current = entry;
      writeSeismic(uniforms, entry, look.current);
    };
    const wellbore = fence?.report.wellbore;
    const span = fence?.report.verticalRange;
    const curve = curves?.[side];
    if (
      !enabled ||
      !wellbore ||
      !span ||
      !curve ||
      !rings ||
      !store ||
      !areaToUtm
    ) {
      show(null);
      return;
    }
    const cached = cache.current.get(side);
    if (cached) {
      show(cached);
      return;
    }
    show(null);

    const held = cache.current;
    let cancelled = false;
    const timer = setTimeout(() => {
      const path = sampleFenceSeismicPath(curve, rings, step, maxColumns);
      if (!path) return;
      const utm: number[] = [];
      for (const [x, z] of path.points) {
        const p = areaToUtm(x, 0, z);
        utm.push(p.easting, p.northing);
      }
      // Scene Y is up and TVD is down, so the window's highest Y is its top.
      const depthRange: Vec2 = [-span[1], -span[0]];
      const query: FieldColumnSeismicSectionQuery = { path: utm, depthRange };
      store
        .get<FieldColumnSeismicSection>(
          FIELD_COLUMN_SEISMIC_SECTION,
          wellbore,
          query,
        )
        .then(section => {
          if (cancelled || !section) return;
          const [columns, rows] = section.samples;
          if (!(columns > 0 && rows > 0)) return;
          if (section.values.length < columns * rows) return;
          const texture = createSeismicTexture(
            section.values,
            columns,
            rows,
            Math.max(
              Math.abs(section.valueRange[0]),
              Math.abs(section.valueRange[1]),
            ),
          );
          const entry: SeismicEntry = {
            texture,
            along: path.along,
            depth: [
              section.depthRange[0],
              section.depthRange[1],
              depthRange[0],
              depthRange[1],
            ],
            size: [columns, rows],
          };
          held.set(side, entry);
          show(entry);
        })
        .catch(error => {
          if (!cancelled) console.warn(`fence seismic ${wellbore}:`, error);
        });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    uniforms,
    enabled,
    fence,
    rings,
    curves,
    side,
    step,
    delay,
    store,
    areaToUtm,
    maxColumns,
  ]);

  useEffect(() => {
    if (uniforms)
      writeSeismic(uniforms, shown.current, {
        mix,
        colorRampIndex,
        rangeOffset,
        shading,
      });
  }, [uniforms, mix, colorRampIndex, rangeOffset, shading]);

  return uniforms;
}
