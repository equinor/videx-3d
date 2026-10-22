import { useFrame, useThree } from '@react-three/fiber';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BufferGeometry,
  Camera,
  ColorRepresentation,
  Group,
  LineBasicMaterial,
  MeshBasicMaterial,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three';
import { useGenerator } from '../../hooks/useGenerator';
import { createLayers, LAYERS } from '../../layers/layers';
import type { ReliefFrame, ReliefGrid } from '../../sdk/geometries/relief-grid';
import type { SeabedMesh } from '../../sdk/geometries/surface-clip';
import { createTinSampler } from '../../sdk/geometries/tin-sampler';
import type { CutUniforms } from '../../sdk/materials/fence-field';
import { SkyBoxStageReliefLayer } from './SkyBoxStageReliefLayer';
import { useSkyOcean } from './sky-context';
import { skyRelief, SkyReliefResponse } from './sky-defs';
import {
  createSkyStageBed,
  createSkyStageFalloff,
  createSkyStageMaterial,
  createSkyStageOutline,
  createSkyStagePlane,
  createSkyStageRings,
  createSkyStageSeabed,
  SkyStageBounds,
  skyStageNearBounds,
  skyStageRim,
} from './sky-stage';

// Share of the far plane the stage draws the sea out to; the sky draws beyond, where
// the far plane would clip the stage.
const STAGE_REACH = 0.8;
// Room between the outline and the rings when there is no falloff to make room for.
const MIN_NEAR_MARGIN = 1000;
// A relief's flat land, a muted olive: rock and heath seen through the air.
const RELIEF_LAND_COLOR = '#837f63';
const RELIEF_FALLOFF = 10000;
// The least a relief's map reaches around the scene: the sea's horizon from some 300 km up.
const RELIEF_RADIUS = 2000000;

// Without OIT, see-through parts draw in this order: the scene's own (most of it under the
// sea), then the water over everything.
const SURFACE_ORDER = 1;
// Debug lines go over everything.
const OUTLINE_ORDER = 1e9;
// Drawn last by the OITRenderPass too, over its transparent layers.
const OVERLAY_LAYERS = createLayers(LAYERS.OVERLAY);
// Wireframe colours, as `SkyDebug.tint` colours the layers.
const WIRE_COLORS: Record<StagePartLayer, string> = {
  surface: '#1a59ff',
  bed: '#26cc33',
  falloff: '#00d9e6',
  'occupant-bed': '#ff1acc',
};

/** What a {@link SkyBoxStage} does for its occupant, as {@link SkyBoxStageOccupant.onStage} tells it. */
export type SkyBoxStageOccupantState = {
  /** the stage draws the occupant's seabed: the sea has one, and the sky is drawn and compiled. While false, draw your own */
  seabed: boolean;
  /** the opacity the stage draws it at, the sea's (`SkyOcean.seabedOpacity`): below 1, cull nothing under it */
  seabedOpacity: number;
  /** the stage owns the water over the occupant: it is under a drawn sky with a sea, with water or not. While true, draw none of your own */
  water: boolean;
};

/**
 * What claims part of a {@link SkyBoxStage}: a field column, say, which hands the stage
 * its seabed and is told what the stage does for it.
 */
export type SkyBoxStageOccupant = {
  /**
   * The occupant's seabed, in scene coordinates, which the stage draws as the sea's:
   * shaded, lit and fogged as the sky's, at its seabed opacity, eased into the sea's seabed
   * around it (see {@link SkyBoxStageProps.seabedFalloff}), and never cut by a cutaway,
   * which only takes the water over it. Its rim is the occupant's outline. Build it with
   * `createSeabedMesh`, or the `skySeabed` generator; a `ChunkStack` hands out its own
   * through `onSeabed` once built — the only one that meets its cut faces with no seam,
   * as a re-tessellation agrees with them only within its `maxError`. Without one, the
   * sea's flat seabed lies under the occupant too.
   *
   * ⚠️ At a seabed opacity of 1 it is drawn opaque and whole — or cut as `cut` cuts it — so
   * the occupant may cull whatever lies under it. Stop drawing your own while the stage
   * draws it (see `onStage`).
   */
  seabed?: SeabedMesh;
  /**
   * The occupant's own cut — a `ChunkStack`'s, from its `onCut` — which the stage cuts
   * the occupant's seabed with, as the occupant cuts itself. The same uniform objects, so
   * it follows the cut every frame; they must be in the scene frame.
   */
  cut?: CutUniforms;
  /** told what the stage does for the occupant, whenever that changes; all `false` once the stage is gone */
  onStage?: (state: SkyBoxStageOccupantState) => void;
};

