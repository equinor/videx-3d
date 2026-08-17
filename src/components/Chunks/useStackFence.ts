import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  DataTexture,
  FloatType,
  Matrix3,
  NearestFilter,
  RGFormat,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import {
  createFenceField,
  createFencePolyline,
  extendFencePolyline,
  FENCE_REVEAL,
  FenceField,
  fenceDepthsFor,
  FenceTaper,
  fenceTaperRange,
  getSplineCurve,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  PositionLog,
  sampleFenceAlong,
  sampleFenceField,
  Store,
  Vec2,
  Vec3,
  WellboreHeader,
} from '../../sdk';
import {
  ChunkFence,
  ChunkFenceState,
  DEFAULT_FENCE_CELL_SIZE,
  DEFAULT_FENCE_RESOLUTION,
} from './chunk-defs';
import { ChunkFenceUniforms } from './chunk-material';

type UtmToArea = (easting: number, northing: number, altitude?: number) => Vec3;

const ZERO = () => 0;

/** A half width below anything the field can hold, so nothing is cut away. */
const FENCE_OFF = -1e30;

// Chord error against the smooth curve is ~L²/8R, so 20 m stays well under a
// metre even round a 200 m bend — the field and the face are built from this same
// polyline, so any facet here becomes a visible periodic wave along the cut.
const DEFAULT_STEP_SIZE = 20;
const DEFAULT_MARGIN = 500;

/** Depth, in metres below MSL, down to which a taper stays fully open. */
const DEFAULT_SHALLOW_DEPTH = 1000;

/** Depth, in metres below MSL, by which a taper has closed. */
const DEFAULT_DEEP_DEPTH = 2500;

type ResolvedFence = {
  field: FenceField;
  sample: (x: number, z: number) => number;
  sampleAlong: (x: number, z: number) => number;
  taper: FenceTaper | null;
  texture: DataTexture;
  toUv: Matrix3;
  size: Vector2;
};

/**
 * Round the survey stations off with a spline before the trace is used.
 *
 * ⭐ A position log is a POLYLINE, so a curved section is a run of facets with a
 * corner at every station. The field the shader reads rounds those corners; a face
 * built on the raw polyline does not — and the two then disagree once per station,
 * which reads as a periodic wave along exactly the curved parts of the fence.
 */
function smooth(points: Vec3[], spacing: number): Vec3[] {
  if (points.length < 3) return points;
  const curve = getSplineCurve(points);
  if (!curve) return points;
  const samples = Math.min(
    4000,
    Math.max(points.length, Math.ceil(curve.length / Math.max(spacing / 4, 1))),
  );
  return curve.getPoints(samples);
}

/** Every ring of an outline in absolute scene XZ. */
function outlineRings(outline: PlanarPolygonGeometry | null): Vec2[][] {
  if (!outline) return [];
  const [ox, oz] = outline.offset;
  const coordinates = outline.coordinates as PlanarPolygonCoordinates;
  const rings: Vec2[][] = [];
  for (const polygon of coordinates) {
    for (const ring of polygon) {
      rings.push(ring.map(p => [p[0] + ox, p[1] + oz] as Vec2));
    }
  }
  return rings;
}

function boundsOf(
  rings: Vec2[][],
  polyline: Vec2[],
): [number, number, number, number] | null {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  const take = (p: Vec2) => {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  };
  for (const ring of rings) for (const p of ring) take(p);
  for (const p of polyline) take(p);
  if (!(maxX > minX) || !(maxZ > minZ)) return null;
  return [minX, minZ, maxX, maxZ];
}

/**
 * Resolve a {@link ChunkFence} into the live state a stack publishes: a signed
 * distance field over the footprint, plus the uniform its materials read.
 *
 * ⭐ The expensive half runs ONCE per fence — load the trajectory, project it,
 * run it out of the outline, rasterise the field. Everything after that is a
 * sampler, so changing which well is cut costs a resample and an upload rather
 * than a build, which is what lets it happen inside a fly-to.
 *
 * @param fence the caller's declaration, or `undefined` for none
 * @param outline the stack's footprint — the fence is run out past it at both ends
 * @param store where the position log comes from
 * @param utmToArea the stack's UTM→scene mapping
 *
 * @group Components
 */
