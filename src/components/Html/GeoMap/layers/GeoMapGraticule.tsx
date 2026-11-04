import { useCallback, useMemo } from 'react';
import { layerExtentVisibilityAt } from '../../../../sdk/layers/layer-visibility';
import type { LayerExtentVisibility } from '../../../../sdk/layers/layer-visibility';
import {
  drawMapLabel,
  mapClipRect,
  mapViewLonLatBox,
  paintMapPath,
  traceMapPixels,
} from '../../../../sdk/layers/map-draw';
import {
  graticuleMeridianThinning,
  graticuleStep,
  type GraticuleStyle,
} from '../../../../sdk/materials/graticule';
import { mapViewLonLatToPixel } from '../../../../sdk/projection/map-view';
import type { Vec2 } from '../../../../sdk/types/common';
import { graticuleLabelText } from '../../../Layers/graticule-labels';
import {
  graticuleStyles,
  type GeoGraticuleOptions,
} from '../../../Layers/graticule-options';
import {
  timeZoneCells,
  utmZoneCells,
  type GraticuleZoneCell,
} from '../../../Layers/graticule-zone-labels';
import {
  useGeoMapCanvasLayer,
  type GeoMapCanvasDraw,
  type GeoMapState,
} from '../geo-map-context';
import { METRES_PER_DEGREE } from '../geo-map-view';
import { cssColor } from './geo-map-features';

/**
 * GeoMapGraticule props: as `GeoGraticule`'s, give the same object to both.
 * @expand
 */
export type GeoMapGraticuleProps = GeoGraticuleOptions &
  LayerExtentVisibility & {
    /** the names' size in CSS pixels. Default 10 */
    fontSize?: number;
    /** among the map's canvas layers: lower is drawn first. Default -50, under the data */
    order?: number;
  };

// Points along a line of latitude or longitude: enough for it to bend in any projection.
const SEGMENTS = 48;

// The points from `a` to `b` in longitude and latitude, `n` steps.
function lonLatLine(a: Vec2, b: Vec2, n: number): Vec2[] {
  const points: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return points;
}

const pixelsOf = (state: GeoMapState, line: Vec2[]): Vec2[] =>
  line.map(([lon, lat]) =>
    mapViewLonLatToPixel(state.view, lon, lat, state.toXZ),
  );

type Box = [number, number, number, number];

// The lines of latitude and longitude every `step` degrees over `box`, the meridians thinned
// toward the poles as the scene's graticule thins them; with where to name each.
function latLonLines(state: GeoMapState, box: Box, step: number) {
  const [west, south, east, north] = box;
  const lines: { pixels: Vec2[]; text: string; meridian: boolean }[] = [];
  const top = Math.min(north, 90);
  const bottom = Math.max(south, -90);
  for (let k = Math.ceil(bottom / step); k * step <= top + 1e-9; k++) {
    const lat = k * step;
    if (Math.abs(lat) >= 90) continue;
    lines.push({
      pixels: pixelsOf(state, lonLatLine([west, lat], [east, lat], SEGMENTS)),
      text: graticuleLabelText(lat, step, 'lat'),
      meridian: false,
    });
  }
  const first = Math.floor(bottom / step);
  const last = Math.ceil(top / step);
  for (let k = Math.ceil(west / step); k * step <= east + 1e-9; k++) {
    const lon = k * step;
    // Its runs between parallels where it is kept, joined where they meet.
    let run: Vec2[] = [];
    let named = false;
    const flush = () => {
      if (run.length > 1) {
        lines.push({
          pixels: pixelsOf(state, run),
          text: named ? '' : graticuleLabelText(wrap(lon), step, 'lon'),
          meridian: true,
        });
        named = true;
      }
      run = [];
    };
    for (let band = first; band < last; band++) {
      const thin = graticuleMeridianThinning(step, band);
      if (!thin || ((k % thin) + thin) % thin !== 0) {
        flush();
        continue;
      }
      const from = Math.max(band * step, bottom, -90);
      const to = Math.min((band + 1) * step, top, 90);
      if (to <= from) continue;
      const part = lonLatLine([lon, from], [lon, to], 8);
      run.push(...(run.length ? part.slice(1) : part));
    }
    flush();
  }
  return lines;
}

const wrap = (longitude: number) =>
  longitude - 360 * Math.floor((longitude + 180) / 360);

/**
 * A `GeoGraticule`'s lines on a {@link GeoMap}: latitude and longitude following the map's
 * zoom by the same steps (`graticuleStep`), the meridians thinned toward the poles as the
 * scene's are; the UTM zones' edges; the nautical time zones' meridians — each named, when
 * asked, along the map's edges or in its cells. The same options as the scene's graticule,
 * drawn on the map's canvas in any projection.
 *
 * @group Components
 */
