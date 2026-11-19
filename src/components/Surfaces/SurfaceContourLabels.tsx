import { useCallback, useMemo, useRef, type RefObject } from 'react';
import {
  type Camera,
  type DataTexture,
  Matrix4,
  type Object3D,
  Vector3,
} from 'three';
import type { SurfaceMeta } from '../../sdk/data/types/SurfaceMeta';
import type { ReliefContourLabelPoint } from '../../sdk/geometries/relief-contour-labels';
import {
  surfaceGridToWorld,
  surfaceWorldToGrid,
} from '../../sdk/geometries/surface-grid';
import {
  surfaceLabelTileGround,
  surfaceLabelTileLevels,
  surfaceLabelTileOf,
  surfaceLabelTiles,
  surfaceLabelTileSpan,
  type SurfaceLabelTile,
} from '../../sdk/geometries/surface-label-tiles';
import {
  ContourLabels,
  contourLevelText,
  type ContourLabelFrame,
  type ContourLabelLook,
  type ContourLabelTile,
} from '../Labels/ContourLabels';
import type { Label } from '../Labels/types';
import type { SurfaceMaterial } from './SurfaceMaterial';

// A tile's cells, and the most one spans on screen before it is split: a relief's
// (`RELIEF_TILE_CELLS`, `GeoRelief`'s `cellPixels`), so its labels are as far apart.
const CELLS = 32;
const CELL_PIXELS = 8;
const DEG = Math.PI / 180;
const NONE: readonly unknown[] = [];

const camera = new Vector3();
const inverse = new Matrix4();

// The camera in the surface's frame, and that frame's scale; null without one.
const cameraIn = (object: Object3D | null, view: Camera) => {
  if (!object) return null;
  object.updateWorldMatrix(true, false);
  camera
    .setFromMatrixPosition(view.matrixWorld)
    .applyMatrix4(inverse.copy(object.matrixWorld).invert());
  return object.matrixWorld.getMaxScaleOnAxis();
};

/** @internal */
type SurfaceContourLabelsProps = {
  meta: SurfaceMeta;
  /** the surface's: its elevation texture holds the grid's values */
  material: SurfaceMaterial;
  /** what its contours label, or null */
  look: ContourLabelLook | null;
  visible: boolean;
  /** the frame the surface's mesh is drawn in */
  frame: RefObject<Object3D | null>;
};

/**
 * A `Surface`'s contour lines' labels (`contours.labels`): its depths written along them,
 * found as a relief's are (`ContourLabels`) on tiles of its grid — 32 cells across, every
 * `2^level`-th node, split near the camera until a cell spans no more than 8 pixels, as a
 * relief's tiles are — none by no-data or past the grid's edge.
 *
 * @internal
 */
