import { useFrame, useThree } from '@react-three/fiber';
import {
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
  MeshBasicMaterial,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three';
import { createLayers, LAYERS } from '../../layers/layers';
import {
  PlanarPolygonCoordinates,
  PlanarPolygonGeometry,
} from '../../sdk/geometries/planar-geometry';
import { pointInPolygon } from '../../sdk/geometries/polygon-outline';
import type { SeabedMesh } from '../../sdk/geometries/surface-clip';
import { createTinSampler } from '../../sdk/geometries/tin-sampler';
import type { CutUniforms } from '../../sdk/materials/fence-field';
import { useSkyOcean } from './sky-context';
import {
  createSkyStageGeometry,
  createSkyStageMaterial,
  createSkyStageOutline,
  createSkyStageRelief,
  createSkyStageSeabed,
  createSkyStageWalls,
  SkyStageBounds,
  skyStageNearBounds,
  skyStageRim,
} from './sky-stage';

// Share of the far plane the stage draws the sea out to; the sky draws beyond, where
// the far plane would clip the stage.
const STAGE_REACH = 0.8;
// Room between the outline and the far rings when there is no relief to make room for.
const MIN_NEAR_MARGIN = 1000;

// Without OIT, see-through parts draw in this order: the scene's own (most of it under the
// sea), then the water over everything.
const SURFACE_ORDER = 1;
// Debug lines go over everything.
const OUTLINE_ORDER = 1e9;
// Drawn last by the OITRenderPass too, over its transparent layers.
const OVERLAY_LAYERS = createLayers(LAYERS.OVERLAY);
// Wireframe colours, as `SkyDebug.tint` colours the layers.
const WIRE_COLORS: Record<SkyBoxStageLayer, string> = {
  surface: '#1a59ff',
  'inner-surface': '#1a59ff',
  bed: '#26cc33',
  relief: '#00d9e6',
  'inner-bed': '#26cc33',
  'occupant-bed': '#ff1acc',
  walls: '#ffe61a',
};

/** What a {@link SkyBoxStage} does for its occupant, as {@link SkyBoxStageOccupant.onStage} tells it. */
export type SkyBoxStageOccupantState = {
  /** the stage draws the occupant's seabed: it was given one, and the sky is drawn and compiled. While false, draw your own */
  seabed: boolean;
};

/**
 * The space a {@link SkyBoxStage}'s scene claims, and which of the sea it keeps there.
 * Without its water or its seabed, the sea is walled along the outline by its water
 * body, as a field column's sea is.
 */
export type SkyBoxStageOccupant = {
  /** in scene X/Z, inside the stage's `bounds` */
  outline: PlanarPolygonGeometry;
  /** keep the water over the outline; off drains it, walled in by the sea around it, and a camera inside is in air. Default true */
  water?: boolean;
  /**
   * The seabed under the outline: `true` the sea's own, flat; `false` none, with the
   * outline walled in by the water body over the void; or the occupant's own, in scene
   * coordinates, which the stage draws as the sea's seabed — shaded, lit and fogged as the
   * sky's, eased into the sea's seabed around it (see {@link SkyBoxStageProps.seabedFalloff}),
   * and never cut by a cutaway, which only takes the water over it. Build it with
   * `createSeabedMesh`, or the `skySeabed` generator, clipped to `outline`, so its rim is
   * the outline itself. Default true
   *
   * ⚠️ Drawn opaque and whole — or cut as `cut` cuts it — so the occupant may cull
   * whatever lies under it. Stop drawing your own while the stage draws it (see `onStage`).
   */
  seabed?: boolean | SeabedMesh;
  /**
   * The occupant's own cut — a `ChunkStack`'s, from its `onCut` — which the stage cuts
   * the occupant's seabed with, as the occupant cuts itself. The same uniform objects, so
   * it follows the cut every frame; they must be in the scene frame.
   */
  cut?: CutUniforms;
  /** told what the stage does for the occupant, whenever that changes; `seabed: false` once the stage is gone */
  onStage?: (state: SkyBoxStageOccupantState) => void;
};

/**
 * A layer a {@link SkyBoxStage} draws: the sea `surface` around the outline and the
 * `inner-surface` over it; the flat `bed` around it (beyond the relief, when there is
 * one), the `relief` easing from the occupant's seabed, the `inner-bed` under the
 * outline, or the `occupant-bed`, the occupant's own; the `walls` of the water.
 */
export type SkyBoxStageLayer =
  | 'surface'
  | 'inner-surface'
  | 'bed'
  | 'relief'
  | 'inner-bed'
  | 'occupant-bed'
  | 'walls';

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
  /** how far outside the outline the seabed eases from the occupant's own to the sea's depth. Default 3000 */
  seabedFalloff?: number;
  /** debug views (see {@link SkyBoxStageDebug}) */
  debug?: SkyBoxStageDebug;
};

