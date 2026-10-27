import { createContext, useContext } from 'react';
import { Color, Object3D, Vector3 } from 'three';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import type { SceneryMaterial } from './scenery-material';
import type { SceneryReliefLoading } from './scenery-progress';

/**
 * What a {@link Scenery} shares with its children.
 */
export type SceneryState = {
  /** world-space direction toward the sun, normalised */
  sunDirection: Vector3;
  sunColor: Color;
  /** 0 (night) to 1 (day) */
  daylight: number;
  /** 0 to 1 about sunrise and sunset: how much the horizon glows (`skyTwilight`) */
  twilight: number;
  /** world-space direction toward the moon, normalised: opposite the sun, or where an observer sees it */
  moonDirection: Vector3;
  /** 0 (day, and dusk) to 1 (night): how much the moon lights the scene — with an observer, as its phase and height allow */
  moonlight: number;
  /** share of the moon's disc lit, 0 (new) to 1 (full); always 1 without an observer */
  moonPhase: number;
};

export const SceneryContext = createContext<SceneryState | null>(null);

/**
 * The sun of the enclosing {@link Scenery}, or `null` when there is none. The sky is
 * optional: a consumer must fall back to its own settings without one.
 */
export function useScenery() {
  return useContext(SceneryContext);
}

/**
 * The sea of the enclosing {@link Scenery}, which a stage draws on real geometry.
 */
export type SceneryOceanState = {
  /** the sky's material: its uniforms are the sea's */
  material: SceneryMaterial;
  /** the sky's `renderOrder`; its sea surface layer draws at the next one */
  renderOrder: number;
  /** the sea has water; without it the seabed lies dry */
  water: boolean;
  /** the sea has a seabed; without it the void lies below the water */
  seabed: boolean;
  /** how much of what lies beyond the seabed it hides, 0 to 1 (see `SceneryOceanProps.seabedOpacity`) */
  seabedOpacity: number;
  /** the seabed's detail, as a key: a new one recompiles the sea (see `SceneryMaterial.oceanBedDetail`) */
  bedDetail: string;
  /** the void has walls (see `SceneryAbyssProps.walls`): a stage's seabed recompiles to leave them to the sky */
  abyssWalls: boolean;
  /** height of the sea surface along `up` */
  level: number;
  /** depth of the seabed below the surface */
  depth: number;
  /** the sky is drawn (its `background`): a stage is drawn with it */
  visible: boolean;
  /** the sky's shaders, and its stages', are compiled: until then a stage draws nothing */
  ready: boolean;
  /**
   * Hand the sky a stage's parts (no lights among them), compiled with its own before
   * either is drawn; again whenever they change. Returns the release.
   */
  stage: (parts: Object3D) => () => void;
  /** tell the sky how a stage's relief tiles load (its `onProgress`), keyed by anything the stage keeps; null once gone */
  relief: (key: object, loading: SceneryReliefLoading | null) => void;
  /**
   * Tell the sky the frame a stage reads its relief in, outside a `World`; null once gone.
   * The sky's globe then lies on the Earth there, and its true north and an observer's
   * place are that frame's, as a `World`'s would be. Stable.
   */
  frame: (frame: GeoFrame | null) => void;
};

export const SceneryOceanContext = createContext<SceneryOceanState | null>(
  null,
);

/** The sea of the enclosing {@link Scenery}, or `null` when it has none. */
export function useSceneryOcean() {
  return useContext(SceneryOceanContext);
}
