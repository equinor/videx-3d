import { useCallback, useEffect, useRef } from 'react';
import { layerExtentVisibilityAt } from '../../../../sdk/layers/layer-visibility';
import type { LayerExtentVisibility } from '../../../../sdk/layers/layer-visibility';
import { drawMapLabel } from '../../../../sdk/layers/map-draw';
import { advanceTrack, type Track } from '../../../../sdk/layers/tracks';
import { mapViewLonLatToPixel } from '../../../../sdk/projection/map-view';
import {
  useGeoMapCanvasLayer,
  type GeoMapCanvasDraw,
} from '../geo-map-context';

/**
 * GeoMapTracks props: as `TrackLayer`'s, give the same tracks (and `annotations`) to both.
 * @expand
 */
export type GeoMapTracksProps<T extends Track> = LayerExtentVisibility & {
  /** where each thing was last reported, as a `TrackLayer` takes them */
  tracks: T[];
  /** carry each track on along its speed and course between fixes (dead reckoning). Default true */
  extrapolate?: boolean;
  /** a label per track, as a `TrackLayer`'s annotations give it (`text`); its `layer` and `height` are the scene's */
  annotations?: { text: (track: T) => string; layer?: string; height?: number };
  /** each track's colour: one for all, or by track. Default white */
  color?: string | ((track: T) => string);
  /** an arrow's length in pixels. Default 11 */
  size?: number;
  /** the labels' size in CSS pixels. Default 10 */
  fontSize?: number;
  /** among the map's canvas layers: lower is drawn first. Default 20, over the data */
  order?: number;
};

// How often moving tracks are drawn again, in ms: a map need not move them every frame.
const MOVE_MS = 200;

/**
 * A `TrackLayer`'s things that move — ships, vehicles — on a {@link GeoMap}: an arrow each,
 * turned to its course on the map, carried on between fixes along its speed and course as the
 * scene carries them (`advanceTrack`), with its annotation's text. Drawn on the map's canvas
 * over the data, a few times a second while they move.
 *
 * @group Components
 */
export const GeoMapTracks = <T extends Track>({
  tracks,
  extrapolate = true,
  annotations,
  color = '#ffffff',
  size = 11,
  fontSize = 10,
  order = 20,
  visible,
  minHeight,
  maxHeight,
  fade,
  minExtent,
  maxExtent,
}: GeoMapTracksProps<T>) => {
  // When a fix without a time of its own was first seen: where it is carried on from.
  const received = useRef(new WeakMap<T, number>());
  const text = annotations?.text;
  const draw = useCallback<GeoMapCanvasDraw>(
    (ctx, state) => {
      const shown = layerExtentVisibilityAt(
        state.extent,
        { visible, minHeight, maxHeight, fade, minExtent, maxExtent },
        state.heightPerExtent,
      );
      if (shown <= 0) return;
      const { view, toXZ } = state;
      const [width, height] = view.size;
      const now = Date.now();
      const spacer = state.labelSpacer;
      const at = { longitude: 0, latitude: 0 };
      const ahead = { longitude: 0, latitude: 0 };
      ctx.globalAlpha = shown;
      for (const track of tracks) {
        let since = received.current.get(track);
        if (since === undefined) {
          since = now;
          received.current.set(track, since);
        }
        const seconds = extrapolate ? (now - (track.time ?? since)) / 1000 : 0;
        advanceTrack(track, Math.max(seconds, 0), at);
        const [x, y] = mapViewLonLatToPixel(
          view,
          at.longitude,
          at.latitude,
          toXZ,
        );
        if (x < -size || y < -size || x > width + size || y > height + size)
          continue;
        // Its course on the map: a step along it, as drawn.
        advanceTrack(
          {
            longitude: at.longitude,
            latitude: at.latitude,
            speed: 100,
            course: track.course ?? 0,
          },
          10,
          ahead,
        );
        const [ax, ay] = mapViewLonLatToPixel(
          view,
          ahead.longitude,
          ahead.latitude,
          toXZ,
        );
        const angle = Math.atan2(ax - x, -(ay - y));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.6);
        ctx.lineTo(size * 0.4, size * 0.4);
        ctx.lineTo(0, size * 0.15);
        ctx.lineTo(-size * 0.4, size * 0.4);
        ctx.closePath();
        ctx.fillStyle = typeof color === 'function' ? color(track) : color;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.lineWidth = 1;
        ctx.lineJoin = 'round';
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        const label = text?.(track);
        if (label)
          drawMapLabel(
            ctx,
            label,
            x,
            y,
            { fontSize, offset: size * 0.6 + 3 },
            spacer,
          );
      }
      ctx.globalAlpha = 1;
    },
    [
      tracks,
      extrapolate,
      text,
      color,
      size,
      fontSize,
      visible,
      minHeight,
      maxHeight,
      fade,
      minExtent,
      maxExtent,
    ],
  );
  const handle = useGeoMapCanvasLayer(draw, { tier: 'live', order });
  // Moving between fixes: drawn again a few times a second.
  const moving = extrapolate && tracks.some(track => (track.speed ?? 0) > 0);
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => handle.invalidate(), MOVE_MS);
    return () => clearInterval(timer);
  }, [moving, handle]);
  return null;
};
