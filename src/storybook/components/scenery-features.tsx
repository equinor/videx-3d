import { SceneryAbyss } from '../../components/Scenery/SceneryAbyss';
import { SceneryClouds } from '../../components/Scenery/SceneryClouds';
import { SceneryCutaway } from '../../components/Scenery/SceneryCutaway';
import { SceneryOcean } from '../../components/Scenery/SceneryOcean';
import type {
  SceneryAbyssProps,
  SceneryOceanProps,
} from '../../components/Scenery/scenery-model';
import {
  SceneryArgs,
  sceneryAbyssFromArgs,
  sceneryCloudsFromArgs,
  sceneryOceanFromArgs,
} from './scenery-controls';
import { sceneryCutawayFromArgs } from './scenery-cutaway-controls';

/**
 * A story's scenery features from its {@link SceneryArgs}, under its `<Scenery>`: the clouds
 * and the cutaway as the args set them, and the sea and the void with what only the story
 * knows (their levels, a seabed of its own) laid over the args'. `false` leaves one out.
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
  const cutaway = sceneryCutawayFromArgs(args);
  return (
    <>
      {clouds && <SceneryClouds {...clouds} />}
      {ocean && <SceneryOcean {...sceneryOceanFromArgs(args)} {...ocean} />}
      {abyss && <SceneryAbyss {...sceneryAbyssFromArgs(args)} {...abyss} />}
      {cutaway && <SceneryCutaway {...cutaway} />}
    </>
  );
};
