import { CRS, getProjectionDefFromUtmZone } from '../../sdk/projection/crs';
import { geoFrameFromCrs } from '../../sdk/projection/geo-frame';
import type { Vec2 } from '../../sdk/types/common';
import storyArgs from '../story-args.json';

/**
 * Where the demo field lies on the Earth: the CRS its `UtmArea` places it with. The sky's
 * place and the reliefs' frame are derived from it ({@link demoFrame}), so the three agree.
 */
export const demoCrs = new CRS(
  getProjectionDefFromUtmZone(storyArgs.utmZone),
  storyArgs.origin as Vec2,
  'utm',
);

/** The demo field's frame on the Earth: a `World`'s, or a stage relief's `frame`. */
export const demoFrame = geoFrameFromCrs(demoCrs);
