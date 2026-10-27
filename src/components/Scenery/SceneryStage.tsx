import { useFrame, useThree } from '@react-three/fiber';
import {
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {
  BufferGeometry,
  Camera,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { useGenerator } from '../../hooks/useGenerator';
import { createLayers, LAYERS } from '../../layers/layers';
import type {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from '../../sdk/geometries/planar-geometry';
import {
  PolygonDistanceField,
  polygonDistanceField,
} from '../../sdk/geometries/polygon-distance-field';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import type { ReliefLayer } from '../../sdk/geometries/relief-tiles';
import type { CutUniforms } from '../../sdk/materials/fence-field';
import type { HeightFieldClip } from '../../sdk/materials/height-field-clip';
import { SceneryStageReliefOverview } from './SceneryStageReliefOverview';
import {
  SceneryStageReliefTiles,
  SceneryReliefTileStats,
} from './SceneryStageReliefTiles';
import {
  SKY_RELIEF_MAX_OCCUPANTS,
  SceneryReliefOccupantFields,
  SceneryReliefTileDebug,
  SceneryReliefTileOccupants,
} from './scenery-relief-tiles';
import type { ReliefSampler } from './scenery-relief-sampler';
import { useSceneryOcean } from './scenery-context';
import type { SceneryReliefLoading } from './scenery-progress';
import { placeOnGlobe, releaseFromGlobe } from './scenery-anchor';
import { useWorld } from '../World/world-context';
import { sceneryRelief, SceneryReliefResponse } from './scenery-defs';
import {
  createSceneryStageMaterial,
  createSceneryStageOutline,
  createSceneryStageFootprint,
  createSceneryStagePlane,
  SceneryStageBounds,
} from './scenery-stage';
import {
  ReliefColor,
  ReliefContours,
  ReliefLook,
  SceneryReliefLooks,
} from './scenery-relief-look';

// The farthest from the camera the stage draws the sea, past which the sky's own does: the
// far plane, but no farther. Its flat planes, sunk under a camera far off, cannot stand for
// the globe much beyond; from space the sky draws all of it.
const STAGE_REACH = 3000000;
const NO_OCCUPANTS: SceneryStageOccupant[] = [];

// The same array as last render while its items are: one written inline is new every render.
function useStableList<T>(list: T[]): T[] {
  const kept = useRef(list);
  if (
    kept.current.length !== list.length ||
    kept.current.some((item, i) => item !== list[i])
  )
    kept.current = list;
  return kept.current;
}

// An outline's bounds in scene X/Z, its offset included.
function outlineSquare(outline: PlanarPolygonGeometry): SceneryStageBounds {
  const { min, max } = outline.getBounds();
  const [ox, oz] = outline.offset;
  return [min[0] + ox, min[1] + oz, max[0] + ox, max[1] + oz];
}

// Without OIT, see-through parts draw in this order: the scene's own (most of it under the
// sea), then the water over everything.
const SURFACE_ORDER = 1;
// Debug lines go over everything.
const OUTLINE_ORDER = 1e9;
// Drawn last by the OITRenderPass too, over its transparent layers.
const OVERLAY_LAYERS = createLayers(LAYERS.OVERLAY);
// Wireframe colours, as `SceneryDebug.tint` colours the layers.
const WIRE_COLORS: Record<StagePartLayer, string> = {
  surface: '#1a59ff',
  bed: '#26cc33',
};

/** What a {@link SceneryStage} does for its occupant, as {@link SceneryStageOccupant.onStage} tells it. */
export type SceneryStageOccupantState = {
  /**
   * the stage draws the occupant's seabed: the sea has one, the sky is drawn and compiled,
   * and the stage has a relief, which is the ground over the occupant then. While false,
   * draw your own
   */
  seabed: boolean;
  /** the opacity the stage draws it at, the sea's (`SceneryOceanProps.seabedOpacity`): below 1, cull nothing under it */
  seabedOpacity: number;
  /** the stage owns the water over the occupant: it is under a drawn sky with a sea, with water or not. While true, draw none of your own */
  water: boolean;
};

/**
 * What claims part of a {@link SceneryStage}: a field column, say, which tells the stage
 * where it lies and is told what the stage does for it.
 */
export type SceneryStageOccupant = {
  /**
   * The occupant's footprint, in scene X/Z. Its bounds are where the cutaway takes its
   * size from and where `anchor` is placed about; and with a relief, over it the cutaway
   * takes the water but not the ground, its bounds are where `onGround` hands out the
   * ground, and with `keepBed` off the occupant's `cut` cuts the relief inside it.
   */
  outline?: PlanarPolygonGeometry;
  /**
   * The occupant's own cut — a `ChunkStack`'s, from its `onCut` — which the stage cuts the
   * relief over it with, as the occupant cuts itself, while its `keepBed` is off. The same
   * uniform objects, so it follows the cut every frame; they must be in the scene frame.
   * While it cuts, the void shows through the relief, and the sky draws the void's walls
   * from above too.
   */
  cut?: CutUniforms;
  /**
   * With a relief: keep the relief over the occupant whole, as the occupant's floor,
   * whatever its `cut` takes of the occupant. Default true. Off, the relief is cut with
   * the occupant inside its `outline`, so its cut edge and the occupant's cut face (a
   * `ChunkStack` with `clip`) are one line. Off for one occupant at most: the relief takes
   * one occupant's cut.
   */
  keepBed?: boolean;
  /** told what the stage does for the occupant, whenever that changes; all `false` once the stage is gone */
  onStage?: (state: SceneryStageOccupantState) => void;
  /**
   * With a relief: told the ground as the relief draws it over the
   * occupant (its `outline`'s bounds, or the stage's `bounds` without one), as a
   * `HeightFieldClip` — hand it to a `ChunkStack` built on the relief (`clip`), whose
   * faces then end where the ground is drawn — and null once there is none. Live only
   * while the stage draws the occupant's seabed (`onStage`). Over that region a tile's
   * error then shows no more than half a pixel.
   */
  onGround?: (clip: HeightFieldClip | null) => void;
  /**
   * The occupant's own group, which the stage places on the sky's globe (see `SceneryAnchor`),
   * about the middle of its `outline` (or of `bounds` without one): for an occupant drawn
   * outside the `Scenery`. On the globe's disc — the stage's own `bounds` — nothing moves; an
   * occupant beyond it is placed onto the globe where it lies. It is set back as it was
   * once the stage lets go of it. ⚠️ Its matrix is the stage's (its position, rotation and
   * scale are not read meanwhile): give it a group of its own.
   */
  anchor?: RefObject<Object3D | null>;
};

/**
 * A layer a {@link SceneryStage} draws: the sea `surface`; the flat `bed` without a relief;
 * and the `relief`, when it has one, and its overview.
 */
export type SceneryStageLayer = 'surface' | 'bed' | 'relief';

// The layers drawn as plain meshes, which the wireframe view can draw too.
type StagePartLayer = Exclude<SceneryStageLayer, 'relief'>;

/**
 * Land and seabed around a {@link SceneryStage}, drawn from tiles: reliefs from the store
 * merged, covering everything out to the sea's horizon, the stage's own area and its
 * occupants included. It is land where it rises above the sea, lit and fading into the air
 * as the far sea does, and seabed below it, seen through the water as the stage's own is.
 * See-through at the sea's seabed opacity over the stage's own area only.
 */
export type SceneryStageRelief = {
  /**
   * The reliefs in the store — `relief-meta` records (`ReliefMeta`) and their
   * `relief-values` — coarse to fine: later ones win where they have data. Read by the
   * `sceneryReliefTile` generator, so it needs a `GeneratorsProvider`. Where the ground in view
   * reaches past the camera's far plane, the first is also drawn past the tiles as an
   * overview, from anywhere on the Earth, read by the `sceneryRelief` generator; a layer in
   * longitude and latitude all the way round (a world relief) covers it everywhere.
   */
  layers: ReliefLayer[];
  /** the flat seabed where no layer has data, metres below the sea. Default the sea's depth */
  depth?: number;
  /** The most a tile's error may show on screen, in pixels. Default 2 */
  pixelError?: number;
  /**
   * the most a tile's cell may span on screen, in pixels, where finer data
   * lies under it and the ground is rough. The relief is shaded from its tiles' cells —
   * slopes, the coast, the colour by height — so this, not the error, keeps it sharp from
   * high up, where the ground's error shows as next to nothing. Not applied with the
   * camera under the ground, where the tiles' tops face away. Default 8
   */
  cellPixels?: number;
  /** Told what the tiles draw and hold, every few frames */
  onStats?: (stats: SceneryReliefTileStats) => void;
  /**
   * told the relief's sampler (see `ReliefSampler`), for what is placed on
   * the relief: hand it on through `SurfaceSamplerContext`, and to a `ChunkStack` built
   * on the relief (`reliefSampler`). A new one whenever the ground under a pin comes in;
   * null once gone
   */
  onSampler?: (sampler: ReliefSampler | null) => void;
  /**
   * where the scene lies on the map: default the enclosing `World`'s frame, which keeps the
   * relief, the fields and the sun in one place. `geoFrameAt` makes one about a longitude
   * and latitude. Without either, no relief is drawn.
   */
  frame?: GeoFrame;
  /**
   * How the land and seabed are coloured: one colour for the land, the seabed taking the
   * sea's; or by height through a colour ramp — a terrain ramp, or any other, such as
   * `'rainbow'` — over a range of heights, the seabed the sea's, the same ramp, or a ramp of
   * its own (see {@link ReliefColorRamp}). `'ramp'` is `{ ramp: 'terrain' }`. Changing it
   * builds nothing again. Default `#34433b`, a dark green-grey
   */
  color?: ReliefColor;
  /** contour lines over it (see {@link ReliefContours}); `true` for the defaults. Default none */
  contours?: boolean | ReliefContours;
  /**
   * a look of its own for a layer, by its id: its `color` and `contours` where it gave the
   * ground, over the relief's (a local survey by a rainbow and 10 m contours, say). Where
   * layers overlap, the ground is the one that gave most of it, node by node.
   */
  layerLooks?: Record<string, ReliefLook>;
};

/**
 * Views for seeing how a stage fits the sky and its occupant (and see `SceneryDebug.tint`).
 * They only change what is drawn: nothing is rebuilt or baked again.
 */
export type SceneryStageDebug = {
  /** layers not to draw */
  hide?: SceneryStageLayer[];
  /** draw the occupants' outlines at the sea's seabed (white) and at its surface (black), and `bounds` (grey), over everything; with the void's walls, both again faintly at their foot */
  outline?: boolean;
  /** draw the triangles of every layer drawn, over everything, in the colour `SceneryDebug.tint` gives it */
  wireframe?: boolean;
  /**
   * With a relief: `'tiles'` tints each tile by its depth and outlines it; `'layers'`
   * colours each node by the layer that gave it (grey for the flat base). Recompiles the
   * relief's material.
   */
  relief?: SceneryReliefTileDebug;
};

/**
 * SceneryStage props
 * @expand
 */
export type SceneryStageProps = {
  /** the scene's rectangle, `[minX, minZ, maxX, maxZ]` in scene X/Z; it should hold the whole scene */
  bounds: SceneryStageBounds;
  /** what claims parts of the stage: field columns, say. The relief knows the outlines of 4 at most */
  occupants?: SceneryStageOccupant[];
  /** land and seabed, drawn from tiles (see {@link SceneryStageRelief}); none by default, and a flat seabed */
  relief?: SceneryStageRelief;
  /** debug views (see {@link SceneryStageDebug}) */
  debug?: SceneryStageDebug;
};

/**
 * Real geometry between the scene and the endless sea of a {@link Scenery} with `ocean`: the
 * same sea and seabed, drawn with the sky's own shading so it has no seam with the
 * background. Being geometry, it puts the water in front of the scene — what lies under
 * the surface is seen through it — and the seabed hides what is below it (all of it at
 * the sea's `seabedOpacity` of 1), unless the camera is below it too.
 *
 * It reaches the camera's far plane beyond `bounds`, so every view ray that can reach
 * the scene crosses it rather than the sky's background. With the sky's `globe` its
 * geometry stays flat, but beyond the disc that holds `bounds` it shades the sea falling
 * away with the Earth's curve, as the background does.
 *
 * Its `occupants` claim parts of the stage: field columns, say, each by its footprint.
 *
 * A `relief` puts land and seabed from the store everywhere, drawn from tiles. It is the
 * ground over the occupants too: kept whole under their cuts unless one's `keepBed` is
 * off, and handed out to each as drawn (`onGround`). Without one, the stage draws a flat
 * seabed at the sea's depth, and the occupants draw their own.
 *
 * ⚠️ Assumes the default `up` (+Y). Renders nothing without a sky ocean.
 *
 * @group Components
 */
export const SceneryStage = ({
  bounds,
  occupants,
  relief,
  debug,
}: SceneryStageProps) => {
  const ocean = useSceneryOcean();
  const sky = ocean?.material ?? null;
  const far = useThree(state => state.camera.far);
  const reach = Math.min(far, STAGE_REACH);
  const [minX, minZ, maxX, maxZ] = bounds;
  const claims = occupants ?? NO_OCCUPANTS;
  const level = ocean?.level ?? 0;
  const bedY = level - (ocean?.depth ?? 0);
  // The sky's own sea has water; without it every part of the stage lies dry.
  const wet = ocean?.water ?? true;
  // Without a seabed, the stage draws none, nor a relief: the void lies below the water.
  const hasBed = ocean?.seabed ?? true;
  const seabedOpacity = ocean?.seabedOpacity ?? 1;
  const seeThrough = seabedOpacity < 1;
  const bedDetail = ocean?.bedDetail;
  const abyssWalls = ocean?.abyssWalls;

  const extent: SceneryStageBounds = useMemo(
    () => [minX - reach, minZ - reach, maxX + reach, maxZ + reach],
    [minX, minZ, maxX, maxZ, reach],
  );
  // The water's, and the flat seabed's without a relief.
  const plane = useMemo(
    () => createSceneryStagePlane([minX, minZ, maxX, maxZ], extent),
    [minX, minZ, maxX, maxZ, extent],
  );
  useEffect(() => () => plane.dispose(), [plane]);

  // The relief's looks, and its layers', as its shaders read them: a texture, so a change
  // of colour or contours is an upload, never a new program.
  const looks = useMemo(() => new SceneryReliefLooks(), []);
  useEffect(() => () => looks.dispose(), [looks]);
  // Inline objects every render: compared by value.
  const lookKey = relief
    ? JSON.stringify([
        relief.color,
        relief.contours,
        relief.layerLooks,
        relief.layers.map(layer => layer.id),
      ])
    : '';
  useEffect(() => {
    if (!relief) return;
    looks.update(
      { color: relief.color, contours: relief.contours },
      relief.layers.map(layer => relief.layerLooks?.[layer.id]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looks, lookKey]);

  // A relief covers everything, the stage's own area included, and the stage draws no
  // seabed of its own; only where the sea has one. Read in its own frame, or the World's.
  const world = useWorld();
  const reliefFrame = relief?.frame ?? world?.frame ?? null;
  const tiled = !!relief?.layers.length && hasBed && !!reliefFrame;

  // A relief is placed by latitude and longitude: the globe lies on the Earth where its
  // frame says, the World's (set by the Scenery) or, without a World, the relief's own.
  const ownFrame = !world && relief?.frame ? JSON.stringify(relief.frame) : '';
  useLayoutEffect(() => {
    if (!sky || !ownFrame) return;
    sky.globe.setFrame(JSON.parse(ownFrame) as GeoFrame);
    return () => sky.globe.setFrame(null);
  }, [sky, ownFrame]);

  const generator = useGenerator<SceneryReliefResponse>(sceneryRelief);
  // The first (coarsest) layer is the overview past the tiles, made the first time the
  // ground in view reaches past the far plane.
  const reliefId = tiled ? (relief?.layers[0]?.id ?? null) : null;

  const materials = useMemo(
    () =>
      sky && {
        surface: createSceneryStageMaterial(sky, 'surface', {
          curvedDepth: tiled,
        }),
        bed: createSceneryStageMaterial(sky, 'bed', { seeThrough }),
      },
    // The seabed's detail is compiled in, from the sky's defines: a new one needs new materials.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sky, bedDetail, abyssWalls, seeThrough, tiled],
  );

  // The occupants' outlines, for the relief: over them the cutaway takes
  // the water, not the ground; and one occupant, its `keepBed` off, cuts the relief there.
  const outlines = useStableList(claims.map(claim => claim.outline ?? null));
  const fielded = useMemo(() => {
    if (!tiled) return null;
    const at = new Map<number, number>();
    const fields: PolygonDistanceField[] = [];
    outlines.forEach((shape, i) => {
      if (!shape || fields.length >= SKY_RELIEF_MAX_OCCUPANTS) return;
      const field = polygonDistanceField(
        shape.coordinates as PlanarPolygonCoordinates,
        shape.offset,
      );
      if (!field) return;
      at.set(i, fields.length);
      fields.push(field);
    });
    return fields.length > 0
      ? { at, fields: new SceneryReliefOccupantFields(fields) }
      : null;
  }, [tiled, outlines]);
  useEffect(() => () => fielded?.fields.dispose(), [fielded]);
  const cutters = tiled
    ? claims.flatMap((claim, i) =>
        claim.keepBed === false &&
        claim.cut &&
        (claim.cut.plane || claim.cut.fence) &&
        fielded?.at.has(i)
          ? [i]
          : [],
      )
    : [];
  const cutter = cutters.length > 0 ? cutters[0] : -1;
  const reliefCut = cutter >= 0 ? claims[cutter].cut : undefined;
  const reliefCutAt = cutter >= 0 ? (fielded?.at.get(cutter) ?? -1) : -1;
  const tooManyCutters = cutters.length > 1;
  useEffect(() => {
    if (tooManyCutters)
      console.warn(
        'SceneryStage: the relief takes one occupant’s cut — `keepBed` is off for more than one; the first cuts it.',
      );
  }, [tooManyCutters]);
  const reliefOccupants = useMemo<SceneryReliefTileOccupants | undefined>(
    () =>
      fielded
        ? {
            fields: fielded.fields,
            cut:
              reliefCut && reliefCutAt >= 0
                ? { index: reliefCutAt, with: reliefCut }
                : undefined,
          }
        : undefined,
    // The cut by its uniform objects: an inline `cut` is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fielded, reliefCutAt, reliefCut?.plane, reliefCut?.fence],
  );

  // While an occupant's cut opens the relief over it, the void's walls show through it from
  // above.
  const openingPlane = reliefCut?.plane;
  const openingFence = reliefCut?.fence;
  useEffect(() => {
    if (!sky || (!openingPlane && !openingFence)) return;
    const open = () => {
      const cutting = openingPlane?.value;
      return (
        (!!cutting &&
          (cutting.x !== 0 || cutting.y !== 0 || cutting.z !== 0)) ||
        (openingFence?.params.value.x ?? 0) > 0.5
      );
    };
    sky.abyssOpenings.add(open);
    return () => {
      sky.abyssOpenings.delete(open);
    };
  }, [sky, openingPlane, openingFence]);

  useEffect(
    () => () => {
      if (!materials) return;
      for (const material of Object.values(materials)) material.dispose();
    },
    [materials],
  );

  useLayoutEffect(() => {
    if (!sky) return;
    // Out to the far plane (stage-vertex keeps its vertices inside), as far as STAGE_REACH:
    // any shorter, and the scene between would show through the sky's sea, drawn on the far
    // plane. On the globe it claims nothing while the camera is off its rectangle, or on the
    // far half of the Earth (SceneryMaterial's claimStage).
    sky.setOceanStage(extent, reach);
    // Flat over the stage's whole area, so the scene and the ground about it meet level:
    // the globe's disc.
    sky.setFlatSea([minX, minZ, maxX, maxZ]);
    return () => {
      sky.setOceanStage(null);
      sky.setFlatSea(null);
    };
  }, [sky, extent, reach, minX, minZ, maxX, maxZ]);

  // The relief's ground under the camera, which the sky takes for its own there: the
  // seabed below the sea surface, and in the ground above it, rock.
  const reliefGround = useRef<number | null>(null);
  // How its tiles load, for the sky's progress.
  const reportRelief = ocean?.relief;
  const reliefKey = useMemo(() => ({}), []);
  const reliefLoading = useCallback(
    (loading: SceneryReliefLoading | null) =>
      reportRelief?.(reliefKey, loading),
    [reportRelief, reliefKey],
  );
  useEffect(() => {
    if (!sky || !tiled) return;
    return () => {
      sky.oceanGround = null;
    };
  }, [sky, tiled]);

  // The cutaway's size, from the first occupant's footprint.
  const radiusOutline = outlines.find(o => o) ?? null;
  useEffect(() => {
    if (!sky || !radiusOutline) return;
    const [x0, z0, x1, z1] = outlineSquare(radiusOutline);
    sky.occupantRadius = Math.hypot(x1 - x0, z1 - z0) / 2;
    return () => {
      sky.occupantRadius = null;
    };
  }, [sky, radiusOutline]);

  const surface = useRef<Mesh>(null);
  const surfaceShown = !debug?.hide?.includes('surface');
  // Each occupant's group, placed about the middle of its outline, or of `bounds`.
  const anchors = useStableList(claims.map(claim => claim.anchor ?? null));
  const anchorCentres = useMemo(
    () =>
      outlines.map((shape): [number, number] => {
        const [x0, z0, x1, z1] = shape
          ? outlineSquare(shape)
          : [minX, minZ, maxX, maxZ];
        return [(x0 + x1) / 2, (z0 + z1) / 2];
      }),
    [outlines, minX, minZ, maxX, maxZ],
  );
  // The occupants' objects last placed, put back as they were once the stage lets go.
  const placed = useRef<Object3D[]>([]);
  useEffect(
    () => () => {
      for (const object of placed.current) releaseFromGlobe(object);
      placed.current = [];
    },
    [anchors],
  );
  useFrame(({ camera }) => {
    if (!sky || !ocean) return;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const now: Object3D[] = [];
    anchors.forEach((anchor, i) => {
      const object = anchor?.current;
      if (!object) return;
      const [ax, az] = anchorCentres[i] ?? [cx, cz];
      placeOnGlobe(object, sky.globe, ax, az);
      now.push(object);
    });
    for (const object of placed.current) {
      if (now.includes(object)) continue;
      releaseFromGlobe(object);
    }
    placed.current = now;
    // Under the seabed's level the void's lid hides the water, seabed or not: the surface
    // would discard every pixel. In the relief's ground above it the camera is in rock
    // (SceneryMaterial.oceanBuried), where none of the sea shows either.
    const altitude = sky.globe.altitude(camera.position);
    const underRelief = tiled ? reliefGround.current : null;
    const bed = sky.oceanLevel - sky.oceanDepth;
    const y = sky.oceanLevel + altitude;
    const buried = underRelief !== null && y <= underRelief && y > bed;
    if (surface.current)
      surface.current.visible =
        surfaceShown && altitude + sky.oceanDepth >= 0 && !buried;
    if (!tiled) return;
    // No deeper than the sea's own seabed: under it lies the void, wherever the relief is
    // deeper (documents/tiles.md, Costs and risks).
    sky.oceanGround = underRelief === null ? null : Math.max(underRelief, bed);
  });

  // Told on every change: the occupant draws its own seabed whenever the stage does not,
  // and its own water only while the stage does not own it. The relief is the occupant's
  // seabed.
  const seabedDrawn = tiled && !!ocean?.visible && !!ocean.ready;
  const ownsWater = !!ocean?.visible;
  const listeners = useStableList(claims.map(claim => claim.onStage ?? null));
  const onStage = useRef(listeners);
  useLayoutEffect(() => {
    onStage.current = listeners;
  });
  useEffect(() => {
    for (const listener of listeners)
      listener?.({ seabed: seabedDrawn, seabedOpacity, water: ownsWater });
  }, [listeners, seabedDrawn, seabedOpacity, ownsWater]);
  useEffect(
    () => () => {
      for (const listener of onStage.current)
        listener?.({ seabed: false, seabedOpacity: 1, water: false });
    },
    [],
  );

  // The ground handed out over each occupant that asks for it.
  const groundRequests = claims.flatMap((claim, i) =>
    claim.onGround
      ? [
          {
            bounds: outlines[i]
              ? outlineSquare(outlines[i]!)
              : ([minX, minZ, maxX, maxZ] as SceneryStageBounds),
            onGround: claim.onGround,
          },
        ]
      : [],
  );

  const setView = useCallback(
    (renderer: WebGLRenderer, _: Scene, camera: Camera) =>
      sky?.setStageView(renderer, camera),
    [sky],
  );

  const showOutline = debug?.outline === true;
  const drawnOutlines = useMemo(
    () => outlines.filter((shape): shape is PlanarPolygonGeometry => !!shape),
    [outlines],
  );
  const outlineLines = useMemo(
    () =>
      showOutline
        ? createSceneryStageOutline(
            [minX, minZ, maxX, maxZ],
            drawnOutlines,
            level,
            bedY,
          )
        : null,
    [showOutline, minX, minZ, maxX, maxZ, drawnOutlines, level, bedY],
  );
  useEffect(() => () => outlineLines?.dispose(), [outlineLines]);
  const footprintLines = useMemo(
    () =>
      showOutline && abyssWalls
        ? createSceneryStageFootprint([minX, minZ, maxX, maxZ], drawnOutlines)
        : null,
    [showOutline, abyssWalls, minX, minZ, maxX, maxZ, drawnOutlines],
  );
  useEffect(() => () => footprintLines?.dispose(), [footprintLines]);
  const footprint = useRef<LineSegments>(null);
  // At the void walls' foot, wherever their depth puts it.
  useFrame(() => {
    if (!footprint.current || !sky) return;
    const grid = sky.uniforms.uSkyAbyssWallGrid.value as Vector3;
    footprint.current.position.y = sky.abyssLevel - grid.z;
  });
  const lineMaterial = useMemo(
    () =>
      new LineBasicMaterial({
        vertexColors: true,
        // In the transparent list, so the default render draws it after the water.
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => lineMaterial.dispose(), [lineMaterial]);

  const showWireframe = debug?.wireframe === true;
  const wireMaterials = useMemo(() => {
    if (!showWireframe) return null;
    const made = {} as Record<StagePartLayer, MeshBasicMaterial>;
    for (const layer of Object.keys(WIRE_COLORS) as StagePartLayer[]) {
      made[layer] = new MeshBasicMaterial({
        color: WIRE_COLORS[layer],
        wireframe: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
    }
    return made;
  }, [showWireframe]);
  useEffect(
    () => () => {
      if (!wireMaterials) return;
      for (const material of Object.values(wireMaterials)) material.dispose();
    },
    [wireMaterials],
  );

  const shown = (layer: SceneryStageLayer) => !debug?.hide?.includes(layer);

  // Compiled with the sky before either is drawn; again when the parts may have changed.
  const root = useRef<Group>(null);
  const register = ocean?.stage;
  useLayoutEffect(() => {
    if (!register || !root.current) return;
    return register(root.current);
  }, [
    register,
    materials,
    plane,
    wet,
    hasBed,
    tiled,
    wireMaterials,
    outlineLines,
  ]);

  if (!ocean || !materials) return null;

  const parts: {
    key: string;
    layer: StagePartLayer;
    geometry: BufferGeometry;
    material: ShaderMaterial;
    y?: number;
    order?: number;
  }[] = [];
  if (wet) {
    parts.push({
      key: 'surface',
      layer: 'surface',
      geometry: plane,
      material: materials.surface,
      y: level,
      order: SURFACE_ORDER,
    });
  }
  // A relief's tiles are the seabed, everywhere.
  if (hasBed && !tiled) {
    parts.push({
      key: 'bed',
      layer: 'bed',
      geometry: plane,
      material: materials.bed,
      y: bedY,
    });
  }

  return (
    <group ref={root} visible={ocean.visible && ocean.ready}>
      {tiled && relief && reliefId && sky && (
        <SceneryStageReliefOverview
          sky={sky}
          reliefId={reliefId}
          generator={generator}
          looks={looks.texture}
          reach={far}
          bedDetail={bedDetail}
          skyOrder={ocean.renderOrder + 1}
          visible={shown('relief')}
        />
      )}
      {tiled && relief && reliefFrame && sky && (
        <SceneryStageReliefTiles
          sky={sky}
          source={{
            layers: relief.layers,
            base: -(relief.depth ?? ocean.depth),
          }}
          looks={looks.texture}
          reach={far}
          level={level}
          pixelError={relief.pixelError ?? 2}
          cellPixels={relief.cellPixels ?? 8}
          bedDetail={bedDetail}
          visible={shown('relief')}
          onStats={relief.onStats}
          onLoading={reliefLoading}
          cameraGround={reliefGround}
          stage={[minX, minZ, maxX, maxZ]}
          seeThrough={seeThrough}
          debug={debug?.relief}
          grounds={groundRequests}
          groundLive={seabedDrawn}
          occupants={reliefOccupants}
          onSampler={relief.onSampler}
        />
      )}
      {parts.map(part => (
        <mesh
          key={part.key}
          ref={part.key === 'surface' ? surface : undefined}
          geometry={part.geometry}
          material={part.material}
          position-y={part.y ?? 0}
          renderOrder={part.order ?? 0}
          // The surface's is set each frame too.
          visible={shown(part.layer)}
          onBeforeRender={setView}
        />
      ))}
      {wireMaterials &&
        parts.map(
          part =>
            shown(part.layer) && (
              <mesh
                key={`wire-${part.key}`}
                geometry={part.geometry}
                material={wireMaterials[part.layer]}
                position-y={part.y ?? 0}
                renderOrder={OUTLINE_ORDER}
                layers={OVERLAY_LAYERS}
                frustumCulled={false}
              />
            ),
        )}
      {outlineLines && (
        <lineSegments
          geometry={outlineLines}
          material={lineMaterial}
          renderOrder={OUTLINE_ORDER + 1}
          layers={OVERLAY_LAYERS}
          frustumCulled={false}
        />
      )}
      {footprintLines && (
        <lineSegments
          ref={footprint}
          geometry={footprintLines}
          material={lineMaterial}
          renderOrder={OUTLINE_ORDER + 1}
          layers={OVERLAY_LAYERS}
          frustumCulled={false}
        />
      )}
    </group>
  );
};
