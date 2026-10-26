import { expose } from 'comlink';

import { skyRelief, skyReliefTile } from '../../../components/Sky/sky-defs';
import { generateSkyRelief, generateSkyReliefTile } from '../../../generators';
import { GeneratorRegistry } from '../../../sdk';

// The sky's generators on a worker of their own (see `SkyGenerators`): a relief's tiles
// stream while a column builds on the other.

const registry = new GeneratorRegistry({ concurrentStoreCalls: 50 });

registry.add(skyRelief, generateSkyRelief);
registry.add(skyReliefTile, generateSkyReliefTile);

expose(registry);
