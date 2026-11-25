import {
  Box3,
  BufferGeometry,
  Camera,
  Color,
  ColorRepresentation,
  Float32BufferAttribute,
  FrontSide,
  Frustum,
  MathUtils,
  Matrix4,
  Mesh,
  Object3D,
  ShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { createCliffTexture, CliffTexture } from '../../sdk/materials/cliff-texture';
import { createRockTexture, RockTexture } from '../../sdk/materials/rock-texture';
import { Globe } from '../../sdk/projection/globe';
import { geoTileRegion } from '../../sdk/tiles/geo-tile-keys';
import fragmentShader from './shaders/hollow-fragment.glsl';
import vertexShader from './shaders/hollow-vertex.glsl';
import {
  SCENERY_HOLLOW_RIM,
  SceneryHollow,
  SceneryHollowStyle,
  sceneryDefaults,
} from './scenery-model';
import type { SceneryMaterial } from './scenery-material';

/**
 * The hollow's parts' `renderOrder` after the scenery's: just before its background, so the
 * background's layers, on the far plane, skip what they cover by depth, and after the scene,
 * which they never hide. Both write depth: the relief's overview, drawn after, meets them by
 * depth too.
 */
const SCENERY_HOLLOW_ORDER = { walls: -0.2, floor: -0.1 };

/** Seconds over which the walls' shade under the lid eases in and out (setView). */
const SCENERY_HOLLOW_SHUT_EASE = 0.3;

/** Each style as `uHollowLook.z` gives it to the shaders (hollow.glsl). */
const SCENERY_HOLLOW_STYLE_INDEX: Record<SceneryHollowStyle, number> = {
  molten: 0,
  calm: 1,
  simple: 2,
};

/** The embers' pulse's two periods, in seconds (hollowPulseAt, hollow-look.glsl). */
const SCENERY_HOLLOW_PULSE_PERIODS = [7, 17] as const;

/**
 * The embers' pulse `time` seconds in, as `uHollowPulse` takes it: its two waves' phases,
 * wrapped to a turn so they keep their precision, and how far it dims (`depth`, a share).
 * Where it is in its beat is the shader's (hollowPulseAt), by place.
 */
function sceneryHollowPulse(
  time: number,
  depth: number,
  target: Vector3,
): Vector3 {
  const [a, b] = SCENERY_HOLLOW_PULSE_PERIODS;
  const turn = 2 * Math.PI;
  return target.set(
    ((time / a) % 1) * turn,
    ((time / b) % 1) * turn,
    depth,
  );
}

/**
 * The walls' sectors round the rim, each drawn only while the camera can see it
 * (SceneryHollowParts.cull): so many triangles circle the camera that their vertices alone
 * cost about as much as their pixels.
 */
const SCENERY_HOLLOW_WALL_SECTORS = 16;

// Round the rim: the walls' columns, and the floor's outer ring, which meets their foot.
const SEGMENTS = 1024;
// The floor's rings out to the walls' foot (some 10 km apart: its shape at large is the
// rock's, read per pixel), and the walls' rows down their face.
const RINGS = 48;
const ROWS = 72;
// The walls' shape, as shares of the floor's depth: how far in they reach from the rim to the
// foot of their face, and how far their apron of fallen rock runs on over the floor.
const WALL_INSET = 0.45;
const WALL_APRON = 0.35;
// The simple style's walls: one even slope, reaching in from the rim as far as the crater's
// walls with their apron do, over the floor's depth.
const SIMPLE_SLOPE = WALL_INSET + WALL_APRON;
// Their terraces' strength (0 a plain slope; up to 1, the benches flat between sheer faces).
const TERRACES = 0.8;
// Buttresses along the rim, standing proud of the face with steep sides, so one side catches
// the light and the other not; broad spurs between bays; gullies down the face (and how far
// apart): in world units, sized to read from across the hollow.
const BUTTRESSES = 15000;
const BUTTRESS_SPACING = 60000;
// How far round the rim the buttresses and gullies drift as they go down the face, and jog
// aside at each terrace (world units); and how much they swell and thin down it (a share).
const BUTTRESS_DRIFT = 5000;
const BUTTRESS_JOG = 3000;
const BUTTRESS_SWELL = 0.4;
const SPURS = 10000;
const GULLIES = 7000;
const GULLY_SPACING = 45000;
// How far in from its neighbours' average a point of the walls must lie to be open to the
// whole hollow, or shut in a crease (hollowOpen), in world units; and how far round the rim
// and down the face that average reaches, in columns and rows.
const OPENING = 12000;
const OPEN_REACH = [16, 6];
// The floor's swell, and the size of its forms.
const FLOOR_SWELL = 1200;
const FLOOR_FORMS = 70000;

/** A {@link SceneryHollow} with every default filled in. */
export type SceneryHollowLook = {
  style: SceneryHollowStyle;
  radius: number;
  floorDepth: number;
  walls: Color;
  floor: Color;
  embers: Color;
  lid: Color;
  emberStrength: number;
  cooling: number;
  lightFalloff: number;
  murk: number;
  pulse: number;
  air: number;
  handle: boolean;
};

/** The hollow's look from its props: `null` for none (`hollow: false`). */
export function sceneryHollowLook(
  hollow: boolean | SceneryHollow | undefined,
): SceneryHollowLook | null {
  if (hollow === false) return null;
  const given: SceneryHollow = hollow === true || !hollow ? {} : hollow;
  const defaults = sceneryDefaults.void.hollow;
  const style = given.style ?? defaults.style;
  const styled = defaults.styles[style] ?? defaults.styles.calm;
  const radius = Math.max(given.radius ?? defaults.radius, 1);
  const color = (value: ColorRepresentation | undefined, fallback: string) =>
    new Color(value ?? fallback);
  return {
    style,
    radius,
    floorDepth: Math.max(given.floorDepth ?? defaults.floorDepth, 1),
    walls: color(given.colors?.walls, styled.colors.walls),
    floor: color(given.colors?.floor, styled.colors.floor),
    embers: color(given.colors?.embers, styled.colors.embers),
    lid: color(given.colors?.lid, styled.colors.lid),
    emberStrength: Math.max(given.embers ?? styled.embers, 0),
    cooling: Math.max(
      given.cooling ?? defaults.cooling ?? Math.max(40000, 0.35 * radius),
      1,
    ),
    lightFalloff: Math.max(given.lightFalloff ?? defaults.lightFalloff, 1),
    murk: Math.max(given.murk ?? defaults.murk, 0),
    pulse: MathUtils.clamp(given.pulse ?? styled.pulse, 0, 1),
    air: MathUtils.clamp(given.air ?? styled.air, 0, 1),
    handle: style === 'simple' && !!given.handle,
  };
}

/**
 * The hollow's rim's radius at `turn` radians round its axis (from true east toward true
 * north), as a share of its radius: {@link SCENERY_HOLLOW_RIM}'s waves. hollow.glsl's
 * `hollowRimScale`.
 */
function sceneryHollowRimScale(turn: number) {
  let scale = 1;
  for (const [k, a, p] of SCENERY_HOLLOW_RIM) scale += a * Math.sin(k * turn + p);
  return scale;
}

/**
 * How far inside the hollow's rim `point` lies, across its axis at the point's own height:
 * positive inside, in world units. The twin of `hollowInside` (hollow.glsl), for `radius`
 * along the sea about `globe`'s disc centre; with `scale`, as if the rim stood at that share
 * of its radius all round (SCENERY_HOLLOW_RIM_LEAST: where it reaches in furthest).
 */
export function sceneryHollowInside(
  globe: Globe,
  radius: number,
  point: Vector3,
  scale?: number,
): number {
  const up = globe.up;
  offset.subVectors(point, globe.discCentre);
  const h = offset.dot(up);
  offset.addScaledVector(up, -h);
  const rimScale =
    scale ??
    sceneryHollowRimScale(
      Math.atan2(
        offset.dot(globe.uniforms.uGlobeNorth.value),
        offset.dot(globe.uniforms.uGlobeEast.value),
      ),
    );
  const limit = globe.enabled
    ? Math.tan(Math.min(radius / globe.radius, 1.5) * rimScale) *
      (h + globe.centreDepth)
    : radius * rimScale;
  return limit - offset.length();
}

/** The share of its radius the hollow's rim reaches in to at its furthest (SCENERY_HOLLOW_RIM). */
const SCENERY_HOLLOW_RIM_LEAST =
  1 - SCENERY_HOLLOW_RIM.reduce((sum, [, share]) => sum + share, 0);

/** The largest radius the rim grip drags a hollow to (SceneryHollow.handle), in world units. */
const SCENERY_HOLLOW_RADIUS_MAX = 1500000;

/**
 * The radii the rim grip drags a simple hollow `floorDepth` deep between: its walls' reach and
 * 20 km of floor at least, {@link SCENERY_HOLLOW_RADIUS_MAX} at most.
 */
export function sceneryHollowRadiusRange(floorDepth: number): [number, number] {
  return [SIMPLE_SLOPE * floorDepth + 20000, SCENERY_HOLLOW_RADIUS_MAX];
}

/**
 * The point `across` along the sea from `globe`'s disc centre at `turn` radians round it (from
 * true east toward true north), `height` over the sea's level, into `target`: about the disc's
 * centre (add `discCentre` to place it), as the hollow's geometry lays its points.
 */
export function sceneryHollowPointAt(
  globe: Globe,
  turn: number,
  across: number,
  height: number,
  target: Vector3,
): Vector3 {
  const up = globe.up;
  east.copy(globe.uniforms.uGlobeEast.value);
  east.addScaledVector(up, -east.dot(up)).normalize();
  north.crossVectors(up, east);
  let flat = across;
  let along = height;
  if (globe.enabled) {
    const R = globe.radius;
    const s = globe.centreDepth;
    const rho = R + height;
    const half = Math.sin(across / R / 2);
    flat = rho * Math.sin(across / R);
    // ρ cos α − s, as (R − s) + (ρ − R) − 2ρ sin²(α / 2): nothing near-equal subtracted.
    along = globe.discRadius ** 2 / (R + s) + height - 2 * rho * half * half;
  }
  const dx = Math.cos(turn);
  const dz = Math.sin(turn);
  return target
    .copy(east)
    .multiplyScalar(flat * dx)
    .addScaledVector(north, flat * dz)
    .addScaledVector(up, along);
}

/**
 * Whether the geographic tile `key` lies wholly inside the hollow's rim on `globe`, for a
 * hollow of `radius`, a couple of km in from where the rim reaches in furthest: all its
 * ground is peeled away while the hollow is open. Its corners suffice, its sides
 * bulging out from the axis by far less than that margin.
 */
export function sceneryHollowHoldsTile(
  globe: Globe,
  radius: number,
  key: number,
): boolean {
  if (!globe.enabled || !globe.frame) return false;
  const [west, north, span] = geoTileRegion(key);
  for (let corner = 0; corner < 4; corner++) {
    globe.sphereOffset(
      north - (corner >> 1) * span,
      west + (corner & 1) * span,
      tileOffset,
    );
    globe.sphereAt(tileOffset, 0, tilePoint);
    if (
      sceneryHollowInside(globe, radius, tilePoint, SCENERY_HOLLOW_RIM_LEAST) <
      HOLLOW_TILE_MARGIN
    )
      return false;
  }
  return true;
}

// How far inside the rim's furthest reach a tile's corners must lie (sceneryHollowHoldsTile).
const HOLLOW_TILE_MARGIN = 2000;
const tileOffset = new Vector2();
const tilePoint = new Vector3();

/** The band outside the rim, as a share of its radius, over which its air thins (HOLLOW_AIR_BAND). */
const SCENERY_HOLLOW_AIR_BAND = 0.4;
/** The camera's altitudes over which the sky's drained air fades out: above, the sky is space. */
const SCENERY_HOLLOW_AIR_HEIGHTS = [50000, 150000] as const;

/**
 * How much of the air about a camera `inside` the open hollow's rim (sceneryHollowInside),
 * `altitude` over the sea, has drained into it, for a hollow of `radius` that keeps `kept` of
 * it (SceneryHollowLook.air): all but that over the opening, none beyond the band outside its
 * rim (as `hollowAirAt`, hollow.glsl), and less the higher the camera, where the sky is
 * space's anyway.
 */
export function sceneryHollowAirGone(
  inside: number,
  radius: number,
  altitude: number,
  kept: number,
) {
  const air = MathUtils.lerp(
    kept,
    1,
    MathUtils.smoothstep(-inside, 0, SCENERY_HOLLOW_AIR_BAND * radius),
  );
  const [low, high] = SCENERY_HOLLOW_AIR_HEIGHTS;
  return (1 - air) * (1 - MathUtils.smoothstep(altitude, low, high));
}

const offset = new Vector3();
const east = new Vector3();
const north = new Vector3();

// Noise for the shape, deterministic: integers to 0 to 1.
function hash(a: number, b: number, c: number) {
  let h =
    Math.imul(a | 0, 0x27d4eb2d) ^
    Math.imul(b | 0, 0x165667b1) ^
    Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (f: number) => f * f * (3 - 2 * f);
const wrap = (i: number, n: number) => ((i % n) + n) % n;

// Value noise round the rim, `cells` of it round a turn (`at`, 0 to 1), −1 to 1: it wraps.
function rimNoise(at: number, cells: number, layer: number) {
  const x = at * cells;
  const i = Math.floor(x);
  const a = hash(wrap(i, cells), layer, 7);
  const b = hash(wrap(i + 1, cells), layer, 7);
  return (a + (b - a) * smooth(x - i)) * 2 - 1;
}

// The same, `octaves` of it, each twice as fine and half as strong.
function rimFractal(at: number, cells: number, octaves: number, layer: number) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * rimNoise(at, cells << o, layer + o);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

// Value noise over the plane, `x` and `y` in cells, −1 to 1.
function planeNoise(x: number, y: number, layer: number) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const u = smooth(x - i);
  const v = smooth(y - j);
  const a = hash(i, j, layer);
  const b = hash(i + 1, j, layer);
  const c = hash(i, j + 1, layer);
  const d = hash(i + 1, j + 1, layer);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

// The same round the rim and down the face: `cells` of it round a turn (`at`, 0 to 1, a whole
// number of them, so it wraps), `y` in cells down, −1 to 1.
function rimFaceNoise(at: number, cells: number, y: number, layer: number) {
  const x = at * cells;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const u = smooth(x - i);
  const v = smooth(y - j);
  const i0 = wrap(i, cells);
  const i1 = wrap(i + 1, cells);
  const a = hash(i0, j, layer);
  const b = hash(i1, j, layer);
  const c = hash(i0, j + 1, layer);
  const d = hash(i1, j + 1, layer);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

function planeFractal(x: number, y: number, octaves: number, layer: number) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const f = 1 << o;
    sum += amp * planeNoise(x * f, y * f, layer + o);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * A crater wall's face at `turn` radians round the axis, `t` down it (0 the rim, 1 its foot
 * on the floor): how far in from the rim it lies, and how deep under the seabed, in world
 * units. Sized to read from across the hollow: terraces (a slope's depth and reach traded back
 * and forth, one to three of them, varying round the rim), spurs some tens of km proud of it,
 * gullies some 45 km apart, and an apron of fallen rock flaring out onto the floor. The spurs
 * and gullies drift round the rim as they go down, jog at each terrace and swell and thin, so
 * their flanks twist in the light rather than run down the face as slabs. Nothing at the rim,
 * which the relief is cut along. The face may lean out where its features cross;
 * {@link createSceneryHollowGeometry} keeps it from doing so.
 */
export function sceneryHollowWallAt(
  turn: number,
  t: number,
  floorDepth: number,
  rimLength: number,
): [inset: number, depth: number] {
  const at = turn / (2 * Math.PI);
  const reach = WALL_INSET * floorDepth * (1 + 0.35 * rimFractal(at, 6, 3, 11));
  const steps = 1.7 + 0.7 * rimFractal(at, 4, 2, 21);
  const strength = TERRACES * (0.8 + 0.2 * rimFractal(at, 5, 2, 31));
  const T = 2 * Math.PI * steps;
  // Zero at both ends, so the face starts at the rim and ends on the floor.
  const terrace = ((strength * Math.sin(T * t)) / T) * Math.sin(Math.PI * t);
  const depth = floorDepth * (t + terrace);
  let inset = reach * (t - terrace);
  const fromRim = smooth(Math.min(t / 0.15, 1));
  const cells = (spacing: number) =>
    Math.max(8, Math.round(rimLength / spacing));
  const buttresses = cells(BUTTRESS_SPACING);
  const regions = Math.max(4, Math.round(buttresses / 2));
  // Where the spurs and gullies stand round the rim, `t` down: drifting, each its own way, and
  // jogging aside over the last of each terrace's band, held between.
  const band = t * steps;
  const step = Math.floor(band);
  const jog =
    rimFaceNoise(at, regions, step, 71) +
    (rimFaceNoise(at, regions, step + 1, 71) -
      rimFaceNoise(at, regions, step, 71)) *
      smooth(Math.max((band - step - 0.7) / 0.3, 0));
  const shift =
    (BUTTRESS_DRIFT * rimFaceNoise(at, regions, t * 1.5, 73) +
      BUTTRESS_JOG * jog) /
    rimLength;
  // Buttresses: ridged, so their crests are sharp and the bays between them deep; swelling
  // and thinning down the face.
  const ridge = 1 - Math.abs(rimFractal(at + shift, buttresses, 2, 37));
  const swell = 1 + BUTTRESS_SWELL * rimFaceNoise(at, buttresses, t * 2, 75);
  inset += BUTTRESSES * (ridge * ridge - 0.35) * swell * fromRim;
  // Broad spurs and bays, a few hundred km round.
  inset += SPURS * rimFractal(at, 8, 2, 41) * fromRim;
  // Gullies down the face, some deeper than others, deepening toward the foot.
  const gullies = cells(GULLY_SPACING);
  const gully = 1 - Math.abs(rimFractal(at + shift, gullies, 2, 51));
  const deep = 0.4 + 0.6 * (0.5 + 0.5 * rimFractal(at, 12, 2, 57));
  inset +=
    GULLIES * deep * (gully * gully - 0.4) * (0.4 + 0.6 * t) * fromRim +
    0.2 *
      GULLIES *
      rimFaceNoise(at, Math.max(4, Math.round(gullies / 2)), t * 3, 61) *
      fromRim;
  const apron = smooth(Math.max((t - 0.7) / 0.3, 0));
  inset += WALL_APRON * floorDepth * apron * apron;
  return [inset, depth];
}

/** What the hollow's geometry is built for (see {@link createSceneryHollowGeometry}). */
export type SceneryHollowShape = {
  /** the rim's radius along the sea */
  radius: number;
  /** the floor's depth under the seabed */
  floorDepth: number;
  /** the seabed's height over the sea's level: the void's lid, its walls' top */
  bed: number;
  /** a plain even slope from the rim to the floor, and a flat floor: the simple style's */
  simple?: boolean;
};

const pow2Ceil = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(n, 1)));

