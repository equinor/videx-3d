import { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  DataTexture,
  FloatType,
  Group,
  Matrix3,
  Matrix4,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import {
  assertFenceInvariants,
  buildWellboreFence,
  fenceAutoSide,
  fenceFieldPlacement,
  FenceReport,
  getSplineCurve,
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
  PositionLog,
  resamplePolyline2D,
  Store,
  Vec2,
  Vec3,
  WellboreHeader,
  WellboreFence,
} from '../../sdk';
import {
  ChunkFence,
  ChunkFenceState,
  DEFAULT_FENCE_AUTO_DEADBAND,
  DEFAULT_FENCE_AUTO_SETTLE,
  DEFAULT_FENCE_RESOLUTION,
} from './chunk-defs';
import { ChunkFenceUniforms } from './chunk-material';

const eye = new Vector3();
const toStack = new Matrix4();

type UtmToArea = (easting: number, northing: number, altitude?: number) => Vec3;

/** One side, resolved into what the shader and the face builder each need. */
type ResolvedSide = {
  curve: Vec2[];
  texture: DataTexture;
  toUv: Matrix3;
  size: Vector2;
  cells: DataTexture;
  segments: DataTexture;
  index: Vector4;
  indexSize: Vector2;
  segmentsSize: Vector2;
};

type Resolved = {
  plus: ResolvedSide;
  minus: ResolvedSide;
  fence: WellboreFence;
  report: FenceReport;
};

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

/**
 * Resolve a {@link ChunkFence} into the live state a stack publishes: a signed
 * distance field per side, the curve its cut face follows, and the uniforms its
 * materials read.
 *
 * ⭐⭐ BOTH sides are built up front. Flipping which half is removed is then a
 * texture swap and a curve swap — no rebuild, no refetch, and no window in which
 * the shader is cutting last side's field with this side's test.
 *
 * ⭐ The curve is published HERE rather than derived per chunk. Every chunk of the
 * stack would otherwise repeat the most expensive step of the feature with
 * identical inputs.
 *
 * @param fence the caller's declaration, or `undefined` for none
 * @param outline the stack's footprint — the fence is run out past it at both ends
 * @param store where the position log comes from
 * @param utmToArea the stack's UTM→scene mapping
 * @param frame the stack's own frame, for bringing the camera out of world space
 * @param onFence called with each finished fence, or `null` when there is none
 *
 * @group Components
 */
export function useStackFence(
  fence: ChunkFence | undefined,
  outline: PlanarPolygonGeometry | null,
  store: Store | null,
  utmToArea: UtmToArea | undefined,
  frame?: RefObject<Group | null>,
  onFence?: (fence: WellboreFence | null) => void,
) {
  const hasFence = !!fence;
  // ⚠️ Keyed only on PRESENCE, as `sectionState` is: this object reaches every
  // chunk through the context, whose identity is what their build specs derive
  // from.
  const state = useMemo<ChunkFenceState | null>(
    () =>
      hasFence
        ? {
            curve: null,
            alongOffset: 0,
            field: null,
            index: null,
            side: 1,
            offset: 0,
            resolution: DEFAULT_FENCE_RESOLUTION,
            enabled: false,
            debug: false,
          }
        : null,
    [hasFence],
  );

  const wellbore = fence?.wellbore;
  const margin = fence?.margin ?? 0;
  const extension = fence?.extension ?? 'straight';
  const resolution = fence?.resolution ?? DEFAULT_FENCE_RESOLUTION;
  const rings = useMemo(() => outlineRings(outline), [outline]);

  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    if (!hasFence || !wellbore || !store || !utmToArea) {
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
        const curve = getSplineCurve(scene);
        if (!curve) return setResolved(null);

        const built = buildWellboreFence(curve, {
          rings,
          margin,
          extension,
          wellbore,
        });
        if (!built) return setResolved(null);

        // ⚠️ `import.meta.env.DEV`, not `process.env.NODE_ENV`: this is browser
        // code, and Vite is what strips the block from a production build.
        if (import.meta.env.DEV) {
          const problems = assertFenceInvariants(built.report);
          for (const problem of problems) {
            console.warn(`fence ${wellbore}: ${problem}`);
          }
        }

        // ⚠️ NEAREST + FloatType everywhere. The sign field is a SIGN, and the
        // index and segment textures are data — interpolating any of them is
        // exactly the mistake the segment lookup exists to correct.
        const asSide = (from: WellboreFence['plus']): ResolvedSide => {
          const { field, index } = from;
          const raw = (
            data: Float32Array,
            width: number,
            height: number,
            format: typeof RedFormat | typeof RGBAFormat,
          ) => {
            const texture = new DataTexture(
              data,
              width,
              height,
              format,
              FloatType,
            );
            texture.minFilter = NearestFilter;
            texture.magFilter = NearestFilter;
            texture.needsUpdate = true;
            return texture;
          };
          // ONE definition of the placement, shared with the CPU sampler.
          const placement = fenceFieldPlacement(field);
          return {
            curve: resamplePolyline2D(from.curve.points, resolution),
            texture: raw(field.values, field.nx, field.ny, RedFormat),
            toUv: new Matrix3().fromArray(placement.toUv).transpose(),
            size: new Vector2(placement.size[0], placement.size[1]),
            cells: raw(index.cells, index.nx, index.ny, RGBAFormat),
            segments: raw(
              index.segments,
              index.width,
              index.height,
              RGBAFormat,
            ),
            index: new Vector4(
              index.origin[0],
              index.origin[1],
              index.reach,
              field.removedCross,
            ),
            indexSize: new Vector2(index.nx, index.ny),
            segmentsSize: new Vector2(index.width, index.height),
          };
        };

        setResolved({
          plus: asSide(built.plus),
          minus: asSide(built.minus),
          fence: built,
          report: built.report,
        });
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    hasFence,
    wellbore,
    store,
    utmToArea,
    rings,
    margin,
    extension,
    resolution,
  ]);

  // Shared by every material of every chunk, like the section's.
  // x: 1 when the cut is live, y: +1 for the block, -1 for the peel patch.
  const uniform = useMemo(() => ({ value: new Vector2(0, 1) }), []);
  const uniformInverse = useMemo(() => ({ value: new Vector2(0, -1) }), []);

  const uniforms = useMemo<ChunkFenceUniforms>(
    () => ({
      params: uniform,
      map: { value: null },
      toUv: { value: new Matrix3() },
      size: { value: new Vector2(1, 1) },
      cells: { value: null },
      segments: { value: null },
      index: { value: new Vector4(0, 0, 1, 1) },
      indexSize: { value: new Vector2(1, 1) },
      segmentsSize: { value: new Vector2(1, 1) },
    }),
    [uniform],
  );
  const uniformsInverse = useMemo<ChunkFenceUniforms>(
    () => ({
      params: uniformInverse,
      map: uniforms.map,
      toUv: uniforms.toUv,
      size: uniforms.size,
      cells: uniforms.cells,
      segments: uniforms.segments,
      index: uniforms.index,
      indexSize: uniforms.indexSize,
      segmentsSize: uniforms.segmentsSize,
    }),
    [uniformInverse, uniforms],
  );

  // Read from the LIVE prop every frame, so `side` is free to sweep: nothing here
  // touches React and nothing rebuilds.
  const [side, setSide] = useState<1 | -1>(1);
  // How long the camera has been decisively across the cut, in seconds.
  const crossed = useRef(0);
  useFrame(({ camera }, delta) => {
    if (!fence || !state) {
      uniform.value.set(0, 1);
      uniformInverse.value.set(0, -1);
      return;
    }
    let wanted: 1 | -1 = fence.side === 'auto' ? side : (fence.side ?? 1);
    if (fence.side === 'auto' && resolved) {
      // ⭐ The camera has to be in the half that was REMOVED — from the other one
      // the block is in the way and there is no cut face to read.
      camera.getWorldPosition(eye);
      const root = frame?.current;
      if (root) {
        root.updateWorldMatrix(true, false);
        eye.applyMatrix4(toStack.copy(root.matrixWorld).invert());
      }
      const wants = fenceAutoSide(
        side,
        resolved.fence.plus.index,
        resolved.fence.plus.field,
        resolved.plus.curve,
        eye.x,
        eye.z,
        Math.max(fence.autoDeadband ?? DEFAULT_FENCE_AUTO_DEADBAND, margin),
      );
      // ⚠️ Time, not distance, is what keeps a fly-through from flipping the block
      // twice on its way past: the deadband alone is crossed at speed.
      if (wants === side) crossed.current = 0;
      else {
        crossed.current += delta;
        if (
          crossed.current >= (fence.autoSettle ?? DEFAULT_FENCE_AUTO_SETTLE)
        ) {
          crossed.current = 0;
          wanted = wants;
        }
      }
    }
    if (wanted !== side) setSide(wanted);
    const current = resolved
      ? wanted > 0
        ? resolved.plus
        : resolved.minus
      : null;
    const live = wanted > 0 ? resolved?.fence.plus : resolved?.fence.minus;

    state.side = wanted;
    state.offset = fence.offset ?? 0;
    state.resolution = fence.resolution ?? DEFAULT_FENCE_RESOLUTION;
    state.curve = current?.curve ?? null;
    state.field = live?.field ?? null;
    state.index = live?.index ?? null;
    state.enabled = fence.enabled !== false && !!current;
    state.debug = fence.debug === true;

    const on = state.enabled ? 1 : 0;
    uniform.value.set(on, 1);
    uniformInverse.value.set(on, -1);
  });

  // Swapping the textures into the SHARED uniforms is the whole cost of a side flip.
  useEffect(() => {
    const current = resolved
      ? side > 0
        ? resolved.plus
        : resolved.minus
      : null;
    uniforms.map.value = current?.texture ?? null;
    uniforms.cells.value = current?.cells ?? null;
    uniforms.segments.value = current?.segments ?? null;
    if (current) {
      uniforms.toUv.value.copy(current.toUv);
      uniforms.size.value.copy(current.size);
      uniforms.index.value.copy(current.index);
      uniforms.indexSize.value.copy(current.indexSize);
      uniforms.segmentsSize.value.copy(current.segmentsSize);
    }
  }, [resolved, side, uniforms]);

  useEffect(() => {
    return () => {
      for (const at of [resolved?.plus, resolved?.minus]) {
        at?.texture.dispose();
        at?.cells.dispose();
        at?.segments.dispose();
      }
    };
  }, [resolved]);

  // ⚠️ Held in a ref so an inline callback does not re-announce the same fence on
  // every parent render — a host waiting on this to move the camera would then fly
  // again for nothing.
  const announce = useRef(onFence);
  announce.current = onFence;
  useEffect(() => {
    announce.current?.(resolved?.fence ?? null);
  }, [resolved]);

  return { state, uniforms, uniformsInverse, report: resolved?.report ?? null };
}