export function useStackFence(
  fence: ChunkFence | undefined,
  outline: PlanarPolygonGeometry | null,
  store: Store | null,
  utmToArea: UtmToArea | undefined,
) {
  // Shared by every material of every chunk, like the section's — see
  // `ChunkStackContextValue.sectionUniform` for why that matters.
  const uniform = useMemo(
    () => ({ value: new Vector4(FENCE_OFF, 1, 0, 1) }),
    [],
  );
  const uniformInverse = useMemo(
    () => ({ value: new Vector4(FENCE_OFF, 1, 0, -1) }),
    [],
  );

  const hasFence = !!fence;
  // ⚠️ Keyed only on PRESENCE, as `sectionState` is: this object reaches every
  // chunk through the context, whose identity is what their build specs derive
  // from.
  const state = useMemo<ChunkFenceState | null>(
    () =>
      hasFence
        ? {
            sample: ZERO,
            sampleAlong: ZERO,
            field: null,
            taper: null,
            side: 1,
            width: 0,
            offset: 0,
            resolution: DEFAULT_FENCE_RESOLUTION,
            enabled: false,
            debug: false,
          }
        : null,
    [hasFence],
  );

  const wellbore = fence?.wellbore;
  const cellSize = fence?.cellSize ?? DEFAULT_FENCE_CELL_SIZE;
  const azimuth = fence?.azimuth ?? 0;
  const reveal = fence?.reveal ?? FENCE_REVEAL;
  // ⚠️ Read HERE, not in the frame loop like `width` and `offset`: the run-outs are
  // chosen by how much block the removed side is left with, so the curve itself
  // depends on it and flipping has to rebuild.
  const side = fence?.side ?? 1;
  const headWidth = fence?.headWidth ?? 0;
  const shallowDepth = fence?.shallowDepth ?? DEFAULT_SHALLOW_DEPTH;
  const deepDepth = fence?.deepDepth ?? DEFAULT_DEEP_DEPTH;
  const stepSize = fence?.stepSize ?? DEFAULT_STEP_SIZE;
  const margin = fence?.margin ?? DEFAULT_MARGIN;
  const pathKey = fence?.path
    ? fence.path.map(p => `${p[0]},${p[1]}`).join('|')
    : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content above
  const path = useMemo(() => fence?.path, [pathKey]);

  const rings = useMemo(() => outlineRings(outline), [outline]);

  const [resolved, setResolved] = useState<ResolvedFence | null>(null);

  useEffect(() => {
    if (!hasFence) return;

    const build = (plan: Vec2[], depths?: number[]) => {
      const bounds = boundsOf(rings, rings.length > 0 ? [] : plan);
      if (!bounds) return null;
      const [minX, minZ, maxX, maxZ] = bounds;
      // ⚠️⚠️ The fence must leave the FIELD, not merely the outline. The raster is
      // the outline's bounding box plus a little, so a curve that exits a concave
      // footprint can still stop inside the box — and then the flood fill that
      // gives the field its SIGN simply walks around the end of the barrier and
      // calls the whole grid one side. Escaping the box as well is what makes the
      // curve actually separate the plane.
      const box: Vec2[] = [
        [minX, minZ],
        [maxX, minZ],
        [maxX, maxZ],
        [minX, maxZ],
      ];
      const extended = extendFencePolyline(plan, {
        rings: [...rings, box],
        // Comfortably past the raster's own padding, or the same leak reappears
        // a cell or two out.
        margin: Math.max(margin, cellSize * 4),
        azimuth,
        side,
        reveal,
      });
      const field = createFenceField(extended, { bounds, cellSize });
      if (!field) return null;

      // ⚠️ `extendFencePolyline` adds exactly ONE point at each end, so the depth
      // series extends by repeating the wellhead's and the terminal depth — which
      // is also what the taper wants: the run-out into the head is as open as the
      // head, the one out of TD as closed as TD.
      const taper: FenceTaper | null =
        headWidth > 0 && depths && depths.length > 0
          ? (() => {
              const [from, to] = fenceTaperRange(
                extended,
                fenceDepthsFor(extended, plan, depths),
                -shallowDepth,
                -deepDepth,
              );
              return { headWidth, from, to };
            })()
          : null;

      // ⚠️ NEAREST + FloatType: linear filtering of a 32-bit float texture needs
      // `OES_texture_float_linear`, so the shader does its own interpolation — the
      // same trade `sampleDepthMap` already makes.
      // ⚠️⚠️ TWO channels: R the signed distance, G the distance ALONG the curve.
      // The taper cannot be baked into R instead, tempting as that is — `side` is a
      // LIVE uniform swept without a rebuild, and which way a widened cut opens
      // depends on it, so baking would freeze the side into the texture.
      const packed = new Float32Array(field.nx * field.ny * 2);
      for (let i = 0; i < field.values.length; i++) {
        packed[i * 2] = field.values[i];
        packed[i * 2 + 1] = field.along[i];
      }
      const texture = new DataTexture(
        packed,
        field.nx,
        field.ny,
        RGFormat,
        FloatType,
      );
      texture.minFilter = NearestFilter;
      texture.magFilter = NearestFilter;
      texture.needsUpdate = true;
      // Object XZ -> uv. The chunk meshes carry no translation, so their object
      // frame IS the stack's metre frame.
      // ⚠⚠ The half texel is not cosmetic: the shader recovers the node index as
      // `uv * size - 0.5`, so without it the GPU reads half a cell away from the
      // CPU — which at a 25 m field is a 12.5 m disagreement between where the cut
      // face is drawn and where the block is actually removed.
      const toUv = new Matrix3().set(
        1 / (field.nx * field.cell),
        0,
        -field.origin[0] / (field.nx * field.cell) + 0.5 / field.nx,
        0,
        1 / (field.ny * field.cell),
        -field.origin[1] / (field.ny * field.cell) + 0.5 / field.ny,
        0,
        0,
        1,
      );
      return {
        field,
        sample: sampleFenceField(field),
        sampleAlong: sampleFenceAlong(field),
        taper,
        texture,
        toUv,
        size: new Vector2(field.nx, field.ny),
      };
    };

    if (path && path.length > 0) {
      setResolved(build(path));
      return;
    }
    if (!wellbore || !store || !utmToArea) {
      setResolved(null);
      return;
    }

    let cancelled = false;
    Promise.all([
      store.get<WellboreHeader>('wellbore-headers', wellbore),
      store.get<PositionLog>('position-logs', wellbore),
    ])
      .then(([header, poslog]) => {
        if (cancelled) return;
        if (!header || !poslog || poslog.length < 8) return setResolved(null);
        // Head-relative deltas, MSL-normalized — the same placement the surfaces
        // use. ⚠️ `utmToArea` is (easting, northing, altitude): depth is a
        // downward-negative altitude, not the second argument.
        const scene: Vec3[] = [];
        for (let j = 0; j + 3 < poslog.length; j += 4) {
          scene.push(
            utmToArea(
              header.easting + poslog[j],
              header.northing + poslog[j + 2],
              -poslog[j + 1],
            ),
          );
        }
        const projected = createFencePolyline(
          smooth(scene, stepSize),
          stepSize,
        );
        setResolved(
          projected ? build(projected.positions, projected.depths) : null,
        );
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    hasFence,
    path,
    wellbore,
    store,
    utmToArea,
    rings,
    margin,
    azimuth,
    side,
    reveal,
    headWidth,
    shallowDepth,
    deepDepth,
    cellSize,
    stepSize,
  ]);

  // Read from the LIVE prop every frame, so width and side are free to sweep:
  // none of them touches React, and nothing here rebuilds anything.
  useFrame(() => {
    if (!fence || !state) {
      uniform.value.set(FENCE_OFF, 1, 0, 1);
      uniformInverse.value.set(FENCE_OFF, 1, 0, -1);
      return;
    }
    state.side = fence.side ?? 1;
    state.width = fence.width ?? 0;
    state.offset = fence.offset ?? 0;
    state.resolution = fence.resolution ?? DEFAULT_FENCE_RESOLUTION;
    state.sample = resolved?.sample ?? ZERO;
    state.sampleAlong = resolved?.sampleAlong ?? ZERO;
    state.field = resolved?.field ?? null;
    state.taper = resolved?.taper ?? null;
    state.enabled = fence.enabled !== false && !!resolved;
    state.debug = fence.debug === true;

    const halfWidth = state.enabled ? state.width : FENCE_OFF;
    uniform.value.set(halfWidth, state.side, 0, 1);
    uniformInverse.value.set(halfWidth, state.side, 0, -1);
  });

  const uniforms = useMemo<ChunkFenceUniforms>(
    () => ({
      params: uniform,
      taper: { value: new Vector3(0, 0, 1) },
      map: { value: null },
      toUv: { value: new Matrix3() },
      size: { value: new Vector2(1, 1) },
    }),
    [uniform],
  );
  const uniformsInverse = useMemo<ChunkFenceUniforms>(
    () => ({
      params: uniformInverse,
      taper: uniforms.taper,
      map: uniforms.map,
      toUv: uniforms.toUv,
      size: uniforms.size,
    }),
    [uniformInverse, uniforms],
  );

  // The texture is swapped into the SHARED uniform rather than rebuilt into new
  // materials, so a new wellbore costs an upload and nothing else.
  useEffect(() => {
    uniforms.map.value = resolved?.texture ?? null;
    if (resolved) {
      uniforms.toUv.value.copy(resolved.toUv);
      uniforms.size.value.copy(resolved.size);
      const taper = resolved.taper;
      uniforms.taper.value.set(
        taper?.headWidth ?? 0,
        taper?.from ?? 0,
        taper?.to ?? 1,
      );
    }
    return () => {
      resolved?.texture.dispose();
    };
  }, [resolved, uniforms]);

  return { state, uniforms, uniformsInverse };
}