/**
 * A layer a {@link SkyBoxStage} draws: the sea `surface`; the flat `bed` (beyond the
 * falloff, when there is one), the `falloff` easing from the occupant's seabed, and the
 * `occupant-bed`, the occupant's own; and beyond its own area the `relief`, when it has one.
 */
export type SkyBoxStageLayer =
  | 'surface'
  | 'bed'
  | 'falloff'
  | 'occupant-bed'
  | 'relief';

// The layers drawn as plain meshes, which the wireframe view can draw too.
type StagePartLayer = Exclude<SkyBoxStageLayer, 'relief'>;

/**
 * Land and seabed beyond a {@link SkyBoxStage}'s own area: a relief from the store, which
 * rises from the stage's flat seabed past its area and continues to the sea's horizon. It
 * is land where it rises above the sea, lit and fading into the air as the far sea does,
 * and seabed below it, seen through the water as the stage's own is. Always opaque: the
 * seabed is see-through only over the stage's own area.
 */
export type SkyBoxStageRelief = {
  /**
   * The relief in the store: a `relief-meta` record (a `SurfaceMeta`, with the relief's
   * `projection`) and its `relief-values`, heights in metres above mean sea level, NaN
   * for none. Read by the `skyRelief` generator, so it needs a `GeneratorsProvider`.
   */
  id: string;
  /** where the scene lies on the map; `reliefFrameAt` places a scene by its longitude and latitude */
  frame: ReliefFrame;
  /**
   * `'ramp'` colours the land by height — green lowland, umber upland, grey high ground —
   * and darkens the sea's seabed colour with depth; a colour is the land's, the seabed
   * taking the sea's. Default a muted olive
   */
  color?: 'ramp' | ColorRepresentation;
  /** how far past the stage's own area it rises from the stage's flat seabed, in world units. Default 10000 */
  falloff?: number;
};

/**
 * Views for seeing how a stage fits the sky and its occupant (and see `SkyDebug.tint`).
 * They only change what is drawn: nothing is rebuilt or baked again.
 */
export type SkyBoxStageDebug = {
  /** layers not to draw */
  hide?: SkyBoxStageLayer[];
  /** draw the outline along its seabed rim (white) and at the sea surface (black), and `bounds` (grey), over everything */
  outline?: boolean;
  /** draw the triangles of every layer drawn, over everything, in the colour `SkyDebug.tint` gives it */
  wireframe?: boolean;
};

/**
 * SkyBoxStage props
 * @expand
 */
export type SkyBoxStageProps = {
  /** the scene's rectangle, `[minX, minZ, maxX, maxZ]` in scene X/Z; it should hold the whole scene */
  bounds: SkyStageBounds;
  occupant?: SkyBoxStageOccupant;
  /** how far outside the occupant the seabed eases from its own to the sea's depth. Default 3000 */
  seabedFalloff?: number;
  /** land and seabed beyond the stage's own area (see {@link SkyBoxStageRelief}); none by default */
  relief?: SkyBoxStageRelief;
  /** debug views (see {@link SkyBoxStageDebug}) */
  debug?: SkyBoxStageDebug;
};

