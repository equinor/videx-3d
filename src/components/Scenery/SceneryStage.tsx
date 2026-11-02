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
import { createLayers, LAYERS } from '../../layers/layers';
import { releaseMaterial } from '../../rendering/precompile';
import type {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from '../../sdk/geometries/planar-geometry';
import {
  PolygonDistanceField,
  polygonDistanceField,
} from '../../sdk/geometries/polygon-distance-field';
import type { CutUniforms } from '../../sdk/materials/fence-field';
import type { HeightFieldClip } from '../../sdk/materials/height-field-clip';
import {
  SKY_RELIEF_MAX_OCCUPANTS,
  SceneryReliefOccupantFields,
  SceneryReliefTileOccupants,
} from './scenery-relief-tiles';
import { useSceneryOcean } from './scenery-context';
import { placeOnGlobe, releaseFromGlobe } from './scenery-anchor';
import { useWorld } from '../World/world-context';
import {
  useWorldRelief,
  WorldReliefGroundRequest,
  WorldReliefStage,
} from '../World/world-relief';
import {
  createSceneryStageMaterial,
  createSceneryStageOutline,
  createSceneryStageFootprint,
  createSceneryStagePlane,
  SceneryStageBounds,
} from './scenery-stage';

// The farthest from the camera the stage draws the sea, past which the sky's own does: the
// far plane, but no farther. Its flat planes, sunk under a camera far off, cannot stand for
// the globe much beyond; from space the sky draws all of it.
const STAGE_REACH = 3000000;
const NO_OCCUPANTS: SceneryStageOccupant[] = [];
// Where neither the stage nor its World gives bounds: nothing is drawn.
const NO_BOUNDS: SceneryStageBounds = [0, 0, 0, 0];

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
const WIRE_COLORS: Record<SceneryStageLayer, string> = {
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
 * A layer a {@link SceneryStage} draws: the sea `surface`; and the flat `bed` where no
 * `GeoRelief` is the seabed.
 */
export type SceneryStageLayer = 'surface' | 'bed';

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
};

/**
 * SceneryStage props
 * @expand
 */
export type SceneryStageProps = {
  /**
   * the scene's rectangle, `[minX, minZ, maxX, maxZ]` in scene X/Z; it should hold the whole
   * scene. Default the enclosing `World`'s `bounds`, the globe's flat disc: given both, keep
   * them the same. Without either, nothing is drawn
   */
  bounds?: SceneryStageBounds;
  /** what claims parts of the stage: field columns, say. The relief knows the outlines of 4 at most */
  occupants?: SceneryStageOccupant[];
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
 * A `GeoRelief` in the `World` is its seabed, everywhere: the ground over the occupants
 * too, kept whole under their cuts unless one's `keepBed` is off, and handed out to each as
 * drawn (`onGround`). Without one, the stage draws a flat seabed at the sea's depth, and the
 * occupants draw their own.
 *
 * ⚠️ Assumes the default `up` (+Y). Renders nothing without a sky ocean.
 *
 * @group Components
 */
export const SceneryStage = ({
  bounds: givenBounds,
  occupants,
  debug,
}: SceneryStageProps) => {
  const ocean = useSceneryOcean();
  const sky = ocean?.material ?? null;
  const far = useThree(state => state.camera.far);
  // Its materials are let go once their programs have linked (`releaseMaterial`): a swap
  // (a relief coming in, `curvedDepth`) may come while the sky still compiles them.
  const gl = useThree(state => state.gl);
  const reach = Math.min(far, STAGE_REACH);
  const world = useWorld();
  const bounds = givenBounds ?? world?.bounds ?? null;
  const hasBounds = bounds !== null;
  const [minX, minZ, maxX, maxZ] = bounds ?? NO_BOUNDS;
  // A World's bounds are its globe's disc, which it sets; a World given none leaves its
  // globe's disc to the stage. Without a World, the sky's own globe takes it from the sky.
  const setsWorldDisc = !!world && !world.bounds;
  const claims = occupants ?? NO_OCCUPANTS;
  const level = ocean?.level ?? 0;
  const bedY = level - (ocean?.depth ?? 0);
  // The sky's own sea has water; without it every part of the stage lies dry.
  const wet = ocean?.water ?? true;
  // Without a seabed, the stage draws none, nor a relief: the void lies below the water.
  const hasBed = ocean?.seabed ?? true;
  const seabedOpacity = ocean?.seabedOpacity ?? 1;
  const seeThrough = seabedOpacity < 1;
  const definesKey = ocean?.definesKey;
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

  // The World's relief covers everything, the stage's own area included, and the stage draws
  // no seabed of its own; only where the sea has one.
  const worldRelief = useWorldRelief();
  const tiled = !!worldRelief?.present && hasBed;

  const materials = useMemo(
    () =>
      sky && {
        surface: createSceneryStageMaterial(sky, 'surface', {
          curvedDepth: tiled,
        }),
        bed: createSceneryStageMaterial(sky, 'bed', { seeThrough }),
      },
    // The sky's defines are compiled in (the seabed's detail, the graticule): new ones need new materials.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sky, definesKey, abyssWalls, seeThrough, tiled],
  );

  // The occupants' outlines, for the relief: over them the cutaway takes
  // the water, not the ground; and one occupant, its `keepBed` off, cuts the relief there.
  // Made whether a relief is there yet or not, so one coming is compiled with them at once.
  const outlines = useStableList(claims.map(claim => claim.outline ?? null));
  const fielded = useMemo(() => {
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
  }, [outlines]);
  useEffect(() => () => fielded?.fields.dispose(), [fielded]);
  const cutters = claims.flatMap((claim, i) =>
    claim.keepBed === false &&
    claim.cut &&
    (claim.cut.plane || claim.cut.fence) &&
    fielded?.at.has(i)
      ? [i]
      : [],
  );
  const cutter = cutters.length > 0 ? cutters[0] : -1;
  const reliefCut = cutter >= 0 ? claims[cutter].cut : undefined;
  const reliefCutAt = cutter >= 0 ? (fielded?.at.get(cutter) ?? -1) : -1;
  const tooManyCutters = tiled && cutters.length > 1;
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
  const openingPlane = tiled ? reliefCut?.plane : undefined;
  const openingFence = tiled ? reliefCut?.fence : undefined;
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
      for (const material of Object.values(materials))
        releaseMaterial(gl, material);
    },
    [gl, materials],
  );

  useLayoutEffect(() => {
    if (!sky || !hasBounds) return;
    // Out to the far plane (stage-vertex keeps its vertices inside), as far as STAGE_REACH:
    // any shorter, and the scene between would show through the sky's sea, drawn on the far
    // plane. On the globe it claims nothing while the camera is off its rectangle, or on the
    // far half of the Earth (SceneryMaterial's claimStage).
    sky.setOceanStage(extent, reach);
    // Flat over the stage's whole area, so the scene and the ground about it meet level:
    // the globe's disc, unless the World holds it.
    sky.setFlatSea([minX, minZ, maxX, maxZ]);
    if (setsWorldDisc) sky.globe.setDisc([minX, minZ, maxX, maxZ]);
    return () => {
      sky.setOceanStage(null);
      sky.setFlatSea(null);
      if (setsWorldDisc) sky.globe.setDisc(null);
    };
  }, [sky, extent, reach, minX, minZ, maxX, maxZ, setsWorldDisc, hasBounds]);

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
    const underRelief = tiled ? (worldRelief?.ground.current ?? null) : null;
    const bed = sky.oceanLevel - sky.oceanDepth;
    const y = sky.oceanLevel + altitude;
    const buried = underRelief !== null && y <= underRelief && y > bed;
    if (surface.current)
      surface.current.visible =
        surfaceShown && altitude + sky.oceanDepth >= 0 && !buried;
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

  // The ground handed out over each occupant that asks for it, by its latest callback: one
  // written inline is new every render.
  const groundClaims = claims.flatMap(claim =>
    claim.onGround
      ? [
          {
            bounds: (claim.outline
              ? outlineSquare(claim.outline)
              : [minX, minZ, maxX, maxZ]) as [number, number, number, number],
            onGround: claim.onGround,
          },
        ]
      : [],
  );
  const latestGrounds = useRef(groundClaims);
  useLayoutEffect(() => {
    latestGrounds.current = groundClaims;
  });
  const groundsKey = JSON.stringify(groundClaims.map(claim => claim.bounds));
  const grounds = useMemo<WorldReliefGroundRequest[]>(
    () =>
      (JSON.parse(groundsKey) as [number, number, number, number][]).map(
        (square, i) => ({
          bounds: square,
          onGround: clip => latestGrounds.current[i]?.onGround(clip),
        }),
      ),
    [groundsKey],
  );
  // What only a stage asks of the World's relief: see-through over its area, its occupants'
  // outlines and cut, and their ground.
  const provideStage = worldRelief?.provideStage;
  const stagePart = useMemo<WorldReliefStage | null>(
    () =>
      hasBounds
        ? {
            bounds: [minX, minZ, maxX, maxZ],
            seeThrough,
            occupants: reliefOccupants,
            grounds,
            groundLive: seabedDrawn,
          }
        : null,
    [
      hasBounds,
      minX,
      minZ,
      maxX,
      maxZ,
      seeThrough,
      reliefOccupants,
      grounds,
      seabedDrawn,
    ],
  );
  useLayoutEffect(
    () => (stagePart && provideStage ? provideStage(stagePart) : undefined),
    [stagePart, provideStage],
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
    const made = {} as Record<SceneryStageLayer, MeshBasicMaterial>;
    for (const layer of Object.keys(WIRE_COLORS) as SceneryStageLayer[]) {
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

  if (!ocean || !materials || !hasBounds) return null;

  const parts: {
    key: string;
    layer: SceneryStageLayer;
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
