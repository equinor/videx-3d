import { CRS, getProjectionDefFromUtmZone } from '../../sdk/projection/crs';
import type { Vec2 } from '../../sdk/types/common';
import storyArgs from '../story-args.json';

/**
 * Where the demo field lies on the Earth: the CRS its `UtmArea` places it with. The sky's
 * place (`crsOriginLocation`) and the reliefs' frame (`reliefFrameFromCrs`) are derived
 * from it, so the three agree.
 */
export const demoCrs = new CRS(
  getProjectionDefFromUtmZone(storyArgs.utmZone),
  storyArgs.origin as Vec2,
  'utm',
);
