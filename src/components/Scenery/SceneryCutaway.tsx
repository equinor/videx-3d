import { useThree } from '@react-three/fiber';
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Color,
  ColorRepresentation,
  MathUtils,
  PerspectiveCamera,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { SceneryCutawayHandle } from './scenery-cutaway-handle';
import {
  SceneryCutawayFeature,
  SceneryCutawayFrame,
  SceneryRegistryContext,
  useSceneryFeature,
} from './scenery-registry';
/** A wave along a {@link SceneryCutawayProps}'s edge. */
export type SceneryCutawayWave = {
  /** how far the edge swings ahead and back, relative to the frame's half-width at the edge; it levels out as the cut shrinks in the frame (see `SceneryCutawayProps.zoomFollow`). Default 0 */
  amplitude?: number;
  /** waves across the frame's width. Default 1 */
  frequency?: number;
  /** where along the edge the wave starts, in waves. Default 0 */
  phase?: number;
};

/**
 * A cut through the sea's water (as much of it as `water` says) and seabed (unless `seabed`
 * is false) in front of the view, so what lies under it is seen clearly: everything nearer
 * than a line across the view, where a row of the frame meets the surface (or the seabed,
 * with the camera in the water or the sea dry). Waves bend the line, a rim marks it on the
 * surface and a shadow falls just inside it. It follows the camera. An occupant and the data
 * are never cut.
 */
export type SceneryCutawayProps = {
  /** how much of the water it cuts: 1 all, 0 none, 0.5 half of it. Default 1 */
  water?: number;
  /** cut the seabed too; for a see-through seabed, set the sea's `seabedOpacity` instead. Default true */
  seabed?: boolean;
  /** the frame row whose sight line sets the edge looking level: 0 the bottom, 1 the top. Tilting down raises it to the top, looking straight down. Default 0.5 */
  reach?: number;
  /** moves the edge ahead (+) or back (−) of where `reach` puts it, relative to the frame's half-width at the edge, so it keeps its proportions through a zoom or tilt. Default 0 */
  offset?: number;
  /** a grip on the rim, in the middle of the view, that drags the edge (see `offset`); a double click or tap puts it back. Default false */
  handle?: boolean;
  /** called with the new `offset` when a drag of the grip ends, and on a reset. The sky keeps the dragged offset until `offset` changes */
  onOffsetChange?: (offset: number) => void;
  /** the downward tilt, in degrees, from which the edge slides up out of the view, gone looking straight down. Default 45 */
  exitTilt?: number;
  /** width of the edge's fade, relative to the frame's half-width at the edge. Default 0.01 */
  softness?: number;
  /** waves bending the edge; the first two are used. Default an S across the frame */
  waves?: SceneryCutawayWave[];
  /** the line along the edge, on the surface: its colour, and width in pixels (0 for none), thinning toward 1 as the cut shrinks in the frame. Default white, 3 */
  rim?: { color?: ColorRepresentation; width?: number };
  /** the shadow just inside the edge, over what shows through: its opacity, and width relative to the frame's half-width at the edge. Default 0.5, 0.15 */
  shadow?: { opacity?: number; width?: number };
  /** seconds for its size to settle after a zoom or tilt; 0 follows the camera exactly. Default 0 */
  ease?: number;
  /**
   * How much of a zoom its size follows on screen: 1 keeps it fixed in the frame, 0 fixed in
   * the world. It has its frame size with the camera `reference` high over it. Default 0.5
   */
  zoomFollow?: number;
  /** the camera height at which it has its frame size (see `zoomFollow`), in world units. Default half the width of a stage's occupant; without one, it stays fixed in the frame */
  reference?: number;
};

const DEFAULT_CUTAWAY_WAVES: SceneryCutawayWave[] = [
  { amplitude: 0.12, frequency: 1, phase: 0 },
  { amplitude: 0.04, frequency: 2.6, phase: 0.3 },
];

// A wave as the shader takes it, for a frame `frame` from its centre to its side and a
// cut `far` (<= 1) of its frame size.
function setCutawayWave(
  target: Vector3,
  wave: SceneryCutawayWave | undefined,
  frame: number,
  far: number,
) {
  const { amplitude = 0, frequency = 1, phase = 0 } = wave ?? {};
  target.set(
    amplitude * frame * far,
    (Math.PI * frequency) / frame,
    2 * Math.PI * phase,
  );
}

