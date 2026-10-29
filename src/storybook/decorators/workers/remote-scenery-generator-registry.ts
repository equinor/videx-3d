import { expose } from 'comlink';

import { sceneryReliefTile } from '../../../components/Scenery/scenery-defs';
import { overlayTile } from '../../../components/Layers/layer-defs';
import {
  generateOverlayTile,
  generateSceneryReliefTile,
} from '../../../generators';
import { GeneratorRegistry } from '../../../sdk';

// The sky's generators on a worker of their own (see `SceneryGenerators`): a relief's tiles
// stream while a column builds on the other. The overlays' tiles stream beside them.

const registry = new GeneratorRegistry({ concurrentStoreCalls: 50 });

registry.add(sceneryReliefTile, generateSceneryReliefTile);
registry.add(overlayTile, generateOverlayTile);

expose(registry);
