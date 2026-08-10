import { ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useData } from '../../hooks/useData';
import {
  createSurfaceChunk,
  PlanarPolygonGeometry,
  SurfaceChunk,
  SurfaceChunkLayer,
  SurfaceMeta,
  Vec2,
} from '../../sdk';
import { Ocean, OceanProps } from '../Ocean/Ocean';
import { UtmAreaContext } from '../UtmArea';
import { ChunkStackContext } from './ChunkContext';
import { ChunkMeshes } from './ChunkMeshes';
import { ChunkLayer } from './chunk-defs';

/** Fallback per-layer palette for the ocean chunk's geological surfaces. */
const DEFAULT_PALETTE = [
  '#59a14f',
  '#4e79a7',
  '#f28e2c',
  '#e15759',
  '#af7aa1',
  '#76b7b2',
];

/** Procedural sea-bed configuration for {@link OceanChunk}. */
export type OceanChunkProcedural = {
  /** mean water depth below the water level, in meters */
  waterDepth: number;
  /** whether `waterDepth` is the mean or the minimum (shallowest) depth. Default 'mean'. */
  depthMode?: 'mean' | 'min';
  /** ± sea-bed relief amplitude, in meters. Default 60. */
  variation?: number;
  /** procedural seed. Default 0. */
  seed?: number;
  /** sea-bed tessellation. Default 64. */
  segments?: number;
};

/**
 * {@link OceanChunk} props: the {@link Ocean} appearance/wind props (and buoyant
 * `children`) minus the three geometries — those are built here from either an
 * assigned stack of surfaces or a procedural sea bed.
 *
 * @expand
 * @group Components
 */
export type OceanChunkProps = Omit<
  OceanProps,
  'geometry' | 'bodyGeometry' | 'bedGeometry'
> & {
  /**
   * Surfaces owned by the ocean chunk, grouped into zones (shallowest surface =
   * sea bed). `1` surface → just the sea bed; `>1` → the extra surfaces render as
   * a connected sub-chunk beneath the water. Omit for a procedural sea bed.
   */
  groups?: SurfaceMeta[][];
  /** Procedural sea bed (used when `groups` is omitted). */
  procedural?: OceanChunkProcedural;
  /** outline polygon (scene XZ). `'inherit'` (default) uses the {@link ChunkStack}. */
  outline?: PlanarPolygonGeometry | 'inherit';
  /** water surface level (scene Y). Default 0 (sea level). */
  waterLevel?: number;
  /** per-layer colours for the geological surfaces (surface mode). */
  colors?: string[];
  /** geological surface opacity (surface mode). Default 1. */
  surfaceOpacity?: number;
  /** geological wall opacity (surface mode). Default 1. */
  wallOpacity?: number;
  /** rim densification spacing. Inherits from the stack when unset. */
  rimSpacing?: number;
  /** interior simplification error. Inherits from the stack when unset. */
  maxError?: number;
  children?: ReactNode;
};

type LoadedLayer = { values: Float32Array; meta: SurfaceMeta };

/**
 * An ocean "chunk": the water column from the water level down to a sea bed,
 * rendered with the animated {@link Ocean} water shader (and its buoyancy context
 * for floating `children`).
 *
 * The sea bed is either **assigned** — the shallowest of the `groups` surfaces,
 * with any deeper ones rendered as a connected sub-chunk — or **procedural**
 * (control `waterDepth` and relief). The water surface/body geometries are built by
 * the chunk `oceanTop` slot (so they share the chunk outline and meet the sea bed
 * watertight) and handed to `Ocean`. Place inside a `UtmArea`.
 *
 * > For now the ocean uses the shared `ChunkStack` outline. Letting the ocean pick
 * > its own outline (default: the sea-bed surface's own rim → a wider seabed) is a
 * > planned follow-up.
 *
 * @group Components
 */
