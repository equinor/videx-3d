import { expose } from 'comlink';

import {
  sceneryRelief,
  sceneryReliefTile,
} from '../../../components/Scenery/scenery-defs';
import {
  generateSceneryRelief,
  generateSceneryReliefTile,
} from '../../../generators';
import { GeneratorRegistry } from '../../../sdk';

// The sky's generators on a worker of their own (see `SceneryGenerators`): a relief's tiles
// stream while a column builds on the other.

const registry = new GeneratorRegistry({ concurrentStoreCalls: 50 });

registry.add(sceneryRelief, generateSceneryRelief);
registry.add(sceneryReliefTile, generateSceneryReliefTile);

expose(registry);
