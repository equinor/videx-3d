import { RefObject, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Color,
  ColorRepresentation,
  FogExp2,
  Group,
  Matrix4,
  Vector3,
} from 'three';

/** What the camera is standing in, as {@link useImmersionFog} needs it. */
export type ImmersionMedium = {
  /** what everything fades toward */
  color: ColorRepresentation;
  /** per-metre build-up */
  density: number;
  /** 0..1, how far inside the medium the camera is — ramps it in at a boundary */
  amount: number;
};

/** {@link useImmersionFog} options. */
export type ImmersionFogOptions = {
  /**
   * What the camera is inside of, in `frame`'s space, or `null` for open air.
   * Called once per frame.
   */
  medium: (x: number, y: number, z: number) => ImmersionMedium | null;
  /**
   * The frame `medium` takes its coordinates in. Omit when that is world space.
   *
   * ⚠️ A `ChunkStack` may carry a vertical exaggeration, which moves everything in
   * world space while leaving the stack's own coordinates unchanged.
   */
  frame?: RefObject<Group | null>;
  /**
   * Take the scene's background to the medium's colour as well. Default true.
   *
   * ⚠️ Fogged geometry against an unfogged background is the classic mismatch —
   * the fog colour and the background have to agree or the fog reads as a haze
   * hanging in the room. Turning this off means setting your background yourself.
   */
  background?: boolean;
  /** seconds for the fog to catch up with a step change. Default 0.12 */
  settle?: number;
};

/**
 * Fog everything the camera sees while it is INSIDE something — water, or a
 * sediment volume.
 *
 * ⭐ The problem it solves: a sea, and a chunk, are made of SURFACES rather than of
 * a medium. From outside, every sightline into one crosses a surface and picks up
 * its attenuation, which is why looking in through the sea's lid or its walls both
 * read correctly. From INSIDE there is no surface in the path at all, so everything
 * is drawn at full clarity however far away it is.
 *
 * ⭐ Scene fog is the cheap answer because it attenuates by DISTANCE FROM THE
 * CAMERA, which is the quantity that matters inside a volume and the one nothing
 * else here measures. A depth-driven tint cannot stand in for it: that is a
 * function of the fragment's own height, which is right for looking down through a
 * water column and wrong for looking sideways through it. It also reaches host
 * geometry — vessels, facilities, pipelines — that no material of ours could.
 *
 * ⚠️ Only materials with `fog` enabled are affected. Stock three materials have it
 * on by default; a `ShaderMaterial` does NOT, so a library material must both set
 * `fog = true` and include the fog shader chunks. ⚠️⚠️ And a `ShaderMaterial` whose
 * uniforms are hand-built rather than merged from a `ShaderLib` entry must add
 * `UniformsLib.fog`, or three throws inside `refreshFogUniforms`.
 *
 * ⚠️ Mount this only while the effect is wanted. Installing `scene.fog` at all
 * changes every material's program cache key, so an always-mounted "disabled"
 * version would not be free.
 */
export function useImmersionFog({
  medium,
  frame,
  background = true,
  settle = 0.12,
}: ImmersionFogOptions) {
  const scene = useThree(state => state.scene);
  const gl = useThree(state => state.gl);
  const fog = useMemo(() => new FogExp2(0x000000, 0), []);
  const eye = useMemo(() => new Vector3(), []);
  const inverse = useMemo(() => new Matrix4(), []);
  const target = useMemo(() => new Color(), []);
  // The background this fades out of: the host's own colour, or the clear colour
  // when it had none. ⚠️ A texture or cube map cannot be interpolated, so that case
  // stays a swap.
  const base = useMemo(() => new Color(), []);
  const blended = useMemo(() => new Color(), []);
  const host = useRef<{
    fog: typeof scene.fog;
    background: typeof scene.background;
    lerpable: boolean;
  } | null>(null);
  const owns = useRef(false);
  const presence = useRef(0);
  const strength = useRef(0);

  useEffect(() => {
    const previous = { fog: scene.fog, background: scene.background };
    const lerpable =
      previous.background === null || previous.background instanceof Color;
    if (previous.background instanceof Color) base.copy(previous.background);
    else gl.getClearColor(base);
    host.current = { ...previous, lerpable };
    scene.fog = fog;
    return () => {
      scene.fog = previous.fog;
      if (owns.current) scene.background = previous.background;
      host.current = null;
      owns.current = false;
      presence.current = 0;
      strength.current = 0;
    };
  }, [scene, gl, fog, base]);

  useFrame(({ camera }, delta) => {
    if (!host.current) return;

    camera.getWorldPosition(eye);
    const root = frame?.current;
    if (root) {
      root.updateWorldMatrix(true, false);
      eye.applyMatrix4(inverse.copy(root.matrixWorld).invert());
    }

    const inside = medium(eye.x, eye.y, eye.z);

    // ⚠️ Damped rather than applied directly. A medium's own boundaries give smooth
    // ramps, but leaving one sideways — past the edge of the drawn footprint, or
    // through a section plane — is a hard boundary with no distance to ramp over.
    const k = 1 - Math.exp(-delta / Math.max(settle, 1e-3));
    presence.current += ((inside ? inside.amount : 0) - presence.current) * k;
    strength.current +=
      ((inside ? inside.density * inside.amount : 0) - strength.current) * k;
    if (inside) fog.color.lerp(target.set(inside.color), k);

    const p = presence.current < 1e-3 ? 0 : presence.current;
    fog.density = strength.current;

    if (!background) return;
    if (p <= 0) {
      if (owns.current) {
        scene.background = host.current.background;
        owns.current = false;
      }
      return;
    }
    if (!owns.current) {
      scene.background = blended;
      owns.current = true;
    }
    // ⭐ Interpolated, so leaving a medium fades the background out with the fog
    // instead of snapping once the density crosses zero.
    if (host.current.lerpable) blended.copy(base).lerp(fog.color, p);
    else blended.copy(fog.color);
  });
}