export const GeoMapGraticule = ({
  latLon,
  utm,
  timeZones,
  labels,
  fontSize = 10,
  order = -50,
  visible,
  minHeight,
  maxHeight,
  fade,
  minExtent,
  maxExtent,
}: GeoMapGraticuleProps) => {
  const optionsKey = JSON.stringify({ latLon, utm, timeZones, labels });
  const { styles, named } = useMemo(() => {
    const options = JSON.parse(optionsKey) as GeoGraticuleOptions;
    const all = options.labels;
    const asked = (kind: 'latLon' | 'utm' | 'timeZones') =>
      !!(typeof all === 'object' ? all[kind] : all);
    return {
      styles: graticuleStyles(options),
      named: {
        latLon: asked('latLon'),
        utm: asked('utm'),
        timeZones: asked('timeZones'),
      },
    };
  }, [optionsKey]);
  const utmCells = useMemo(
    () => (styles.utm ? utmZoneCells() : []),
    [styles.utm],
  );
  const timeCells = useMemo(
    () => (styles.timeZones ? timeZoneCells() : []),
    [styles.timeZones],
  );

  const draw = useCallback<GeoMapCanvasDraw>(
    (ctx, state) => {
      const shown = layerExtentVisibilityAt(
        state.extent,
        { visible, minHeight, maxHeight, fade, minExtent, maxExtent },
        state.heightPerExtent,
      );
      if (shown <= 0) return;
      const { view } = state;
      const [width, height] = view.size;
      const middle = view.lonLat ?? state.toLonLat(...view.center);
      const box: Box = mapViewLonLatBox(view, state.toLonLat) ?? [
        middle[0] - 180,
        -85,
        middle[0] + 180,
        85,
      ];
      const clip = mapClipRect(view);
      const spacer = state.labelSpacer;
      const stroke = (style: GraticuleStyle, alpha: number) =>
        paintMapPath(ctx, {
          stroke: cssColor(style.color, '#ffffff'),
          strokeOpacity: style.opacity * alpha * shown,
          strokeWidth: style.thickness,
        });
      const label = (
        text: string,
        at: Vec2,
        color: string,
        align: 'center' | 'right',
      ) =>
        drawMapLabel(
          ctx,
          text,
          at[0],
          at[1],
          { fontSize, color, align, offset: 0 },
          spacer,
        );

      // The zones under latitude and longitude: their cells' edges, then their names.
      const zones = (
        cells: GraticuleZoneCell[],
        style: GraticuleStyle,
        meridiansOnly: boolean,
        name: boolean,
      ) => {
        ctx.beginPath();
        const seen = new Set<string>();
        const shownCells: GraticuleZoneCell[] = [];
        for (const cell of cells) {
          if (
            cell.north < box[1] ||
            cell.south > box[3] ||
            ![0, 360, -360].some(
              s => cell.west + s <= box[2] && cell.east + s >= box[0],
            )
          )
            continue;
          shownCells.push(cell);
          for (const lon of [cell.west, cell.east]) {
            // A meridian shared by two cells of a band is drawn once.
            const key = `${lon}:${cell.south}`;
            if (seen.has(key)) continue;
            seen.add(key);
            traceMapPixels(
              ctx,
              pixelsOf(
                state,
                lonLatLine([lon, cell.south], [lon, cell.north], 8),
              ),
              false,
              clip,
            );
          }
          if (!meridiansOnly)
            traceMapPixels(
              ctx,
              pixelsOf(
                state,
                lonLatLine([cell.west, cell.south], [cell.east, cell.south], 8),
              ),
              false,
              clip,
            );
        }
        stroke(style, 1);
        if (!name) return;
        const color = cssColor(style.color, '#ffffff');
        for (const cell of shownCells) {
          const at = mapViewLonLatToPixel(
            view,
            (cell.west + cell.east) / 2,
            (cell.south + cell.north) / 2,
            state.toXZ,
          );
          if (at[0] < 0 || at[1] < 0 || at[0] > width || at[1] > height)
            continue;
          label(cell.text, at, color, 'center');
        }
      };
      if (styles.utm) zones(utmCells, styles.utm, false, named.utm);
      if (styles.timeZones)
        zones(timeCells, styles.timeZones, true, named.timeZones);

      const latLonStyle = styles.latLon;
      if (latLonStyle) {
        // The step by how far the map is zoomed: degrees of latitude a pixel spans.
        const fixed = latLonStyle.interval ?? 0;
        const step =
          fixed > 0
            ? { step: fixed, finer: fixed, weight: 0 }
            : graticuleStep(
                view.metresPerPixel / METRES_PER_DEGREE,
                latLonStyle.minSpacing,
              );
        if (step.weight > 0 && step.finer !== step.step) {
          ctx.beginPath();
          for (const line of latLonLines(state, box, step.finer))
            traceMapPixels(ctx, line.pixels, false, clip);
          stroke(latLonStyle, step.weight);
        }
        const lines = latLonLines(state, box, step.step);
        ctx.beginPath();
        for (const line of lines) traceMapPixels(ctx, line.pixels, false, clip);
        stroke(latLonStyle, 1);
        if (named.latLon) {
          const color = cssColor(latLonStyle.color, '#ffffff');
          // A parallel's name at the map's left, a meridian's at its bottom.
          for (const line of lines) {
            if (!line.text) continue;
            let best: Vec2 | null = null;
            for (const [x, y] of line.pixels) {
              if (x < 0 || y < 0 || x > width || y > height) continue;
              if (!best || (line.meridian ? y > best[1] : x < best[0]))
                best = [x, y];
            }
            if (!best) continue;
            label(
              line.text,
              line.meridian
                ? [best[0], Math.min(best[1], height - 18)]
                : [Math.max(best[0], 4), best[1]],
              color,
              line.meridian ? 'center' : 'right',
            );
          }
        }
      }
    },
    [
      styles,
      named,
      utmCells,
      timeCells,
      fontSize,
      visible,
      minHeight,
      maxHeight,
      fade,
      minExtent,
      maxExtent,
    ],
  );
  useGeoMapCanvasLayer(draw, { order });
  return null;
};
