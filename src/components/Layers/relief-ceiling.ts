import { useEffect, useMemo, useState } from 'react';
import {
  GEO_TILE_ROOT_SPAN,
  geoTileKeyAt,
} from '../../sdk/tiles/geo-tile-keys';
import { useSceneryOcean } from '../Scenery/scenery-context';
import type { SceneryReliefDrawn } from '../Scenery/scenery-relief-hub';
import { useWorldRelief } from '../World/world-relief';

const DEG = Math.PI / 180;
// Metres along a meridian per degree of latitude, on the Earth's mean sphere.
const METRES_PER_DEGREE = DEG * 6371008.8;
// No relief tile is finer.
const MAX_DEPTH = 24;

/**
 * The highest ground a relief has in over a box of longitude and latitude (degrees), metres
 * over the sea: the most of `rangeAt` — each from the finest relief tile in over it — over
 * the geographic tiles that cover the box, at the depth whose tiles are as large as the box
 * (two by two at the most cover it). Null where no relief is in.
 *
 * Never lower than the ground as drawn there: a tile's range holds its nodes, which its
 * triangles lie between, and a coarser tile's nodes average its children's.
 *
 * @group Layers
 */
export function reliefCeiling(
  rangeAt: SceneryReliefDrawn['rangeAt'],
  west: number,
  south: number,
  east: number,
  north: number,
): number | null {
  const span = Math.max(east - west, north - south, 1e-9);
  const depth = Math.min(
    Math.max(Math.floor(Math.log2(GEO_TILE_ROOT_SPAN / span)), 0),
    MAX_DEPTH,
  );
  let highest = -Infinity;
  const seen: number[] = [];
  for (const longitude of [west, east]) {
    for (const latitude of [south, north]) {
      const key = geoTileKeyAt(depth, longitude, latitude);
      if (seen.includes(key)) continue;
      seen.push(key);
      const range = rangeAt(key);
      if (range) highest = Math.max(highest, range[1]);
    }
  }
  return highest === -Infinity ? null : highest;
}

/**
 * The highest ground a relief has in within `reach` metres of a point (degrees) — a
 * label's footprint about its place, say: {@link reliefCeiling} over the box round it.
 *
 * @group Layers
 */
export function reliefCeilingAround(
  rangeAt: SceneryReliefDrawn['rangeAt'],
  longitude: number,
  latitude: number,
  reach: number,
): number | null {
  const dLat = reach / METRES_PER_DEGREE;
  const dLon =
    dLat / Math.max(Math.cos(Math.min(Math.abs(latitude), 89) * DEG), 1e-3);
  return reliefCeiling(
    rangeAt,
    longitude - dLon,
    Math.max(latitude - dLat, -90),
    longitude + dLon,
    Math.min(latitude + dLat, 90),
  );
}

/** The highest ground of the relief in, for what is placed over it ({@link useReliefCeiling}). */
export type ReliefCeiling = {
  /**
   * the highest ground within `reach` metres of a point (degrees), metres over the sea; null
   * where no relief is in
   */
  around(longitude: number, latitude: number, reach: number): number | null;
  /** changes as the relief's tiles in do: what was placed by `around` may be placed again */
  version: number;
};

/**
 * The highest ground of the relief drawn in the enclosing `World` (or `Scenery`), for what
 * is placed over it — labels lying flat over land, say, which the ground would bury — and a
 * version that changes as its tiles come in and go, at most once every `interval`
 * milliseconds (default 250), for them to be placed again. Null without a relief hub.
 *
 * @group Layers
 */
export function useReliefCeiling(interval = 250): ReliefCeiling | null {
  const world = useWorldRelief();
  const ocean = useSceneryOcean();
  const hub = world?.tiles ?? ocean?.reliefTiles ?? null;
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!hub) return;
    let resident = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const take = () => {
      const now = hub.current ? hub.current.resident : -1;
      if (now === resident) return;
      resident = now;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setVersion(v => v + 1);
      }, interval);
    };
    take();
    const release = hub.subscribe(take);
    return () => {
      release();
      if (timer) clearTimeout(timer);
    };
  }, [hub, interval]);
  return useMemo(
    () =>
      hub
        ? {
            version,
            around: (longitude: number, latitude: number, reach: number) => {
              const drawn = hub.current;
              return drawn
                ? reliefCeilingAround(drawn.rangeAt, longitude, latitude, reach)
                : null;
            },
          }
        : null,
    [hub, version],
  );
}