/**
 * Real geometry between the scene and the endless sea of a {@link Sky} with `ocean`: the
 * same sea and seabed, drawn with the sky's own shading so it has no seam with the
 * background. Being geometry, it puts the water in front of the scene — what lies under
 * the surface is seen through it — and the seabed hides what is below it (all of it at
 * the sea's `seabedOpacity` of 1), unless the camera is below it too.
 *
 * It reaches the camera's far plane beyond `bounds`, so every view ray that can reach
 * the scene crosses it rather than the sky's background. With the sky's `curvedHorizon` its
 * geometry stays flat, but beyond the disc that holds `bounds` it shades the sea falling
 * away with the Earth's curve, as the background does.
 *
 * An `occupant` claims part of the stage and hands it its seabed, which the stage draws as
 * the sea's, easing its own seabed into it around the occupant.
 *
 * A `relief` puts land and seabed from the store beyond the stage's own area: `bounds`,
 * and the occupant's with its falloff. Over that area the stage keeps its own seabed.
 *
 * ⚠️ Assumes the default `up` (+Y). Renders nothing without a sky ocean.
 *
 * @group Components
 */
export const SkyBoxStage = ({
  bounds,
  occupant,
  seabedFalloff = 3000,
  relief,
  debug,
}: SkyBoxStageProps) => {
  const ocean = useSkyOcean();
  const sky = ocean?.material ?? null;
  const far = useThree(state => state.camera.far);
  const [minX, minZ, maxX, maxZ] = bounds;
  const occupantSeabed = occupant?.seabed ?? null;
  const level = ocean?.level ?? 0;
  const bedY = level - (ocean?.depth ?? 0);
  // The sky's own sea has water; without it every part of the stage lies dry.
  const wet = ocean?.water ?? true;
  // Without a seabed, the stage draws none, nor the occupant's: the void lies below the water.
  const hasBed = ocean?.seabed ?? true;
  const seabedOpacity = ocean?.seabedOpacity ?? 1;
  const seeThrough = seabedOpacity < 1;
  const bedDetail = ocean?.bedDetail;

  // The occupant's seabed: its rim, which is the occupant's outline and where the falloff
  // meets it, the stage's mesh of it, and the ground under a camera in it.
  const rim = useMemo(
    () => (occupantSeabed ? skyStageRim(occupantSeabed) : null),
    [occupantSeabed],
  );
  const outline = rim?.outline ?? null;
  const seabedMesh = useMemo(
    () => (occupantSeabed ? createSkyStageSeabed(occupantSeabed) : null),
    [occupantSeabed],
  );
  const ground = useMemo(
    () =>
      occupantSeabed
        ? createTinSampler(occupantSeabed.positions, occupantSeabed.indices)
        : null,
    [occupantSeabed],
  );
  useEffect(() => () => seabedMesh?.dispose(), [seabedMesh]);

  const extent: SkyStageBounds = useMemo(
    () => [minX - far, minZ - far, maxX + far, maxZ + far],
    [minX, minZ, maxX, maxZ, far],
  );
  // The water's, and the seabed's without an occupant.
  const plane = useMemo(
    () => createSkyStagePlane([minX, minZ, maxX, maxZ], extent),
    [minX, minZ, maxX, maxZ, extent],
  );
  useEffect(() => () => plane.dispose(), [plane]);

  // Around an occupant: at least the falloff's width, so the falloff ends on the rings at
  // the seabed.
  const near = useMemo(
    () =>
      outline
        ? skyStageNearBounds(
            extent,
            outline,
            Math.max(seabedFalloff, MIN_NEAR_MARGIN),
          )
        : null,
    [extent, outline, seabedFalloff],
  );
  // A relief lies beyond the stage's own area, `bounds` and the occupant's near rectangle,
  // over which the stage keeps its own seabed; only where the sea has one.
  const reliefOn = !!relief && hasBed;
  const area = useMemo<SkyStageBounds | null>(
    () =>
      !reliefOn
        ? null
        : near
          ? [
              Math.min(minX, near[0]),
              Math.min(minZ, near[1]),
              Math.max(maxX, near[2]),
              Math.max(maxZ, near[3]),
            ]
          : [minX, minZ, maxX, maxZ],
    [reliefOn, near, minX, minZ, maxX, maxZ],
  );
  const rings = useMemo(
    () => (near ? createSkyStageRings(near, area ?? extent) : null),
    [near, area, extent],
  );
  useEffect(() => () => rings?.dispose(), [rings]);
  // Without an occupant the seabed lies on the plane, or under a relief on the area alone.
  const areaBed = useMemo(
    () => (area && !near ? createSkyStagePlane(area, area) : null),
    [area, near],
  );
  useEffect(() => () => areaBed?.dispose(), [areaBed]);

  const generator = useGenerator<SkyReliefResponse>(skyRelief);
  const reliefId = reliefOn ? relief.id : null;
  // By its content: a frame written inline is a new object every render.
  const frameKey = relief ? JSON.stringify(relief.frame) : '';
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const [reliefGrid, setReliefGrid] = useState<ReliefGrid | null>(null);
  useEffect(() => {
    if (!reliefId || !frameKey) {
      setReliefGrid(null);
      return;
    }
    let current = true;
    // Out to the far plane around the scene, and past a nearer one to the horizon, where the
    // relief's far layer draws it.
    generator(reliefId, JSON.parse(frameKey) as ReliefFrame, {
      center: [centerX, centerZ],
      radius: Math.max(far, RELIEF_RADIUS),
    }).then(grid => {
      if (current) setReliefGrid(grid ?? null);
    });
    return () => {
      current = false;
    };
  }, [generator, reliefId, frameKey, centerX, centerZ, far]);

  const falloff = useMemo(
    () =>
      hasBed && rim && near && seabedFalloff > 0
        ? createSkyStageFalloff(
            near,
            rim.outline,
            rim.elevations,
            bedY,
            seabedFalloff,
          )
        : null,
    [hasBed, near, rim, bedY, seabedFalloff],
  );

  const materials = useMemo(
    () =>
      sky && {
        surface: createSkyStageMaterial(sky, 'surface', {
          curvedDepth: reliefOn,
        }),
        bed: createSkyStageMaterial(sky, 'bed', { seeThrough }),
        falloffBed: createSkyStageMaterial(sky, 'falloff-bed', { seeThrough }),
      },
    // The seabed's detail is compiled in, from the sky's defines: a new one needs new materials.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sky, bedDetail, seeThrough, reliefOn],
  );

  // Apart from the rest, since the occupant's cut is compiled into it too.
  const cutPlane = occupant?.cut?.plane;
  const cutFence = occupant?.cut?.fence;
  const occupantBed = useMemo(
    () =>
      sky &&
      createSkyStageMaterial(sky, 'occupant-bed', {
        seeThrough,
        cut: { plane: cutPlane, fence: cutFence },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sky, bedDetail, seeThrough, cutPlane, cutFence],
  );

  // Around an occupant's seabed with no falloff to meet it, the flat seabed leaves it a hole.
  const bedAround = useMemo(
    () =>
      hasBed && near && outline && !falloff
        ? createSkyStageBed(near, outline)
        : null,
    [hasBed, outline, falloff, near],
  );
  useEffect(() => () => bedAround?.dispose(), [bedAround]);

  useEffect(() => () => falloff?.dispose(), [falloff]);

  useEffect(
    () => () => {
      if (!materials) return;
      for (const material of Object.values(materials)) material.dispose();
    },
    [materials],
  );

  useEffect(() => () => occupantBed?.dispose(), [occupantBed]);

  useLayoutEffect(() => {
    if (!sky) return;
    sky.setOceanStage(extent, far * STAGE_REACH);
    // Under a relief, flat over the stage's whole area, so its seabed and the relief meet level.
    sky.setFlatSea(area ?? [minX, minZ, maxX, maxZ]);
    return () => {
      sky.setOceanStage(null);
      sky.setFlatSea(null);
    };
  }, [sky, extent, far, area, minX, minZ, maxX, maxZ]);

  // The occupant's seabed under the camera, which the sky takes for its own there. Looked
  // up only below the sea surface and inside the occupant's bounds.
  const groundBounds = useMemo(
    () => (ground && outline ? outline.getBounds() : null),
    [ground, outline],
  );

  useEffect(() => {
    if (!sky || !groundBounds) return;
    return () => {
      sky.oceanGround = null;
    };
  }, [sky, groundBounds]);

  useEffect(() => {
    if (!sky || !outline) return;
    const { min, max } = outline.getBounds();
    sky.occupantRadius = Math.hypot(max[0] - min[0], max[1] - min[1]) / 2;
    return () => {
      sky.occupantRadius = null;
    };
  }, [sky, outline]);

  useFrame(({ camera }) => {
    if (!sky || !ocean || !groundBounds || !ground) return;
    const { x, y, z } = camera.position;
    const { min, max } = groundBounds;
    sky.oceanGround =
      y <= ocean.level &&
      x >= min[0] &&
      x <= max[0] &&
      z >= min[1] &&
      z <= max[1]
        ? ground.getHeightAt(x, z)
        : null;
  });

  // Told on every change: the occupant draws its own seabed whenever the stage does not,
  // and its own water only while the stage does not own it.
  const seabedDrawn =
    !!seabedMesh && hasBed && !!ocean?.visible && !!ocean.ready;
  const ownsWater = !!ocean?.visible;
  const onStage = useRef(occupant?.onStage);
  useLayoutEffect(() => {
    onStage.current = occupant?.onStage;
  });
  useEffect(() => {
    onStage.current?.({ seabed: seabedDrawn, seabedOpacity, water: ownsWater });
  }, [seabedDrawn, seabedOpacity, ownsWater]);
  useEffect(
    () => () =>
      onStage.current?.({ seabed: false, seabedOpacity: 1, water: false }),
    [],
  );

  const setView = useCallback(
    (renderer: WebGLRenderer, _: Scene, camera: Camera) =>
      sky?.setStageView(renderer, camera),
    [sky],
  );

  const showOutline = debug?.outline === true;
  const outlineLines = useMemo(
    () =>
      showOutline
        ? createSkyStageOutline(
            [minX, minZ, maxX, maxZ],
            outline,
            level,
            bedY,
            rim?.elevations,
          )
        : null,
    [showOutline, minX, minZ, maxX, maxZ, outline, rim, level, bedY],
  );
  useEffect(() => () => outlineLines?.dispose(), [outlineLines]);
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

  const shown = (layer: SkyBoxStageLayer) => !debug?.hide?.includes(layer);

  // Compiled with the sky before either is drawn; again when the parts may have changed.
  const root = useRef<Group>(null);
  const register = ocean?.stage;
  useLayoutEffect(() => {
    if (!register || !root.current) return;
    return register(root.current);
  }, [
    register,
    materials,
    occupantBed,
    plane,
    rings,
    falloff,
    bedAround,
    areaBed,
    seabedMesh,
    wet,
    hasBed,
    reliefGrid,
    wireMaterials,
    outlineLines,
  ]);

  if (!ocean || !materials || !occupantBed) return null;

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
  if (hasBed && rings) {
    parts.push({
      key: 'bed-far',
      layer: 'bed',
      geometry: rings,
      material: materials.bed,
      y: bedY,
    });
    if (falloff) {
      parts.push({
        key: 'falloff',
        layer: 'falloff',
        geometry: falloff,
        material: materials.falloffBed,
      });
    } else if (bedAround) {
      parts.push({
        key: 'bed-near',
        layer: 'bed',
        geometry: bedAround,
        material: materials.bed,
        y: bedY,
      });
    }
  } else if (hasBed) {
    parts.push({
      key: 'bed',
      layer: 'bed',
      geometry: areaBed ?? plane,
      material: materials.bed,
      y: bedY,
    });
  }
  if (seabedMesh && hasBed) {
    parts.push({
      key: 'occupant-bed',
      layer: 'occupant-bed',
      geometry: seabedMesh,
      material: occupantBed,
    });
  }

  return (
    <group ref={root} visible={ocean.visible && ocean.ready}>
      {relief && reliefGrid && area && sky && (
        <SkyBoxStageReliefLayer
          sky={sky}
          grid={reliefGrid}
          area={area}
          falloff={relief.falloff ?? RELIEF_FALLOFF}
          color={relief.color ?? RELIEF_LAND_COLOR}
          reach={far * STAGE_REACH}
          level={level}
          bedY={bedY}
          bedDetail={bedDetail}
          visible={shown('relief')}
        />
      )}
      {parts.map(part => (
        <mesh
          key={part.key}
          geometry={part.geometry}
          material={part.material}
          position-y={part.y ?? 0}
          renderOrder={part.order ?? 0}
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
    </group>
  );
};
