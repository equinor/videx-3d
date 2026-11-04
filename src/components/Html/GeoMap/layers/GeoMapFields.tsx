import { useCallback, useEffect } from 'react';
import { Vector3 } from 'three';
import {
  boundaryOutline,
  type Boundary,
} from '../../../../sdk/geometries/boundary';
import { layerExtentVisibilityAt } from '../../../../sdk/layers/layer-visibility';
import type { LayerExtentVisibility } from '../../../../sdk/layers/layer-visibility';
import {
  mapClipRect,
  paintMapPath,
  traceMapPixels,
} from '../../../../sdk/layers/map-draw';
import { mapViewToPixel } from '../../../../sdk/projection/map-view';
import type { Vec2 } from '../../../../sdk/types/common';
import { useWorld } from '../../../World/world-context';
import { useWorldFields } from '../../../World/world-fields';
import {
  useGeoMapCanvasLayer,
  type GeoMapCanvasDraw,
} from '../geo-map-context';

/**
 * GeoMapFields props
 * @expand
 */
export type GeoMapFieldsProps = LayerExtentVisibility & {
  /** the fields' outlines. Default white */
  color?: string;
  /** the anchored stage's outline: the field the scene is laid out about. Default `'#ffd21a'` */
  anchoredColor?: string;
  /** the fields' fill's opacity. Default 0.08 */
  fillOpacity?: number;
  /** pixels. Default 1.5 */
  strokeWidth?: number;
  /** among the map's canvas layers: lower is drawn first. Default -20, under the data */
  order?: number;
};

const point = new Vector3();

/**
 * The fields loaded in the enclosing `World` — each `UtmArea` with a `boundary`, where it lies
 * now — on a {@link GeoMap}, outlined and faintly filled, and the anchored stage's area (the
 * `World`'s `boundary`) highlighted over them: where the data is, at any zoom. Needs the map
 * inside the `World` (in an `Overlay` in it, say).
 *
 * @group Components
 */
export const GeoMapFields = ({
  color = '#ffffff',
  anchoredColor = '#ffd21a',
  fillOpacity = 0.08,
  strokeWidth = 1.5,
  order = -20,
  visible,
  minHeight,
  maxHeight,
  fade,
  minExtent,
  maxExtent,
}: GeoMapFieldsProps) => {
  const world = useWorld();
  const fields = useWorldFields()?.fields;
  const anchored = world?.boundary ?? null;
  const draw = useCallback<GeoMapCanvasDraw>(
    (ctx, state) => {
      const shown = layerExtentVisibilityAt(
        state.extent,
        { visible, minHeight, maxHeight, fade, minExtent, maxExtent },
        state.heightPerExtent,
      );
      if (shown <= 0) return;
      const { view } = state;
      const clip = mapClipRect(view);
      const outline = (
        boundary: Boundary,
        place: (x: number, z: number) => Vec2,
      ) => {
        for (const ring of boundaryOutline(boundary))
          traceMapPixels(
            ctx,
            ring.map(([x, z]) => {
              const [wx, wz] = place(x, z);
              return mapViewToPixel(view, wx, wz);
            }),
            true,
            clip,
          );
      };
      // Each field where its group lies now: its own X/Z through its world matrix.
      for (const field of fields ?? []) {
        const matrix = field.object.matrixWorld;
        ctx.beginPath();
        outline(field.boundary, (x, z) => {
          point.set(x, 0, z).applyMatrix4(matrix);
          return [point.x, point.z];
        });
        paintMapPath(ctx, {
          fill: color,
          fillOpacity: fillOpacity * shown,
          stroke: color,
          strokeOpacity: 0.8 * shown,
          strokeWidth,
        });
      }
      if (anchored) {
        ctx.beginPath();
        outline(anchored, (x, z) => [x, z]);
        paintMapPath(ctx, {
          stroke: anchoredColor,
          strokeOpacity: shown,
          strokeWidth: strokeWidth + 0.5,
        });
      }
    },
    [
      fields,
      anchored,
      color,
      anchoredColor,
      fillOpacity,
      strokeWidth,
      visible,
      minHeight,
      maxHeight,
      fade,
      minExtent,
      maxExtent,
    ],
  );
  const handle = useGeoMapCanvasLayer(draw, { order });
  // A switch of the anchor moves the fields in the frame after: drawn again then.
  const frame = world?.frame;
  useEffect(() => {
    const raf = requestAnimationFrame(() => handle.invalidate());
    return () => cancelAnimationFrame(raf);
  }, [frame, fields, handle]);
  return null;
};
