import { createContext, useContext } from 'react';
import { Color, Object3D, Vector3 } from 'three';
import type { WaterFogUniforms } from '../../sdk/materials/water-fog';
import type { SkyMaterial } from './sky-material';

/**
 * What a {@link Sky} shares with its children.
 */
export type SkyState = {
  /** world-space direction toward the sun, normalised */
  sunDirection: Vector3;
  sunColor: Color;
  /** 0 (night) to 1 (day) */
  daylight: number;
  /** world-space direction toward the moon, normalised: opposite the sun */
  moonDirection: Vector3;
  /** 0 (day, and dusk) to 1 (night): how much the moon lights the scene */
  moonlight: number;
};

export const SkyContext = createContext<SkyState | null>(null);

/**
 * The sun of the enclosing {@link Sky}, or `null` when there is none. The sky is
 * optional: a consumer must fall back to its own settings without one.
 */
export function useSky() {
  return useContext(SkyContext);
}

/**
 * The sea of the enclosing {@link Sky}, which a stage draws on real geometry.
 */
export type SkyOceanState = {
  /** the sky's material: its uniforms are the sea's */
  material: SkyMaterial;
  /** the sea has water; without it the seabed lies dry */
  water: boolean;
  /** the sea has a seabed; without it the void lies below the water */
  seabed: boolean;
  /** the seabed's detail, as a key: a new one recompiles the sea (see `SkyMaterial.oceanBedDetail`) */
  bedDetail: string;
  /** the sea's water, for fogging what lies in it as the sea fogs its own seabed (see {@link useSkyWaterFog}) */
  fog: WaterFogUniforms;
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
};

export const SkyOceanContext = createContext<SkyOceanState | null>(null);

/** The sea of the enclosing {@link Sky}, or `null` when it has none. */
export function useSkyOcean() {
  return useContext(SkyOceanContext);
}

/**
 * The water of the enclosing {@link Sky}'s sea, or `null` when it has none: hand it to
 * `ChunkStack`'s `waterFog` and the column is fogged as the sea's own seabed is. The
 * uniforms follow the sky, and keep their identity while it has a sea; while the sky is
 * not drawn (`background`) the fog is off.
 *
 * ⚠️ Fogs wherever the sea has water, so leave it off a stage occupant that drains
 * its water (`SkyBoxStage`'s `occupant.water: false`).
 */
export function useSkyWaterFog() {
  return useContext(SkyOceanContext)?.fog ?? null;
}