export const SurfaceContourLabels = ({
  meta,
  material,
  look,
  visible,
  frame,
}: SurfaceContourLabelsProps) => {
  const looks = useMemo(() => [look, null], [look]);
  const { header } = meta;
  const levels = surfaceLabelTileLevels(header.nx, header.ny, CELLS);
  const toGrid = useMemo(() => surfaceWorldToGrid(header), [header]);
  const toLocal = useMemo(() => surfaceGridToWorld(header), [header]);
  // The tiles last drawn: for the camera where, their keys and how far each; and the
  // grid's values they were found on.
  const drawn = useRef({
    at: new Vector3(Infinity, 0, 0),
    focal: 0,
    scale: 0,
    header: null as unknown,
    version: 0,
    keys: [] as number[],
    away: new Map<number, number>(),
    values: null as Float32Array | null,
    from: NONE,
  });

  const source = useCallback(
    (view: Camera, focal: number): ContourLabelFrame | null => {
      const scale = cameraIn(frame.current, view);
      // The grid's values, as the material has them once fetched.
      const values = (
        material.uniforms.elevationTexture.value as DataTexture | null
      )?.image.data as Float32Array | undefined;
      const { nx, ny, xinc, yinc } = header;
      if (!scale || !values || values.length !== nx * ny) return null;
      const d = drawn.current;
      if (values !== d.values) {
        d.values = values;
        d.from = [values];
      }
      if (
        !camera.equals(d.at) ||
        focal !== d.focal ||
        scale !== d.scale ||
        header !== d.header
      ) {
        d.at.copy(camera);
        d.focal = focal;
        d.scale = scale;
        d.header = header;
        // Its nearest to the camera, in the scene's units: off its columns, its rows, and
        // the surface's depths.
        const [column, row] = toGrid(camera.x, camera.z);
        const above = Math.max(-meta.max - camera.y, 0, camera.y + meta.min);
        const awayOf = (tile: SurfaceLabelTile) => {
          const [c0, r0, c1, r1] = surfaceLabelTileSpan(tile, CELLS);
          const off = Math.max(c0 - column, 0, column - Math.min(c1, nx - 1));
          const down = Math.max(r0 - row, 0, row - Math.min(r1, ny - 1));
          return Math.hypot(off * xinc, down * yinc, above) * scale;
        };
        // Split while a cell would span more than `CELL_PIXELS` on screen.
        const cell = Math.max(xinc, yinc) * scale * focal;
        const keys = surfaceLabelTiles(
          nx,
          ny,
          CELLS,
          tile => cell * 2 ** tile.level > CELL_PIXELS * awayOf(tile),
        );
        const away = new Map(
          keys.map(key => [key, awayOf(surfaceLabelTileOf(key))]),
        );
        if (
          keys.length !== d.keys.length ||
          keys.some((key, i) => key !== d.keys[i])
        ) {
          d.version++;
          d.keys = keys;
        }
        d.away = away;
      }
      const aspect = xinc / yinc;
      const from = d.from;
      return {
        version: d.version,
        count: d.keys.length,
        rootRow: yinc * 2 ** levels * scale,
        keys: () => d.keys,
        tile: key => {
          const { level } = surfaceLabelTileOf(key);
          return {
            key,
            from,
            away: d.away.get(key) ?? 0,
            rowMetres: yinc * 2 ** level * scale,
            aspect,
            depth: levels - level,
            ground: () => {
              // Heights as the mesh is drawn: the grid's values less the reference depth,
              // so a line's level is minus its depth.
              const ground = surfaceLabelTileGround(
                values,
                nx,
                ny,
                CELLS,
                key,
                value => value - meta.max,
                value => value >= 0,
              );
              return (
                ground && {
                  cells: CELLS,
                  heights: ground.heights,
                  looks: ground.refused,
                  low: ground.low,
                  high: ground.high,
                }
              );
            },
          };
        },
      };
    },
    [frame, material, meta, header, levels, toGrid],
  );

  // Its label in the surface's frame: lying on it at its line's height, tilted with it,
  // reading along it; written as its depth.
  const place = useCallback(
    (
      tile: ContourLabelTile,
      _cells: number,
      point: ReliefContourLabelPoint,
    ): Label => {
      const at = surfaceLabelTileOf(tile.key);
      const stride = 2 ** at.level;
      const [c0, r0] = surfaceLabelTileSpan(at, CELLS);
      const [x, z] = toLocal(
        c0 + point.column * stride,
        r0 + point.row * stride,
      );
      // A column's way (ex, ez) and a row's (sx, sz) in the frame (`surfaceGridToWorld`), and
      // their lengths.
      const theta = header.rot * DEG;
      const ex = Math.cos(theta);
      const ez = -Math.sin(theta);
      const sx = -ez;
      const sz = ex;
      const across = header.xinc * stride;
      const down = header.yinc * stride;
      // Up, leaning against its rise along a column and a row.
      const rx = point.rise[0] / across;
      const rz = point.rise[1] / down;
      const nx = -(ex * rx + sx * rz);
      const nz = -(ez * rx + sz * rz);
      const n = Math.hypot(nx, 1, nz);
      const dx = ex * point.along[0] * across + sx * point.along[1] * down;
      const dz = ez * point.along[0] * across + sz * point.along[1] * down;
      const length = Math.hypot(dx, dz);
      return {
        text: contourLevelText(-point.level),
        position: [x, point.height, z],
        normal: [nx / n, 1 / n, nz / n],
        direction: [dx / length, 0, dz / length],
        id: `${tile.key}:${point.level}:${Math.round(point.column * 8)}:${Math.round(point.row * 8)}`,
      };
    },
    [header, toLocal],
  );

  // Shown below its `maxHeight` over the surface's shallowest point.
  const shownAt = useCallback(
    (style: { maxHeight?: number }, view: Camera) => {
      if (style.maxHeight === undefined) return true;
      const scale = cameraIn(frame.current, view);
      return !!scale && (camera.y + meta.min) * scale <= style.maxHeight;
    },
    [frame, meta],
  );

  return (
    <ContourLabels
      looks={looks}
      visible={visible}
      cellPixels={CELL_PIXELS}
      source={source}
      place={place}
      shownAt={shownAt}
      refresh={[meta]}
    />
  );
};
