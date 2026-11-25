import { createContext, useContext } from 'react';
import type { Boundary } from '../../sdk/geometries/boundary';
import type { HeightFieldClip } from '../../sdk/materials/height-field-clip';
import type { ReliefTileLoader } from '../Layers/relief-tile-loader';
import type { ScenerySeaState } from '../Scenery/scenery-context';
import type { SceneryReliefHub } from '../Scenery/scenery-relief-hub';
import type { ReliefSeabed } from '../Scenery/scenery-relief-look';
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
  /** the relief's seabed is see-through over the fields (its `fieldOpacity` below 1): so is it over `boundary` */
  seeThrough: boolean;
  /** the occupants' outlines, and the cut of one of them (see `SceneryReliefTileOccupants`) */
  occupants?: SceneryReliefTileOccupants;
  /** the ground handed out over each occupant that asks for it */
  grounds: WorldReliefGroundRequest[];
  /** the ground is drawn for the occupants: the clips are live only while it is */
  groundLive: boolean;
};

/**
 * The ground a `GeoRelief` gives the {@link World}, flat where it has no data: what a `Scenery`
 * takes its seabed from. None while the relief is hidden (`visible` false) or absent: then the
 * void lies below the sea's water.
 */
export type WorldReliefGround = {
  /** the seabed's look, as given (`GeoRelief`'s `seabed`; defaults `sceneryDefaults.relief.seabed`) */
  seabed: ReliefSeabed;
  /** how much of what lies beneath it over the fields it hides, 0 to 1 (`GeoRelief`'s `fieldOpacity`) */
  fieldOpacity: number;
};

/**
 * The relief of a {@link World}: Earth data, drawn by a `GeoRelief` anywhere inside it, with or
 * without a `Scenery`, and what it shares with what lies on it and around it.
 */
export type WorldReliefState = {
  /** the relief tiles drawn, as drawn: what a layer lying on the ground meets (a `GeoTileLayer`'s `drape`). Stable */
  tiles: SceneryReliefHub;
  /** a `GeoRelief` draws tiles in the world: it has layers, or no `Scenery` draws its flat seabed */
  present: boolean;
  /** the ground of the world's `GeoRelief` while it is shown, null without one */
  ground: WorldReliefGround | null;
  /** the sky that shades it, a `Scenery`'s ocean: null without one */
  scenery: ScenerySeaState | null;
  /** the anchored stage's part, null without a `SceneryStage` */
  stage: WorldReliefStage | null;
  /**
   * its tiles on demand, as its `GeoRelief` merges them: for what samples the same ground
   * elsewhere (the clouds' terrain). Null without a relief with layers, or a generator
   */
  loader: ReliefTileLoader | null;
  /** A `GeoRelief` that draws tiles tells it is there; returns the release. */
  addRelief: () => () => void;
  /** A shown `GeoRelief` hands over its ground; again whenever it changes. Returns the release. */
  provideGround: (ground: WorldReliefGround) => () => void;
  /** A `Scenery` with a sea offers it to shade the relief with; returns the release. */
  provideScenery: (scenery: ScenerySeaState) => () => void;
  /** A `SceneryStage` hands over its part; again whenever it changes. Returns the release. */
  provideStage: (stage: WorldReliefStage) => () => void;
  /** A `GeoRelief` hands over its tiles' loader; again whenever it changes. Returns the release. */
  provideLoader: (loader: ReliefTileLoader) => () => void;
};

export const WorldReliefContext = createContext<WorldReliefState | null>(null);

/** The relief of the enclosing {@link World}, or `null` outside one. */
export function useWorldRelief() {
  return useContext(WorldReliefContext);
}
