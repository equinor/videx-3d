import { Minimap } from '../../components/Html/Minimap/Minimap';
import { MinimapCameraMarker } from '../../components/Html/Minimap/MinimapLayers';
import { SceneryAbyss } from '../../components/Scenery/SceneryAbyss';
import { SceneryClouds } from '../../components/Scenery/SceneryClouds';
import { SceneryCutaway } from '../../components/Scenery/SceneryCutaway';
import { SceneryGraticule } from '../../components/Scenery/SceneryGraticule';
import { SceneryOcean } from '../../components/Scenery/SceneryOcean';
import type {
  SceneryAbyssProps,
  SceneryOceanProps,
} from '../../components/Scenery/scenery-model';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import {
  SceneryArgs,
  sceneryAbyssFromArgs,
  sceneryCloudsFromArgs,
  sceneryGraticuleFromArgs,
  sceneryMinimapLayers,
  sceneryOceanFromArgs,
} from './scenery-controls';
import { sceneryCutawayFromArgs } from './scenery-cutaway-controls';

/**
 * A story's scenery features from its {@link SceneryArgs}, under its `<Scenery>`: the clouds,
 * the graticule and the cutaway as the args set them, and the sea and the void with what
 * only the story knows (their levels, a seabed of its own) laid over the args'. `false`
 * leaves one out.
 */
export const SceneryArgsFeatures = ({
  args,
  ocean,
  abyss,
}: {
  args: SceneryArgs;
  ocean: Partial<SceneryOceanProps> | false;
  abyss: Partial<SceneryAbyssProps> | false;
}) => {
  const clouds = sceneryCloudsFromArgs(args);
  const graticule = sceneryGraticuleFromArgs(args);
  const cutaway = sceneryCutawayFromArgs(args);
  return (
    <>
      {clouds && <SceneryClouds {...clouds} />}
      {graticule && <SceneryGraticule {...graticule} />}
      {ocean && <SceneryOcean {...sceneryOceanFromArgs(args)} {...ocean} />}
      {abyss && <SceneryAbyss {...sceneryAbyssFromArgs(args)} {...abyss} />}
      {cutaway && <SceneryCutaway {...cutaway} />}
    </>
  );
};

/**
 * A story's minimap (see `sceneryMinimapArgs`): the `Minimap`'s defaults and a camera marker,
 * over the demo reliefs ticked in `reliefLayers` (all by default), in the story's `frame`,
 * its heights over the sea at `level` (the sea's Y; default 0).
 * Inside the `Canvas` and a `GeneratorsProvider` with the `sceneryReliefTile` generator.
 */
export const SceneryArgsMinimap = ({
  frame,
  reliefLayers,
  level,
}: {
  frame: GeoFrame;
  reliefLayers?: string[];
  level?: number;
}) => (
  <Minimap
    layers={sceneryMinimapLayers(reliefLayers)}
    frame={frame}
    level={level}
  >
    <MinimapCameraMarker />
  </Minimap>
);