/**
 * The hollow's floor and walls, about `globe`'s disc centre (add `uGlobeDisc` to place them).
 * The walls a crater's (see {@link sceneryHollowWallAt}) along the rim, which wanders round the
 * axis ({@link sceneryHollowRimScale}), from the seabed down to the floor `floorDepth` under
 * it; the floor a swelling cap of the sphere out to their foot, in rings that grow finer
 * outward so none gathers slivers at the middle, its last ring the walls' last row. The
 * rim's columns a few metres out of it, so the relief cut along it leaves no crack. Built in
 * 64-bit floats, about the disc's centre, so nothing near-equal is subtracted on the GPU; its
 * normals from the mesh. With the globe off, the same on the plane.
 *
 * Attributes: `position`, `normal`, `hollowUv` (the floor's place across the axis along true
 * east and north; the walls' along the rim and height over the seabed, ≤ 0), `hollowEdge`
 * (the floor's distance in from the walls' foot; the walls' share of the way down, 0 to 1) and
 * `hollowOpen` (how open the walls are to the hollow, 0 in a crease; 1 on the floor).
 */
function createSceneryHollowGeometry(
  globe: Globe,
  { radius, floorDepth, bed, simple = false }: SceneryHollowShape,
) {
  const up = globe.up;
  east.copy(globe.uniforms.uGlobeEast.value);
  east.addScaledVector(up, -east.dot(up)).normalize();
  north.crossVectors(up, east);
  const on = globe.enabled;
  const R = on ? globe.radius : Infinity;
  const s = on ? globe.centreDepth : 0;
  const rimAngle = on ? Math.min(radius / R, 1.5) : 0;
  // R − s, the disc's sagitta, as r² / (R + s): nothing near-equal subtracted.
  const sag = on ? globe.discRadius ** 2 / (R + s) : 0;
  const rimLength = 2 * Math.PI * radius;

  // A point `across` the axis at `turn`, `height` over the sea's level: where it lies from the
  // disc's centre. On the globe `across` is the arc along the sea, carried down the radial.
  const point = (
    turn: number,
    across: number,
    height: number,
    out: number[],
    uv?: number[],
  ) => {
    let flat: number;
    let along: number;
    if (on) {
      const rho = R + height;
      const angle = across / R;
      const half = Math.sin(angle / 2);
      flat = rho * Math.sin(angle);
      // ρ cos α − s, as (R − s) + (ρ − R) − 2ρ sin²(α / 2).
      along = sag + height - 2 * rho * half * half;
    } else {
      flat = across;
      along = height;
    }
    const dx = Math.cos(turn);
    const dz = Math.sin(turn);
    out.push(
      flat * (dx * east.x + dz * north.x) + along * up.x,
      flat * (dx * east.y + dz * north.y) + along * up.y,
      flat * (dx * east.z + dz * north.z) + along * up.z,
    );
    uv?.push(flat * dx, flat * dz);
  };
  // The rim's arc out from the axis at `turn`, a few metres beyond the cut: round for the
  // simple style (hollowRimScale).
  const rimAt = (turn: number) =>
    (on ? rimAngle * R : radius) * (simple ? 1 : sceneryHollowRimScale(turn)) +
    3;

  // The walls' insets and depths, row by row down each column; neither shrinks down a column,
  // so where buttresses, gullies and terraces cross the face never leans out over itself.
  const insets = new Float64Array((ROWS + 1) * SEGMENTS);
  const depths = new Float64Array((ROWS + 1) * SEGMENTS);
  for (let k = 0; k < SEGMENTS; k++) {
    const turn = (2 * Math.PI * k) / SEGMENTS;
    let last = -Infinity;
    let deepest = -Infinity;
    for (let row = 0; row <= ROWS; row++) {
      const t = row / ROWS;
      const [inset, depth] = simple
        ? [SIMPLE_SLOPE * floorDepth * t, floorDepth * t]
        : sceneryHollowWallAt(turn, t, floorDepth, rimLength);
      last = Math.max(inset, last);
      deepest = Math.min(Math.max(depth, deepest), floorDepth);
      insets[row * SEGMENTS + k] = last;
      depths[row * SEGMENTS + k] = deepest;
    }
  }
  // The walls' foot at column `k` (any multiple of SEGMENTS / count for a ring of `count`).
  const footAt = (k: number) =>
    rimAt((2 * Math.PI * k) / SEGMENTS) - insets[ROWS * SEGMENTS + k];

  // The walls: rows down from the rim to the foot, a column per segment and the first again,
  // for the seam's texture.
  const wallPositions: number[] = [];
  const wallUvs: number[] = [];
  const wallEdges: number[] = [];
  for (let row = 0; row <= ROWS; row++) {
    const t = row / ROWS;
    for (let k = 0; k <= SEGMENTS; k++) {
      const turn = (2 * Math.PI * k) / SEGMENTS;
      const at = row * SEGMENTS + (k % SEGMENTS);
      point(turn, rimAt(turn) - insets[at], bed - depths[at], wallPositions);
      wallUvs.push(turn * radius, -depths[at]);
      wallEdges.push(t);
    }
  }
  // How open each point is to the hollow, 0 to 1: how far it stands in from its neighbours'
  // average, round the rim and down the face (a box of OPEN_REACH), over OPENING. Spurs and
  // ledges' edges open, gullies and bays and the backs of ledges shut.
  const wallOpen: number[] = [];
  const [reachK, reachRow] = OPEN_REACH;
  for (let row = 0; row <= ROWS; row++)
    for (let k = 0; k <= SEGMENTS; k++) {
      const kk = k % SEGMENTS;
      let sum = 0;
      let n = 0;
      for (let dr = -reachRow; dr <= reachRow; dr++) {
        const r = Math.min(Math.max(row + dr, 0), ROWS);
        for (let dk = -reachK; dk <= reachK; dk++) {
          sum += insets[r * SEGMENTS + wrap(kk + dk, SEGMENTS)];
          n++;
        }
      }
      const proud = insets[row * SEGMENTS + kk] - sum / n;
      wallOpen.push(Math.min(Math.max(0.6 + proud / OPENING, 0), 1));
    }
  const wallIndex: number[] = [];
  const wallAt = (row: number, k: number) => row * (SEGMENTS + 1) + k;
  // Rows run down from the rim, columns counter-clockwise from above: counter-clockwise seen
  // from the axis, their front faces in. Sector by sector round the rim, each a run of the
  // index (SCENERY_HOLLOW_WALL_SECTORS), bounded by a sphere about the disc's centre.
  const columns = SEGMENTS / SCENERY_HOLLOW_WALL_SECTORS;
  const wallSpheres: Sphere[] = [];
  const box = new Box3();
  const corner = new Vector3();
  for (let sector = 0; sector < SCENERY_HOLLOW_WALL_SECTORS; sector++) {
    box.makeEmpty();
    for (let row = 0; row < ROWS; row++)
      for (let k = sector * columns; k < (sector + 1) * columns; k++) {
        const a = wallAt(row, k);
        const b = wallAt(row, k + 1);
        const c = wallAt(row + 1, k + 1);
        const d = wallAt(row + 1, k);
        wallIndex.push(a, b, c, a, c, d);
      }
    for (let row = 0; row <= ROWS; row++)
      for (let k = sector * columns; k <= (sector + 1) * columns; k++) {
        const i = 3 * wallAt(row, k);
        box.expandByPoint(
          corner.set(
            wallPositions[i],
            wallPositions[i + 1],
            wallPositions[i + 2],
          ),
        );
      }
    wallSpheres.push(box.getBoundingSphere(new Sphere()));
  }

  // The floor: the middle, then rings out to the walls' foot, each with a power of two of
  // segments (8 up to SEGMENTS), so each has twice its inner neighbour's or as many.
  const floorPositions: number[] = [];
  const floorUvs: number[] = [];
  const floorEdges: number[] = [];
  const counts: number[] = [1];
  const starts: number[] = [0];
  const swellAt = (turn: number, across: number, f: number) => {
    if (simple) return 0;
    const x = (across * Math.cos(turn)) / FLOOR_FORMS;
    const y = (across * Math.sin(turn)) / FLOOR_FORMS;
    // None at the foot, which meets the walls' last row.
    return FLOOR_SWELL * planeFractal(x, y, 4, 71) * (1 - smooth(Math.max((f - 0.8) / 0.2, 0)));
  };
  point(0, 0, bed - floorDepth + swellAt(0, 0, 0), floorPositions, floorUvs);
  floorEdges.push(footAt(0));
  for (let ring = 1; ring <= RINGS; ring++) {
    const f = ring / RINGS;
    const count =
      ring === RINGS ? SEGMENTS : Math.min(SEGMENTS, pow2Ceil(Math.max(8, 6 * ring)));
    starts.push(floorEdges.length);
    counts.push(count);
    for (let k = 0; k < count; k++) {
      const turn = (2 * Math.PI * k) / count;
      const foot = footAt((k * SEGMENTS) / count);
      const across = f * foot;
      point(turn, across, bed - floorDepth + swellAt(turn, across, f), floorPositions, floorUvs);
      floorEdges.push(foot - across);
    }
  }
  const floorIndex: number[] = [];
  // Counter-clockwise from above: their front faces up.
  for (let k = 0; k < counts[1]; k++)
    floorIndex.push(0, starts[1] + k, starts[1] + ((k + 1) % counts[1]));
  for (let ring = 1; ring < RINGS; ring++) {
    const inner = counts[ring];
    const outer = counts[ring + 1];
    const a0 = starts[ring];
    const b0 = starts[ring + 1];
    for (let k = 0; k < inner; k++) {
      const a = a0 + k;
      const a1 = a0 + ((k + 1) % inner);
      if (outer === inner) {
        const b = b0 + k;
        const b1 = b0 + ((k + 1) % outer);
        floorIndex.push(a, b, b1, a, b1, a1);
      } else {
        const b = b0 + 2 * k;
        const bMid = b0 + 2 * k + 1;
        const b1 = b0 + ((2 * k + 2) % outer);
        floorIndex.push(a, b, bMid, a, bMid, a1, a1, bMid, b1);
      }
    }
  }

  const build = (
    positions: number[],
    uvs: number[],
    edges: number[],
    index: number[],
    open?: number[],
  ) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute('hollowUv', new Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('hollowEdge', new Float32BufferAttribute(edges, 1));
    geometry.setAttribute(
      'hollowOpen',
      new Float32BufferAttribute(open ?? new Array(edges.length).fill(1), 1),
    );
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
  };
  const walls = build(wallPositions, wallUvs, wallEdges, wallIndex, wallOpen);
  // The seam's two columns are one: their normals averaged.
  const normals = walls.getAttribute('normal');
  for (let row = 0; row <= ROWS; row++) {
    const a = wallAt(row, 0);
    const b = wallAt(row, SEGMENTS);
    const x = normals.getX(a) + normals.getX(b);
    const y = normals.getY(a) + normals.getY(b);
    const z = normals.getZ(a) + normals.getZ(b);
    const n = Math.hypot(x, y, z) || 1;
    normals.setXYZ(a, x / n, y / n, z / n);
    normals.setXYZ(b, x / n, y / n, z / n);
  }
  return {
    floor: build(floorPositions, floorUvs, floorEdges, floorIndex),
    walls,
    wallSpheres,
  };
}

