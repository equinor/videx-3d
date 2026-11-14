import {
  type IUniform,
  Matrix3,
  type Texture,
  Uniform,
  Vector3,
  Vector4,
} from 'three';

/**
 * The ground's height about the Earth, coarse, for what needs to know how high the ground or
 * how deep the sea is anywhere in view without the relief's tiles as drawn: the sea's surface
 * (how much of the seabed it lets through), the 3D clouds (what they rise over). A map of the
 * whole Earth, a finer one about the camera and a finer one still close to it, metres over the
 * sea, the seabed's below it; read at a world point by `ground-map.glsl`'s `groundMapHeight`.
 * Drawn by a `Scenery` from its `World`'s relief, and the scene's ({@link sceneGroundMap}).
 * Its uniforms are bound by reference: one change reaches every material reading them. For
 * what must meet the ground exactly (a layer draped on it), the relief's tiles as drawn.
 *
 * @group Materials
 */
export class GroundMap {
  readonly uniforms: {
    uGroundEarth: IUniform<Texture | null>;
    uGroundEarthFromWorld: IUniform<Matrix3>;
    uGroundNear: IUniform<Texture | null>;
    uGroundNearFromWorld: IUniform<Matrix3>;
    uGroundFine: IUniform<Texture | null>;
    uGroundFineFromWorld: IUniform<Matrix3>;
    uGroundCentre: IUniform<Vector4>;
    uGroundUp: IUniform<Vector3>;
    uGround: IUniform<Vector4>;
  } = {
    uGroundEarth: new Uniform<Texture | null>(null),
    uGroundEarthFromWorld: new Uniform(new Matrix3()),
    uGroundNear: new Uniform<Texture | null>(null),
    uGroundNearFromWorld: new Uniform(new Matrix3()),
    uGroundFine: new Uniform<Texture | null>(null),
    uGroundFineFromWorld: new Uniform(new Matrix3()),
    uGroundCentre: new Uniform(new Vector4()),
    uGroundUp: new Uniform(new Vector3(0, 1, 0)),
    uGround: new Uniform(new Vector4()),
  };

  /** whether any of its maps is drawn */
  get drawn(): boolean {
    const { x, y, z } = this.uniforms.uGround.value;
    return x + y + z > 0.5;
  }

  /** Bind these uniforms, by reference, into a material's `uniforms`. */
  bind(uniforms: Record<string, IUniform>): void {
    Object.assign(uniforms, this.uniforms);
  }

  /** Take `from`'s maps, every value (`null`: none). */
  copyFrom(from: GroundMap | null): void {
    const a = this.uniforms;
    if (!from) {
      a.uGround.value.set(0, 0, 0, 0);
      a.uGroundEarth.value = null;
      a.uGroundNear.value = null;
      a.uGroundFine.value = null;
      return;
    }
    const b = from.uniforms;
    a.uGroundEarth.value = b.uGroundEarth.value;
    a.uGroundEarthFromWorld.value.copy(b.uGroundEarthFromWorld.value);
    a.uGroundNear.value = b.uGroundNear.value;
    a.uGroundNearFromWorld.value.copy(b.uGroundNearFromWorld.value);
    a.uGroundFine.value = b.uGroundFine.value;
    a.uGroundFineFromWorld.value.copy(b.uGroundFineFromWorld.value);
    a.uGroundCentre.value.copy(b.uGroundCentre.value);
    a.uGroundUp.value.copy(b.uGroundUp.value);
    a.uGround.value.copy(b.uGround.value);
  }
}

const SCENE_GROUND = new WeakMap<object, { map: GroundMap; owner: unknown }>();

/**
 * The ground of a scene (one per scene): the {@link GroundMap} a `Scenery` with a relief
 * draws, or `null` while none does. What lies in the scene's seas reads its seabed from it
 * where they have no map of their own.
 *
 * @group Materials
 */
export function sceneGroundMap(scene: object): GroundMap | null {
  return SCENE_GROUND.get(scene)?.map ?? null;
}

/**
 * Make `map` the scene's ground ({@link sceneGroundMap}), as `owner`'s; `null` lets go of it,
 * if `owner` holds it.
 *
 * @group Materials
 */
export function setSceneGroundMap(
  scene: object,
  map: GroundMap | null,
  owner: unknown,
): void {
  const held = SCENE_GROUND.get(scene);
  if (map) SCENE_GROUND.set(scene, { map, owner });
  else if (held?.owner === owner) SCENE_GROUND.delete(scene);
}
