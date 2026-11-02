import type { ReliefSource } from '../../sdk/geometries/relief-tiles';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import type { GeoReliefProps } from '../Layers/GeoRelief';
import { sceneryDefaults, SceneryOceanProps } from './scenery-model';

/**
 * The relief a `GeoRelief` draws from tiles, as something built on it samples it — a
 * `ChunkStack`'s column for its top (`ChunkStackProps.relief`). Derived from the very
 * props given the relief and its sky, so the two agree. Its `key` follows its content: a
 * source built inline each render rebuilds nothing.
 *
 * @param relief the `GeoRelief`'s props, with its `World`'s `frame`
 * @param ocean the sky's `ocean`
 * @param margin how far above the relief what is built on it lies, in scene units
 * @returns undefined without layers: no relief is drawn then
 *
 * @group Components
 */
export function reliefSource(
  relief: Pick<GeoReliefProps, 'layers' | 'depth'> & { frame: GeoFrame },
  ocean: Pick<SceneryOceanProps, 'level' | 'depth'> = {},
  margin?: number,
): ReliefSource | undefined {
  if (!relief.layers.length) return undefined;
  const plain = {
    frame: relief.frame,
    layers: relief.layers.map(({ id, feather }) =>
      feather ? { id, feather } : { id },
    ),
    // As the stage's tiles: the flat seabed where no layer has data.
    base: -(relief.depth ?? ocean.depth ?? sceneryDefaults.ocean.depth),
    level: ocean.level ?? sceneryDefaults.ocean.level,
    margin,
  };
  return { ...plain, key: JSON.stringify(plain) };
}
