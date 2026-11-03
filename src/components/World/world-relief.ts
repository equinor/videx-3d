import { createContext, useContext } from 'react';
import type { Boundary } from '../../sdk/geometries/boundary';
import type { HeightFieldClip } from '../../sdk/materials/height-field-clip';
import type { SceneryOceanState } from '../Scenery/scenery-context';
import type { SceneryReliefHub } from '../Scenery/scenery-relief-hub';
import type { SceneryReliefTileOccupants } from '../Scenery/scenery-relief-tiles';

/**
 * A region of world X/Z, `[minX, minZ, maxX, maxZ]`, the relief hands out its ground over as
 * drawn (a stage's occupant, say): told it as a `HeightFieldClip`, and null once there is none.
 */
export type WorldReliefGroundRequest = {
  bounds: [number, number, number, number];
  onGround: (clip: HeightFieldClip | null) => void;
};

/**
 * What the anchored stage (a `SceneryStage`) asks of the relief: what only a stage has.
 */
export type WorldReliefStage = {
  /** the stage's area, world X/Z: see-through over it with `seeThrough`; null for a stage with none */
  boundary: Boundary | null;
  /** the sea's seabed is see-through (its `seabedOpacity` below 1): so is the relief over `boundary` */
  seeThrough: boolean;
  /** the occupants' outlines, and the cut of one of them (see `SceneryReliefTileOccupants`) */
  occupants?: SceneryReliefTileOccupants;
  /** the ground handed out over each occupant that asks for it */
  grounds: WorldReliefGroundRequest[];
  /** the ground is drawn for the occupants: the clips are live only while it is */
  groundLive: boolean;
};

/**
 * The relief of a {@link World}: Earth data, drawn by a `GeoRelief` anywhere inside it, with or
 * without a `Scenery`, and what it shares with what lies on it and around it.
 */
export type WorldReliefState = {
  /** the relief tiles drawn, as drawn: what a layer lying on the ground meets (a `GeoTileLayer`'s `drape`). Stable */
  tiles: SceneryReliefHub;
  /** the relief's ground under the camera, world Y, written each frame it is drawn; null where none is in. Stable */
  ground: { current: number | null };
  /** a `GeoRelief` with layers is in the world */
  present: boolean;
  /** the sky that shades it, a `Scenery`'s ocean: null without one */
  sky: SceneryOceanState | null;
  /** the anchored stage's part, null without a `SceneryStage` */
  stage: WorldReliefStage | null;
  /** A `GeoRelief` with layers tells it is there; returns the release. */
  addRelief: () => () => void;
  /** A `Scenery` with a sea offers it to shade the relief with; returns the release. */
  provideSky: (sky: SceneryOceanState) => () => void;
  /** A `SceneryStage` hands over its part; again whenever it changes. Returns the release. */
  provideStage: (stage: WorldReliefStage) => () => void;
};

export const WorldReliefContext = createContext<WorldReliefState | null>(null);

/** The relief of the enclosing {@link World}, or `null` outside one. */
export function useWorldRelief() {
  return useContext(WorldReliefContext);
}