/**
 * The hollow under a {@link SceneryMaterial}'s seabed, drawn just before its background: a
 * floor and crater walls of real geometry (see {@link createSceneryHollowGeometry}), shaded as
 * rock (`hollow-fragment.glsl`), their materials sharing the sky's uniform objects. Built again
 * only when the globe or the shape changes; its look and the opening are uniforms. Internal to
 * `Scenery`.
 */
export class SceneryHollowParts {
  readonly floor: Mesh<BufferGeometry, ShaderMaterial>;
  /** The walls' sectors round the rim, one mesh each (cull). */
  readonly walls = new Object3D();
  private readonly sectors: Mesh<BufferGeometry, ShaderMaterial>[] = [];
  private spheres: Sphere[] = [];
  private rock: RockTexture | null = null;
  private cliff: CliffTexture | null = null;
  private baking: Promise<boolean> | null = null;
  private built = '';
  // The embers' pulse: seconds drawn so far, and how far it dims (SceneryHollowLook.pulse).
  private clock = 0;
  private pulseDepth = 0;

  constructor(private readonly scenery: SceneryMaterial) {
    // The sky's uniform objects, its hollow's look among them (hollow-look.glsl), which the
    // void's lid over it reads too.
    const material = (part: 'floor' | 'walls') => {
      const shader = new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: Object.create(scenery.uniforms),
        defines: part === 'floor' ? { HOLLOW_FLOOR: '' } : {},
        side: FrontSide,
        dithering: true,
      });
      shader.name = `scenery-hollow-${part}`;
      return shader;
    };
    const mesh = (part: 'floor' | 'walls', shader = material(part)) => {
      const object = new Mesh(new BufferGeometry(), shader);
      object.name = `scenery-hollow-${part}`;
      // Placed in the shader about the globe's disc centre: no bounds, no matrices.
      object.frustumCulled = false;
      object.matrixAutoUpdate = false;
      object.userData.sceneryLayer = 'void';
      object.onBeforeRender = scenery.onBeforeDraw;
      return object;
    };
    this.floor = mesh('floor');
    this.floor.visible = false;
    const walls = material('walls');
    for (let i = 0; i < SCENERY_HOLLOW_WALL_SECTORS; i++) {
      const sector = mesh('walls', walls);
      this.sectors.push(sector);
      this.walls.add(sector);
    }
    // A plain object, not a group: a group's renderOrder would order its sectors among the
    // groups, not among the background's layers they must come before.
    this.walls.name = 'scenery-hollow-walls';
    this.walls.matrixAutoUpdate = false;
    this.walls.visible = false;
    this.walls.userData.sceneryLayer = 'void';
  }

  /**
   * Bake what it is shaded with, on `renderer`'s GPU, once: its rock and its cliffs, each once
   * its program has compiled. Until both are in it is not to be drawn. Resolves `true` once
   * they are, `false` if disposed of first; called again, the same promise.
   */
  makeTextures(
    renderer: WebGLRenderer,
    onProgress?: (done: number, total: number) => void,
  ): Promise<boolean> {
    if (this.baking) return this.baking;
    this.rock = createRockTexture(renderer, { onProgress });
    this.cliff = createCliffTexture(renderer, { onProgress });
    const u = this.scenery.uniforms;
    u.uHollowRock.value = this.rock.texture;
    u.uHollowRockSlope.value = this.rock.slopeScale;
    u.uHollowCliff.value = this.cliff.texture;
    const baking: Promise<boolean> = Promise.all([
      this.rock.ready,
      this.cliff.ready,
    ]).then(
      // Disposed of meanwhile: it is a later bake's to say.
      ([rock, cliff]) => this.baking === baking && rock && cliff,
    );
    this.baking = baking;
    return baking;
  }

  /** Its look; a uniform upload. */
  setLook(look: SceneryHollowLook) {
    const u = this.scenery.uniforms;
    (u.uHollowShape.value as Vector4).set(
      look.floorDepth,
      look.radius,
      look.cooling,
      look.lightFalloff,
    );
    (u.uHollowWallColor.value as Color).copy(look.walls);
    (u.uHollowFloorColor.value as Color).copy(look.floor);
    (u.uHollowEmberColor.value as Color).copy(look.embers);
    (u.uHollowLidColor.value as Color).copy(look.lid);
    (u.uHollowLook.value as Vector4).set(
      look.emberStrength,
      look.murk,
      SCENERY_HOLLOW_STYLE_INDEX[look.style],
      look.air,
    );
    this.pulseDepth = look.pulse;
  }

  /**
   * Where the camera is, once a frame, `delta` seconds after the last: `inside` the hollow's
   * rim, at any depth, where its walls stand about it and its lid is drawn; whether it is
   * `shut` (under the lid: the seabed in place, or the camera under it); how much of the air
   * about it is `gone` (sceneryHollowAirGone); and how far `below` the floor it is, in the
   * rock, through which it sees the hollow fading (0 over the floor). The walls' shade under
   * the lid eases in and out over {@link SCENERY_HOLLOW_SHUT_EASE} seconds; the embers pulse
   * (sceneryHollowPulse) as frames are drawn.
   */
  setView(
    inside: boolean,
    shut: boolean,
    gone: number,
    below: number,
    delta: number,
  ) {
    const view = this.scenery.uniforms.uHollowView.value as Vector4;
    view.x = inside ? 1 : 0;
    view.y +=
      ((shut ? 1 : 0) - view.y) *
      Math.min(1, delta / SCENERY_HOLLOW_SHUT_EASE);
    view.z = gone;
    view.w = Math.max(below, 0);
    this.clock += delta;
    sceneryHollowPulse(
      this.clock,
      this.pulseDepth,
      this.scenery.uniforms.uHollowPulse.value as Vector3,
    );
  }

  /** Its geometry for `shape` on the sky's globe: built again only when either changed. */
  update(shape: SceneryHollowShape) {
    const globe = this.scenery.globe;
    const key = [
      globe.version,
      shape.radius,
      shape.floorDepth,
      shape.bed,
      !!shape.simple,
    ].join(',');
    if (key === this.built) return;
    this.built = key;
    const { floor, walls, wallSpheres } = createSceneryHollowGeometry(
      globe,
      shape,
    );
    this.floor.geometry.dispose();
    this.floor.geometry = floor;
    // Each sector a run of the walls' one index over their one set of attributes.
    const count = (walls.getIndex()?.count ?? 0) / this.sectors.length;
    this.sectors.forEach((sector, i) => {
      sector.geometry.dispose();
      const geometry = new BufferGeometry();
      for (const name of Object.keys(walls.attributes))
        geometry.setAttribute(name, walls.getAttribute(name));
      geometry.setIndex(walls.getIndex());
      geometry.setDrawRange(i * count, count);
      sector.geometry = geometry;
    });
    this.spheres = wallSpheres;
  }

  /** The draw order: just before the background at `order` (SCENERY_HOLLOW_ORDER). */
  setOrder(order: number) {
    this.floor.renderOrder = order + SCENERY_HOLLOW_ORDER.floor;
    for (const sector of this.sectors)
      sector.renderOrder = order + SCENERY_HOLLOW_ORDER.walls;
  }

  /**
   * Shows only the walls' sectors `camera` can see, once a frame: they are placed in their
   * shader about the globe's disc centre, so three cannot cull them. By the frustum's sides
   * only: far off, they are held at its far plane (hollow-vertex).
   */
  cull(camera: Camera) {
    camera.updateMatrixWorld();
    cullMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    cullFrustum.setFromProjectionMatrix(cullMatrix);
    cullFrustum.planes[4].constant = Infinity;
    cullFrustum.planes[5].constant = Infinity;
    const centre = this.scenery.globe.discCentre;
    this.sectors.forEach((sector, i) => {
      const sphere = this.spheres[i];
      if (!sphere) return;
      cullSphere.copy(sphere);
      cullSphere.center.add(centre);
      // A little wider, so a sector the camera turns toward is in by the frame it shows.
      cullSphere.radius *= 1.1;
      sector.visible = cullFrustum.intersectsSphere(cullSphere);
    });
  }

  dispose() {
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    for (const sector of this.sectors) sector.geometry.dispose();
    this.sectors[0]?.material.dispose();
    this.rock?.dispose();
    this.rock = null;
    this.cliff?.dispose();
    this.cliff = null;
    this.baking = null;
    this.scenery.uniforms.uHollowRock.value = null;
    this.scenery.uniforms.uHollowCliff.value = null;
  }
}

const cullMatrix = new Matrix4();
const cullFrustum = new Frustum();
const cullSphere = new Sphere();