// How far ahead of its anchor the edge runs, `side` across its heading (see waterFogCutawayEdge).
function cutawayEdgeAhead(side: number, reach: number, a: Vector3, b: Vector3) {
  return (
    reach + a.x * Math.sin(a.y * side + a.z) + b.x * Math.sin(b.y * side + b.z)
  );
}

// Narrowest edge, in world units: a fade of none is undefined in the shader.
const CUTAWAY_MIN_EDGE = 0.01;
// The cutaway's tip row never looks flatter than this (sine; about 0.6° below the horizon).
const CUTAWAY_MIN_DOWN = 0.01;
// Past the frame's top, for the rim and its antialiasing: of the frame's half-width there.
const CUTAWAY_EXIT_MARGIN = 0.05;

const scratch = new Color();
// Primitive dependency for a colour prop, so an inline `new Color()` does nothing each render.
const toHex = (value: ColorRepresentation) => scratch.set(value).getHex();

/**
 * A cut through the sea of a {@link Scenery} (its `SceneryOcean`) in front of the view (see
 * {@link SceneryCutawayProps}). It follows the camera; its grip, with `handle`, drags it.
 * Anywhere under the `Scenery`; without a sea it cuts nothing.
 *
 * @example
 * <Scenery>
 *   <SceneryOcean depth={120} />
 *   <SceneryCutaway water={1} handle />
 * </Scenery>
 *
 * @group Components
 */