export const OceanChunk = (props: OceanChunkProps) => {
  const {
    groups,
    procedural,
    outline = 'inherit',
    waterLevel = 0,
    colors = DEFAULT_PALETTE,
    surfaceOpacity = 1,
    wallOpacity = 1,
    rimSpacing,
    maxError,
    ...oceanProps
  } = props;

  const store = useData();
  const utm = useContext(UtmAreaContext);
  const stack = useContext(ChunkStackContext);

  const resolvedOutline = outline === 'inherit' ? stack.outline : outline;
  const resolvedRimSpacing = rimSpacing ?? stack.rimSpacing;
  const resolvedMaxError = maxError ?? stack.maxError;
  const isProcedural = !groups || groups.length === 0;

  // Load the assigned sea-bed / sub-chunk surfaces (surface mode only).
  const [loaded, setLoaded] = useState<LoadedLayer[][] | null>(null);
  useEffect(() => {
    if (isProcedural || !store || !groups) return;
    let cancelled = false;
    Promise.all(
      groups.map(group =>
        Promise.all(
          group.map(async meta => {
            const values = await store.get<Float32Array>(
              'surface-values',
              meta.id,
            );
            return values ? { values, meta } : null;
          }),
        ),
      ),
    ).then(result => {
      if (cancelled) return;
      setLoaded(result.map(g => g.filter((l): l is LoadedLayer => !!l)));
    });
    return () => {
      cancelled = true;
    };
  }, [store, groups, isProcedural]);

  const chunk = useMemo<SurfaceChunk | null>(() => {
    if (!resolvedOutline) return null;
    if (isProcedural) {
      if (!procedural) return null;
      return createSurfaceChunk([], {
        polygon: resolvedOutline,
        rimSpacing: resolvedRimSpacing,
        maxError: resolvedMaxError,
        oceanTop: {
          waterLevel,
          procedural: {
            depth: procedural.waterDepth,
            depthMode: procedural.depthMode,
            variation: procedural.variation,
            seed: procedural.seed,
            segments: procedural.segments,
          },
        },
      });
    }
    if (!loaded || !utm) return null;
    const layerGroups: SurfaceChunkLayer[][] = loaded
      .map(group =>
        group.map(({ values, meta }) => {
          const p = utm.utmToArea(meta.header.xori, meta.header.yori, 0);
          return {
            values,
            header: meta.header,
            referenceDepth: meta.max,
            worldPosition: [p[0], p[2]] as Vec2,
          };
        }),
      )
      .filter(g => g.length > 0);
    if (layerGroups.length === 0) return null;
    return createSurfaceChunk(layerGroups, {
      polygon: resolvedOutline,
      rimSpacing: resolvedRimSpacing,
      maxError: resolvedMaxError,
      oceanTop: { waterLevel },
    });
  }, [
    isProcedural,
    procedural,
    resolvedOutline,
    resolvedRimSpacing,
    resolvedMaxError,
    waterLevel,
    loaded,
    utm,
  ]);

  // Materials are appearance now, so the palette is applied here rather than baked
  // into the build. Mirrors the group→fill mapping `createSurfaceChunk` uses.
  const meshLayers = useMemo<ChunkLayer[]>(() => {
    if (!loaded) return [];
    let flat = 0;
    return loaded.flatMap(group =>
      group.map(({ meta }, i) => {
        const color = colors[flat % colors.length];
        flat++;
        return {
          surface: meta,
          material: color,
          fill: i + 1 < group.length ? color : undefined,
        };
      }),
    );
  }, [loaded, colors]);

  useEffect(() => {
    return () => {
      chunk?.surfaces.forEach(s => s.geometry.dispose());
      chunk?.walls.forEach(w => w.geometry.dispose());
      if (chunk?.oceanTop) {
        chunk.oceanTop.surface.dispose();
        chunk.oceanTop.body.dispose();
        chunk.oceanTop.bed?.dispose();
      }
    };
  }, [chunk]);

  if (!chunk || !chunk.oceanTop) return null;

  return (
    <>
      {!isProcedural && (
        <ChunkMeshes
          chunk={chunk}
          layers={meshLayers}
          surfaceOpacity={surfaceOpacity}
          wallOpacity={wallOpacity}
        />
      )}
      <Ocean
        {...oceanProps}
        geometry={chunk.oceanTop.surface}
        bodyGeometry={chunk.oceanTop.body}
        bedGeometry={chunk.oceanTop.bed}
      />
    </>
  );
};
