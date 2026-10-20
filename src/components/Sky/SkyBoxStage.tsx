import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import {
  BufferGeometry,
  Camera,
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
import { useSkyOcean } from './sky-context';
import {
  createSkyStageBand,
  createSkyStageGeometry,
  createSkyStageMaterial,
  createSkyStageOutline,
  createSkyStageRelief,
  createSkyStageWalls,
  SkyStageBounds,
  SkyStageElevationAt,
  SkyStageElevations,
  skyStageNearBounds,
} from './sky-stage';

// Share of the far plane the stage draws the sea out to; the sky draws beyond, where
// the far plane would clip the stage.
const STAGE_REACH = 0.8;
// Room between the outline and the far rings when there is no relief to make room for.
const MIN_NEAR_MARGIN = 1000;

// Without OIT, see-through parts draw in this order: the scene's own (most of it under the
// sea), then the band over the occupant's seabed, then the water over everything.
const BAND_ORDER = 0.5;
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
  band: '#ff1acc',
  walls: '#ffe61a',
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
  /** keep the seabed under the outline; off when the occupant draws its own. Default true */
  seabed?: boolean;
  /**
   * The occupant's own seabed along its outline: scene Y at every vertex, nested as
   * `outline.coordinates`. The stage's seabed starts there and eases to the sea's depth
   * (see {@link SkyBoxStageProps.seabedFalloff}). Only with `seabed: false`.
   */
  elevations?: SkyStageElevations;
  /**
   * The occupant's seabed height at a scene X/Z, `null` where it has none: what the
   * cross-fade band lies on (see {@link SkyBoxStageProps.seabedBlend}), and the ground a
   * camera under the sea surface is above or in.
   */
  elevationAt?: SkyStageElevationAt;
  /**
   * How far the seabed the occupant DRAWS may depart from `elevationAt`, in metres —
   * when it draws its own tessellation rather than the mesh sampled. The band is held
   * that much further in front of it. Default 0
   */
  tolerance?: number;
};

/**
 * A layer a {@link SkyBoxStage} draws: the sea `surface` around the outline and the
 * `inner-surface` over it; the flat `bed` around it (beyond the relief, when there is
 * one), the `relief` easing from the occupant's seabed, the `inner-bed` under the
 * outline; the `band` cross-fading into the occupant's seabed; the `walls` of the water.
 */
export type SkyBoxStageLayer =
  | 'surface'
  | 'inner-surface'
  | 'bed'
  | 'relief'
  | 'inner-bed'
  | 'band'
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
  /** how far outside the outline the seabed eases from the occupant's `elevations` to the sea's depth. Default 3000 */
  seabedFalloff?: number;
  /** how far inside the outline the sky's seabed fades into the occupant's, which needs its `elevationAt`; 0 for none. Default 500 */
  seabedBlend?: number;
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
 * One that draws a seabed of its own hands over its heights, and the stage's seabed
 * meets it at the outline and cross-fades into it.
 *
 * ⚠️ Assumes the default `up` (+Y). Renders nothing without a sky ocean.
 *
 * @group Components
 */
export const SkyBoxStage = ({
  bounds,
  occupant,
  seabedFalloff = 3000,
  seabedBlend = 500,
  debug,
}: SkyBoxStageProps) => {
  const ocean = useSkyOcean();
  const sky = ocean?.material ?? null;
  const far = useThree(state => state.camera.far);
  const [minX, minZ, maxX, maxZ] = bounds;
  const outline = occupant?.outline ?? null;
  const water = occupant?.water ?? true;
  const seabed = occupant?.seabed ?? true;
  const elevations = (!seabed && occupant?.elevations) || null;
  const elevationAt = (elevations && occupant?.elevationAt) || null;
  const tolerance = occupant?.tolerance ?? 0;
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

  const walls = useMemo(
    () =>
      outline ? createSkyStageWalls(outline, level, bedY, elevations) : null,
    [outline, level, bedY, elevations],
  );

  const relief = useMemo(
    () =>
      hasBed && outline && elevations && seabedFalloff > 0
        ? createSkyStageRelief(near, outline, elevations, bedY, seabedFalloff)
        : null,
    [hasBed, near, outline, elevations, bedY, seabedFalloff],
  );

  const band = useMemo(
    () =>
      hasBed && outline && elevations && elevationAt && seabedBlend > 0
        ? createSkyStageBand(
            outline,
            elevations,
            elevationAt,
            seabedBlend,
            tolerance,
          )
        : null,
    [hasBed, outline, elevations, elevationAt, seabedBlend, tolerance],
  );

  const materials = useMemo(
    () =>
      sky && {
        surface: createSkyStageMaterial(sky, 'surface'),
        bed: createSkyStageMaterial(sky, 'bed'),
        dryBed: createSkyStageMaterial(sky, 'dry-bed'),
        reliefBed: createSkyStageMaterial(sky, 'relief-bed'),
        band: createSkyStageMaterial(sky, 'band'),
        dryBand: createSkyStageMaterial(sky, 'dry-band'),
        wall: createSkyStageMaterial(sky, 'wall'),
        drainedWall: createSkyStageMaterial(sky, 'drained-wall'),
      },
    // The seabed's detail is compiled in, from the sky's defines: a new one needs new materials.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sky, bedDetail],
  );

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

  useEffect(() => () => band?.dispose(), [band]);

  useEffect(
    () => () => {
      if (!materials) return;
      for (const material of Object.values(materials)) material.dispose();
    },
    [materials],
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
    () => (elevationAt && outline ? outline.getBounds() : null),
    [elevationAt, outline],
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
    if (!sky || !ocean || !groundBounds || !elevationAt) return;
    const { x, y, z } = camera.position;
    const { min, max } = groundBounds;
    sky.oceanGround =
      y <= ocean.level &&
      x >= min[0] &&
      x <= max[0] &&
      z >= min[1] &&
      z <= max[1]
        ? elevationAt(x, z)
        : null;
  });

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
            elevations,
          )
        : null,
    [showOutline, minX, minZ, maxX, maxZ, outline, level, bedY, elevations],
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

  if (!ocean || !materials) return null;

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
  if (geometry.inner && seabed && hasBed) {
    parts.push({
      key: 'inner-bed',
      layer: 'inner-bed',
      geometry: geometry.inner,
      material: water ? materials.bed : materials.dryBed,
      y: bedY,
    });
  }
  if (band) {
    parts.push({
      key: 'band',
      layer: 'band',
      geometry: band,
      material: water ? materials.band : materials.dryBand,
      order: BAND_ORDER,
    });
  }
  if (walls && wet && (!water || (!seabed && !elevations))) {
    parts.push({
      key: 'walls',
      layer: 'walls',
      geometry: walls,
      material: water ? materials.wall : materials.drainedWall,
    });
  }

  return (
    <group visible={ocean?.visible ?? true}>
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