/**
 * Real geometry between the scene and the endless sea of a {@link Sky} with `ocean`: the
 * same sea and seabed, drawn with the sky's own shading so it has no seam with the
 * background. Being geometry, it puts the water in front of the scene — what lies under
 * the surface is seen through it — and the opaque seabed hides what is below it, unless
 * the camera is below it too.
 *
 * It reaches the camera's far plane beyond `bounds`, so every view ray that can reach
 * the scene crosses it rather than the sky's background.
 *
 * An `occupant` claims part of the stage, where its water or seabed can be taken away.
 * One with a seabed of its own hands it to the stage, which draws it as the sea's, and
 * eases its own seabed into it around the outline.
 *
 * ⚠️ Assumes the default `up` (+Y). Renders nothing without a sky ocean.
 *
 * @group Components
 */
export const SkyBoxStage = ({
  bounds,
  occupant,
  seabedFalloff = 3000,
  debug,
}: SkyBoxStageProps) => {
  const ocean = useSkyOcean();
  const sky = ocean?.material ?? null;
  const far = useThree(state => state.camera.far);
  const [minX, minZ, maxX, maxZ] = bounds;
  const outline = occupant?.outline ?? null;
  const water = occupant?.water ?? true;
  const seabed = occupant?.seabed ?? true;
  const occupantSeabed = typeof seabed === 'object' ? seabed : null;
  const level = ocean?.level ?? 0;
  const bedY = level - (ocean?.depth ?? 0);
  // The sky's own sea has water; without it every part of the stage lies dry.
  const wet = ocean?.water ?? true;
  // Without a seabed, the stage draws none either: the void lies below the water.
  const hasBed = ocean?.seabed ?? true;
  const bedDetail = ocean?.bedDetail;

  const extent: SkyStageBounds = useMemo(
    () => [minX - far, minZ - far, maxX + far, maxZ + far],
    [minX, minZ, maxX, maxZ, far],
  );
  // At least the relief's falloff, so the relief ends on the far rings at the seabed.
  const near = useMemo(
    () =>
      skyStageNearBounds(
        [minX, minZ, maxX, maxZ],
        extent,
        outline,
        Math.max(seabedFalloff, MIN_NEAR_MARGIN),
      ),
    [minX, minZ, maxX, maxZ, extent, outline, seabedFalloff],
  );

  const geometry = useMemo(
    () => createSkyStageGeometry(near, extent, outline),
    [near, extent, outline],
  );

  // The occupant's seabed: where the relief and the walls meet it, the stage's mesh of it,
  // and the ground under a camera in it.
  const rim = useMemo(
    () => (occupantSeabed ? skyStageRim(occupantSeabed) : null),
    [occupantSeabed],
  );
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

  const walls = useMemo(
    () =>
      outline
        ? createSkyStageWalls(
            rim?.outline ?? outline,
            level,
            bedY,
            rim?.elevations,
          )
        : null,
    [outline, rim, level, bedY],
  );

  const relief = useMemo(
    () =>
      hasBed && rim && seabedFalloff > 0
        ? createSkyStageRelief(
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
        surface: createSkyStageMaterial(sky, 'surface'),
        bed: createSkyStageMaterial(sky, 'bed'),
        dryBed: createSkyStageMaterial(sky, 'dry-bed'),
        reliefBed: createSkyStageMaterial(sky, 'relief-bed'),
        wall: createSkyStageMaterial(sky, 'wall'),
        drainedWall: createSkyStageMaterial(sky, 'drained-wall'),
      },
    // The seabed's detail is compiled in, from the sky's defines: a new one needs new materials.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sky, bedDetail],
  );

  // Apart from the rest, since the occupant's cut is compiled into them too.
  const cutPlane = occupant?.cut?.plane;
  const cutFence = occupant?.cut?.fence;
  const occupantBeds = useMemo(() => {
    if (!sky) return null;
    const cut = { plane: cutPlane, fence: cutFence };
    return {
      wet: createSkyStageMaterial(sky, 'occupant-bed', cut),
      dry: createSkyStageMaterial(sky, 'dry-occupant-bed', cut),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sky, bedDetail, cutPlane, cutFence]);

  useEffect(
    () => () => {
      geometry.near.dispose();
      geometry.far.dispose();
      geometry.inner?.dispose();
    },
    [geometry],
  );

  useEffect(() => () => walls?.dispose(), [walls]);

  useEffect(() => () => relief?.dispose(), [relief]);

  useEffect(
    () => () => {
      if (!materials) return;
      for (const material of Object.values(materials)) material.dispose();
    },
    [materials],
  );

  useEffect(
    () => () => {
      occupantBeds?.wet.dispose();
      occupantBeds?.dry.dispose();
    },
    [occupantBeds],
  );

  useLayoutEffect(() => {
    if (!sky) return;
    sky.setOceanStage(extent, far * STAGE_REACH);
    return () => sky.setOceanStage(null);
  }, [sky, extent, far]);

  const drained = wet && !water ? outline : null;

  useEffect(() => {
    if (!sky || !drained) return;
    return () => {
      sky.oceanDrained = false;
    };
  }, [sky, drained]);

  useFrame(({ camera }) => {
    if (!sky || !ocean || !drained) return;
    const { x, y, z } = camera.position;
    sky.oceanDrained =
      y <= ocean.level &&
      y > ocean.level - ocean.depth &&
      pointInPolygon(x, z, drained.coordinates as PlanarPolygonCoordinates);
  });

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

  // The occupant draws its own seabed whenever the stage does not: told on every change.
  const seabedDrawn = !!seabedMesh && !!ocean?.visible && !!ocean.ready;
  const onStage = useRef(occupant?.onStage);
  useLayoutEffect(() => {
    onStage.current = occupant?.onStage;
  });
  useEffect(() => {
    onStage.current?.({ seabed: seabedDrawn });
  }, [seabedDrawn]);
  useEffect(() => () => onStage.current?.({ seabed: false }), []);

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
            rim?.outline ?? outline,
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
    const made = {} as Record<SkyBoxStageLayer, MeshBasicMaterial>;
    for (const layer of Object.keys(WIRE_COLORS) as SkyBoxStageLayer[]) {
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
    occupantBeds,
    geometry,
    walls,
    relief,
    seabedMesh,
    wet,
    hasBed,
    water,
    seabed,
    wireMaterials,
    outlineLines,
  ]);

  if (!ocean || !materials || !occupantBeds) return null;

  const parts: {
    key: string;
    layer: SkyBoxStageLayer;
    geometry: BufferGeometry;
    material: ShaderMaterial;
    y?: number;
    order?: number;
  }[] = [];
  if (wet) {
    for (const [key, cap] of [
      ['surface-far', geometry.far],
      ['surface-near', geometry.near],
    ] as const) {
      parts.push({
        key,
        layer: 'surface',
        geometry: cap,
        material: materials.surface,
        y: level,
        order: SURFACE_ORDER,
      });
    }
  }
  if (hasBed) {
    parts.push({
      key: 'bed-far',
      layer: 'bed',
      geometry: geometry.far,
      material: materials.bed,
      y: bedY,
    });
    parts.push(
      relief
        ? {
            key: 'relief',
            layer: 'relief',
            geometry: relief,
            material: materials.reliefBed,
          }
        : {
            key: 'bed-near',
            layer: 'bed',
            geometry: geometry.near,
            material: materials.bed,
            y: bedY,
          },
    );
  }
  if (geometry.inner && wet && water) {
    parts.push({
      key: 'inner-surface',
      layer: 'inner-surface',
      geometry: geometry.inner,
      material: materials.surface,
      y: level,
      order: SURFACE_ORDER,
    });
  }
  if (geometry.inner && seabed === true && hasBed) {
    parts.push({
      key: 'inner-bed',
      layer: 'inner-bed',
      geometry: geometry.inner,
      material: water ? materials.bed : materials.dryBed,
      y: bedY,
    });
  }
  if (seabedMesh) {
    parts.push({
      key: 'occupant-bed',
      layer: 'occupant-bed',
      geometry: seabedMesh,
      material: water ? occupantBeds.wet : occupantBeds.dry,
    });
  }
  if (walls && wet && (!water || seabed === false)) {
    parts.push({
      key: 'walls',
      layer: 'walls',
      geometry: walls,
      material: water ? materials.wall : materials.drainedWall,
    });
  }

  return (
    <group ref={root} visible={ocean.visible && ocean.ready}>
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