export const SceneryCutaway = (props: SceneryCutawayProps) => {
  const gl = useThree(state => state.gl);
  const getThree = useThree(state => state.get);
  const material = useContext(SceneryRegistryContext)?.material ?? null;
  const cutawayOptions = props;
  const cutawayWater = MathUtils.clamp(cutawayOptions.water ?? 1, 0, 1);
  const cutawaySeabed = cutawayOptions.seabed ?? true;
  const cutawayReach = MathUtils.clamp(cutawayOptions.reach ?? 0.5, 0, 1);
  const cutawayExitTilt = MathUtils.clamp(cutawayOptions.exitTilt ?? 45, 0, 90);
  const cutawaySoftness = Math.max(cutawayOptions.softness ?? 0.01, 0);
  const cutawayWaves = cutawayOptions.waves ?? DEFAULT_CUTAWAY_WAVES;
  const cutawayRimHex = toHex(cutawayOptions.rim?.color ?? '#ffffff');
  const cutawayRimColor = useMemo(
    () => new Color(cutawayRimHex),
    [cutawayRimHex],
  );
  const cutawayRimWidth = Math.max(cutawayOptions.rim?.width ?? 3, 0);
  const cutawayShadowOpacity = MathUtils.clamp(
    cutawayOptions.shadow?.opacity ?? 0.5,
    0,
    1,
  );
  const cutawayShadowWidth = Math.max(cutawayOptions.shadow?.width ?? 0.15, 0);
  const cutawayEase = Math.max(cutawayOptions.ease ?? 0, 0);
  const cutawayZoomFollow = MathUtils.clamp(
    cutawayOptions.zoomFollow ?? 0.5,
    0,
    1,
  );
  const cutawaySize = useRef({
    reach: 0,
    width: 0,
    frame: 0,
    shift: 0,
    plane: 0,
    active: false,
    // This frame's edge without its offset, the offset's unit, and the slide-out holding the
    // edge past `floor`, for the grip.
    base: 0,
    unit: 1,
    exit: 0,
    floor: 0,
  });
  const [cutawayRay] = useState(() => new Vector3());
  const [cutawayScratch] = useState(() => ({
    a: new Vector3(),
    b: new Vector3(),
    side: new Vector3(),
  }));

  const cutawayOffset = cutawayOptions.offset ?? 0;
  const cutawayHandleOn = !!cutawayOptions.handle;
  const cutawayGrip = useRef<SceneryCutawayHandle | null>(null);
  // The dragged offset, kept until `offset` changes.
  const cutawayDragged = useRef<number | null>(null);
  const onCutawayOffset = useRef(cutawayOptions.onOffsetChange);
  useLayoutEffect(() => {
    onCutawayOffset.current = cutawayOptions.onOffsetChange;
  });
  useEffect(() => {
    if (!cutawayGrip.current?.active) cutawayDragged.current = null;
  }, [cutawayOffset]);

  useEffect(() => {
    if (!cutawayHandleOn || !material) return;
    const canvas = gl.domElement;
    const { a, b, side } = cutawayScratch;
    // The offset that puts the edge under client point `x`, `y`, where its sight line comes
    // down to the cut's plane.
    const offsetAt = (x: number, y: number) => {
      const size = cutawaySize.current;
      if (!size.active) return null;
      const { camera } = getThree();
      const skyUp = material.up;
      const altitude = camera.position.dot(skyUp) - size.plane;
      const box = canvas.getBoundingClientRect();
      const ray = a
        .set(
          ((x - box.left) / box.width) * 2 - 1,
          1 - ((y - box.top) / box.height) * 2,
          0.5,
        )
        .unproject(camera)
        .sub(camera.position)
        .normalize();
      const down = -ray.dot(skyUp);
      if (altitude <= 0 || down <= 0) return null;
      const anchor = material.uniforms.uSkyOceanCutawayAnchor.value as Vector3;
      const heading = material.uniforms.uSkyOceanCutawayHeading
        .value as Vector3;
      const point = b
        .copy(camera.position)
        .addScaledVector(ray, altitude / Math.max(down, CUTAWAY_MIN_DOWN))
        .sub(anchor);
      const wave = cutawayEdgeAhead(
        point.dot(side.crossVectors(heading, skyUp)),
        0,
        material.uniforms.uSkyOceanCutawayWaveA.value,
        material.uniforms.uSkyOceanCutawayWaveB.value,
      );
      let edge = point.dot(heading) - wave;
      // Sliding out, the edge is eased toward `floor` from below it (see the frame): undone.
      if (size.exit > 0 && edge < size.floor) {
        if (size.exit >= 1) return null;
        edge = (edge - size.floor * size.exit) / (1 - size.exit);
      }
      const offset = (edge - size.base) / size.unit;
      // No nearer than straight below the camera.
      return Math.max(offset, (-size.shift - size.base) / size.unit);
    };
    // Reported once a drag ends: reports on the way would come back as props behind it.
    let dragged = false;
    const grip = new SceneryCutawayHandle(
      canvas.parentElement ?? document.body,
      {
        drag: (x, y) => {
          const offset = offsetAt(x, y);
          if (offset === null) return;
          cutawayDragged.current = offset;
          dragged = true;
        },
        release: () => {
          if (!dragged || cutawayDragged.current === null) return;
          dragged = false;
          onCutawayOffset.current?.(cutawayDragged.current);
        },
        reset: () => {
          cutawayDragged.current = 0;
          onCutawayOffset.current?.(0);
        },
      },
    );
    cutawayGrip.current = grip;
    return () => {
      grip.dispose();
      cutawayGrip.current = null;
    };
  }, [cutawayHandleOn, gl, material, getThree, cutawayScratch]);

  // Run by the Scenery each frame (see SceneryCutawayFrame): whether it cuts the seabed now.
  const frame: SceneryCutawayFrame = (camera, delta, height, zone) => {
    if (!material) return false;
    // The cutaway: from below the camera to where the `reach` row meets its plane, the
    // surface from above the water and the seabed from in it, or from above a dry one.
    // The camera's matrices are this frame's (Scenery's frame).
    const cutawayShape = material.uniforms.uSkyOceanCutawayShape
      .value as Vector3;
    const size = cutawaySize.current;
    const bedLevel = material.oceanLevel - material.oceanDepth;
    // A cutaway lights the water as the air (see sceneryZone), so the plane goes by height.
    const plane = !material.oceanWater
      ? height > bedLevel
        ? bedLevel
        : null
      : zone === 'subsurface'
        ? null
        : height > material.oceanLevel
          ? material.oceanLevel
          : bedLevel;
    const altitude = plane === null ? 0 : height - plane;
    const cutsAny =
      (cutawayWater > 0 && material.oceanWater) ||
      (cutawaySeabed && material.oceanSeabed);
    if (!material.ocean || !cutsAny || plane === null || altitude <= 0) {
      cutawayShape.y = 0;
      size.active = false;
      (material.uniforms.uSkyOceanCutawayGrip.value as Vector2).x = 0;
      cutawayGrip.current?.hide();
    } else {
      (material.uniforms.uSkyOceanCutawayCuts.value as Vector2).set(
        cutawayWater,
        cutawaySeabed ? 1 : 0,
      );
      const skyUp = material.up;
      const anchor = material.uniforms.uSkyOceanCutawayAnchor.value as Vector3;
      anchor.copy(camera.position).addScaledVector(skyUp, -altitude);
      // The frame's up plus its view direction, laid level: defined looking straight down too.
      const heading = material.uniforms.uSkyOceanCutawayHeading
        .value as Vector3;
      const m = camera.matrixWorld.elements;
      cutawayRay.set(m[4] - m[8], m[5] - m[9], m[6] - m[10]);
      cutawayRay.addScaledVector(skyUp, -cutawayRay.dot(skyUp));
      if (cutawayRay.lengthSq() > 1e-12) heading.copy(cutawayRay).normalize();

      // The tip's row climbs from `reach` looking level to the frame's top looking straight down.
      const tilt =
        Math.asin(
          MathUtils.clamp(
            m[8] * skyUp.x + m[9] * skyUp.y + m[10] * skyUp.z,
            0,
            1,
          ),
        ) /
        (Math.PI / 2);
      const row = cutawayReach + (1 - cutawayReach) * tilt;
      cutawayRay
        .set(0, 2 * row - 1, 0.5)
        .unproject(camera)
        .sub(camera.position)
        .normalize();
      const down = -cutawayRay.dot(skyUp);
      // At least just below the horizon: in proportion to the height, so any zoom frames it alike.
      const distance = altitude / Math.max(down, CUTAWAY_MIN_DOWN);
      const reach = Math.max(distance * cutawayRay.dot(heading), 0);
      const view = camera as PerspectiveCamera;
      const halfWidth =
        distance *
        Math.tan(MathUtils.degToRad(view.fov ?? 60) / 2) *
        (view.aspect ?? 1);
      // Toward a fixed size in the world by `zoomFollow`, around the view's centre, so a zoom
      // grows and shrinks it as it does the world, only less.
      let scale = 1;
      let shift = 0;
      const reference = cutawayOptions.reference ?? material.occupantRadius;
      if (reference && reference > 0 && cutawayZoomFollow < 1) {
        scale = Math.pow(reference / altitude, 1 - cutawayZoomFollow);
        cutawayRay
          .set(0, 0, 0.5)
          .unproject(camera)
          .sub(camera.position)
          .normalize();
        const centre =
          (altitude / Math.max(-cutawayRay.dot(skyUp), CUTAWAY_MIN_DOWN)) *
          cutawayRay.dot(heading);
        shift = centre * (1 - scale);
      }
      // Zoomed out the cut shrinks in the frame: its waves level out with it.
      const far = Math.min(scale, 1);
      // Looking down, from `exitTilt` on, the edge slides past the frame's top.
      size.base = reach * scale;
      size.unit = Math.max(halfWidth * scale, 1e-6);
      const offset = cutawayDragged.current ?? cutawayOffset;
      let target = Math.max(size.base + offset * size.unit, -shift);
      const exit = MathUtils.smoothstep(tilt, cutawayExitTilt / 90, 1);
      size.exit = exit;
      size.floor = -Infinity;
      if (exit > 0) {
        cutawayRay
          .set(0, 1, 0.5)
          .unproject(camera)
          .sub(camera.position)
          .normalize();
        const top =
          (altitude / Math.max(-cutawayRay.dot(skyUp), CUTAWAY_MIN_DOWN)) *
          cutawayRay.dot(heading);
        const swing =
          (Math.abs(cutawayWaves[0]?.amplitude ?? 0) +
            Math.abs(cutawayWaves[1]?.amplitude ?? 0)) *
          far;
        const inside = scale * (cutawayShadowWidth + cutawaySoftness);
        const clearance = halfWidth * (swing + inside + CUTAWAY_EXIT_MARGIN);
        size.floor = top - shift + clearance;
        target = MathUtils.lerp(target, Math.max(target, size.floor), exit);
      }
      // The size eases, so a tilt near the horizon never makes the edge jump. Switching
      // plane starts it over: the cutaway keeps its place in the frame either way.
      if (size.plane !== plane) size.active = false;
      const grip = cutawayGrip.current;
      // Dragged, the edge stays under the pointer.
      const ease =
        size.active && cutawayEase > 0 && !grip?.active
          ? 1 - Math.exp(-delta / cutawayEase)
          : 1;
      size.reach += (target - size.reach) * ease;
      size.width += (halfWidth * scale - size.width) * ease;
      size.frame += (halfWidth - size.frame) * ease;
      size.shift += (shift - size.shift) * ease;
      size.plane = plane;
      size.active = true;
      anchor.addScaledVector(heading, size.shift);
      const width = size.width;
      cutawayShape.set(
        size.reach,
        width,
        Math.max(width * cutawaySoftness, CUTAWAY_MIN_EDGE),
      );
      setCutawayWave(
        material.uniforms.uSkyOceanCutawayWaveA.value,
        cutawayWaves[0],
        size.frame,
        far,
      );
      setCutawayWave(
        material.uniforms.uSkyOceanCutawayWaveB.value,
        cutawayWaves[1],
        size.frame,
        far,
      );
      // Thinning with the cut, down to a pixel; wider while the grip is held or hovered.
      const held = !!grip && (grip.active || grip.hover);
      const rimWidth = cutawayRimWidth * (held ? 1.5 : 1);
      (material.uniforms.uSkyOceanCutawayRim.value as Vector4).set(
        cutawayRimColor.r,
        cutawayRimColor.g,
        cutawayRimColor.b,
        Math.max(rimWidth * far, Math.min(rimWidth, 1)),
      );
      (material.uniforms.uSkyOceanCutawayShadow.value as Vector2).set(
        cutawayShadowOpacity,
        width * cutawayShadowWidth,
      );

      // The grip, drawn on the rim in the middle of the view, and the element taking the
      // pointer over it. Like the rim, only on the surface seen from above.
      const gripUniform = material.uniforms.uSkyOceanCutawayGrip
        .value as Vector2;
      gripUniform.set(0, held ? 1.2 : 1);
      if (grip) {
        const { a, b, side } = cutawayScratch;
        const waveA = material.uniforms.uSkyOceanCutawayWaveA.value as Vector3;
        const waveB = material.uniforms.uSkyOceanCutawayWaveB.value as Vector3;
        side.crossVectors(heading, skyUp);
        const edgeAt = (s: number, out: Vector3) =>
          out
            .copy(anchor)
            .addScaledVector(
              heading,
              cutawayEdgeAhead(s, size.reach, waveA, waveB),
            )
            .addScaledVector(side, s)
            .project(camera);
        const centre = edgeAt(0, a);
        const along = edgeAt(width * 0.1, b);
        if (
          plane !== material.oceanLevel ||
          Math.abs(centre.x) > 1 ||
          Math.abs(centre.y) > 1 ||
          Math.abs(centre.z) > 1
        ) {
          grip.hide();
        } else {
          gripUniform.x = 1;
          const canvas = gl.domElement;
          const w = canvas.clientWidth;
          const h = canvas.clientHeight;
          grip.place(
            canvas.offsetLeft + ((centre.x + 1) / 2) * w,
            canvas.offsetTop + ((1 - centre.y) / 2) * h,
            Math.atan2(
              ((centre.y - along.y) * h) / 2,
              ((along.x - centre.x) * w) / 2,
            ),
          );
        }
      }
    }
    return size.active && cutawaySeabed;
  };
  const frameRef = useRef(frame);
  useLayoutEffect(() => {
    frameRef.current = frame;
  });
  const feature = useMemo<SceneryCutawayFeature>(
    () => ({
      water: cutawayWater,
      frame: (camera, delta, height, zone) =>
        frameRef.current(camera, delta, height, zone),
    }),
    [cutawayWater],
  );
  useSceneryFeature('cutaway', feature);
  return null;
};
