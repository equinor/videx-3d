import { useContext, useMemo } from 'react';
import { GeneratorsContext } from '../../contexts/GeneratorsContext';
import { useGenerator } from '../../hooks/useGenerator';
import type {
  ReliefLayer,
  ReliefLayersSource,
  ReliefTile,
} from '../../sdk/geometries/relief-tiles';
import {
  sceneryReliefTile,
  type SceneryReliefTileResponse,
} from '../Scenery/scenery-defs';

/**
 * A relief's geographic tiles on demand, merged from its layers by the `sceneryReliefTile`
 * generator: for what draws or samples the same ground as a `GeoRelief` (a `GeoMap`, the
 * clouds' terrain).
 */
export type ReliefTileLoader = {
  /** what the tiles are merged from, its layers and its base: a new key, other tiles */
  key: string;
  /** the height where no layer has data, metres above mean sea level */
  base: number;
  /**
   * a geographic tile (`geoTileKeyAt`) with `cells` along its side, null where the generator
   * gives none; with `heightsOnly`, its heights alone (`buildGeoReliefTile`'s)
   */
  load: (
    key: number,
    cells: number,
    heightsOnly?: boolean,
  ) => Promise<ReliefTile | null>;
};

/**
 * A {@link ReliefTileLoader} for `layers` over `base`, the same object while their content is
 * the same (layers written inline are new objects each render); null without layers or a
 * `GeneratorsProvider`.
 */
export function useReliefTileLoader(
  layers: readonly ReliefLayer[],
  base: number,
): ReliefTileLoader | null {
  const provided = useContext(GeneratorsContext) !== null;
  const generate = useGenerator<SceneryReliefTileResponse>(sceneryReliefTile);
  const layerKey = JSON.stringify(
    layers.map(({ id, feather }) => [id, feather ?? 0]),
  );
  return useMemo<ReliefTileLoader | null>(() => {
    const specs = JSON.parse(layerKey) as [string, number][];
    if (!specs.length || !provided) return null;
    const source: ReliefLayersSource = {
      layers: specs.map(([id, feather]) => (feather ? { id, feather } : { id })),
      base,
    };
    return {
      key: `${layerKey}:${base}`,
      base,
      load: (key, cells, heightsOnly) =>
        generate(source, key, cells, heightsOnly ?? false),
    };
    // Without a provider the generator is new each render, and there are no tiles: null.
  }, [provided, generate, layerKey, base]);
}
