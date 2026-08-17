import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { scaleOrdinal } from 'd3-scale';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plane, Vector3 } from 'three';
import { OITRenderPass, Pass } from '../../main';
import { OutputPass } from '../../rendering/passes/OutputPass';
import { RenderingPipeline } from '../../rendering/RenderingPipeline';
import {
  CRS,
  getProjectionDefFromUtmZone,
  PlanarPolygonGeometry,
  SurfaceChunkMetrics,
  SurfaceMeta,
  surfaceGridToWorld,
  Vec2,
} from '../../sdk';
import {
  WellboreSelectedEvent,
  wellboreSelectedEventType,
} from '../../events/wellbore-events';
import { chunkTimings } from '../../storybook/data/chunk-timings';
import { sortByStratAge } from '../../storybook/data/strat-ages';
import {
  stratLayerColors,
  stratLayerUnitName,
} from '../../storybook/data/strat-units';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { GlyphsDecorator } from '../../storybook/decorators/glyphs-decorator';
import { WellMapDecorator } from '../../storybook/decorators/well-map-decorator';
import { useFieldOutline } from '../../storybook/hooks/useFieldOutline';
import { useVidex3dLocate } from '../../storybook/debug/useVidex3dLocate';
import { useSurfaceMetaDict } from '../../storybook/hooks/useSurfaceMeta';
import { useWellboreHeaders } from '../../storybook/hooks/useWellboreHeaders';
import {
  getSyntheticSurface,
  SYNTHETIC_SEABED_ID,
} from '../../storybook/data/synthetic-surfaces';
import storyArgs from '../../storybook/story-args.json';
import { Distance } from '../Distance/Distance';
import { EventEmitterCallbackEvent } from '../EventEmitter';
import { useHighlighter } from '../Highlighter/highlight-state';
import { Highlighter } from '../Highlighter/Highlighter';
import { UtmArea } from '../UtmArea';
import { UtmPosition } from '../UtmArea/UtmPosition';
import { BasicTrajectory } from '../Wellbores/BasicTrajectory/BasicTrajectory';
import { TubeTrajectory } from '../Wellbores/TubeTrajectory/TubeTrajectory';
import { Wellbore } from '../Wellbores/Wellbore/Wellbore';
import { WellboreBounds } from '../Wellbores/WellboreBounds/WellboreBounds';
import { Wells } from '../Wellbores/Wells/Wells';
import { Chunk } from './Chunk';
import {
  ChunkFence,
  ChunkLayer,
  ChunkResolveOptions,
  ChunkSection,
  StackImmersion,
  StackWater,
} from './chunk-defs';
import { CHUNK_DETAIL_PRESET_NAMES, ChunkDetailPreset } from './chunk-detail';
import { ChunkStack } from './ChunkStack';
import { ChunkInferenceStyle } from './inference-material';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;
const surfaceOptions = storyArgs.surfaceOptions as Record<string, string>;

const crs = new CRS(getProjectionDefFromUtmZone(utmZone), origin, 'utm');

/** Branch colours, shared with the well map through `parameters.colorScale`. */
const colorScale = scaleOrdinal([
  'tomato',
  '#4e79a7',
  '#f28e2c',
  '#76b7b2',
  '#59a14f',
  '#edc949',
  '#af7aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ab',
  'darkgreen',
  'purple',
  '#24ca85',
]);

/**
 * The dataset's own sea bed, if it maps one — most fields do not, since a sea bed
 * is bathymetry rather than stratigraphy. Volve's shallowest horizon is `Utsira
 * Fm. Top` at ~820 m, so without a bed the sea would stand on THAT, and the whole
 * overburden above it would be drawn as water.
 */
const SEABED_ID = (storyArgs.seabedSurface as string | null) ?? null;

// Cached by the generator, and generated anyway at store init, so this is a lookup.
const GENERATED_SEABED = SEABED_ID
  ? null
  : (getSyntheticSurface(SYNTHETIC_SEABED_ID)?.meta ?? null);

// Always-on OIT pipeline (SMAA), matching the other chunk spikes.
const ChunkPipeline = () => {
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  const passes = useMemo<Pass[]>(() => {
    const base = new OITRenderPass(scene, camera);
    base.antialias = 'smaa';
    return [base, new OutputPass()];
  }, [scene, camera]);
  useFrame(() => {}, 2);
  return <RenderingPipeline passes={passes} />;
};

/**
 * Point the section plane, in the stack's own frame. `azimuth` swings the normal
 * in XZ and `dip` tilts it out of horizontal, so dip 0 is the vertical cut a
 * geological section is normally drawn on.
 */
function setSectionPlane(
  plane: Plane,
  azimuth: number,
  dip: number,
  distance: number,
  flip: boolean,
) {
  const a = (azimuth * Math.PI) / 180;
  const d = (dip * Math.PI) / 180;
  plane.normal.set(
    Math.sin(a) * Math.cos(d),
    Math.sin(d),
    Math.cos(a) * Math.cos(d),
  );
  plane.constant = -distance;
  if (flip) plane.negate();
}

/**
 * Drives the section plane every frame.
 *
 * ⚠️ Rendered INSIDE the `ChunkStack`, deliberately: a child's `useFrame`
 * subscribes before its parent's, so the stack reads the plane in the same frame
 * this wrote it rather than one behind.
 */
const SectionDriver = ({
  plane,
  azimuth,
  dip,
  distance,
  flip,
  animate,
  speed,
}: {
  plane: Plane;
  azimuth: number;
  dip: number;
  distance: number;
  flip: boolean;
  animate: boolean;
  speed: number;
}) => {
  const clock = useRef(0);
  useFrame((_, delta) => {
    if (!animate) {
      setSectionPlane(plane, azimuth, dip, distance, flip);
      return;
    }
    clock.current += delta * speed;
    const t = clock.current;
    setSectionPlane(
      plane,
      azimuth + 40 * Math.sin(t * 0.31),
      dip + 20 * Math.sin(t * 0.17),
      distance + 2500 * Math.sin(t * 0.11),
      flip,
    );
  });
  return null;
};

/**
 * Every wellbore the dataset carries, drawn through the block and selectable.
 *
 * Kept out of `FieldColumnStory` so hovering and selecting never re-renders the
 * chunk's build memos.
 */
const FieldWells = ({
  selected,
  color,
  selectedColor,
  radius,
  tubeDistance,
}: {
  selected?: string;
  color: string;
  selectedColor: string;
  radius: number;
  tubeDistance: number;
}) => {
  const wellbores = useWellboreHeaders();
  const highlighter = useHighlighter();

  useEffect(() => () => highlighter.removeAll(), [highlighter]);

  return (
    <Wells
      wellbores={wellbores}
      selected={selected}
      renderWellbore={(wellbore, fromMsl, isSelected) => (
        <UtmPosition easting={wellbore.easting} northing={wellbore.northing}>
          <Wellbore
            id={wellbore.id}
            fromMsl={fromMsl}
            onPointerClick={(event: EventEmitterCallbackEvent) => {
              dispatchEvent(
                new WellboreSelectedEvent({
                  id: event.ref,
                  position: event.position,
                  flyTo: !event.keys.ctrlKey,
                }),
              );
            }}
            onPointerEnter={(event: EventEmitterCallbackEvent) => {
              if (!isSelected) highlighter.highlight(event.target);
              event.domElement.style.cursor = 'pointer';
            }}
            onPointerLeave={(event: EventEmitterCallbackEvent) => {
              event.domElement.style.cursor = '';
              highlighter.removeAll();
            }}
          >
            <WellboreBounds id={wellbore.id} fromMsl={fromMsl}>
              {/* Always drawn: the 1px line is what survives at field scale. */}
              <BasicTrajectory
                color={isSelected ? selectedColor : color}
                priority={9}
              />
              <Distance min={0} max={tubeDistance}>
                <TubeTrajectory
                  radius={radius}
                  color={isSelected ? selectedColor : color}
                  priority={8}
                  radialSegments={12}
                />
              </Distance>
            </WellboreBounds>
          </Wellbore>
        </UtmPosition>
      )}
    />
  );
};

type FieldColumnStoryProps = {
  outline: 'grid' | 'field' | 'crop';
  cropSize: number;
  seabed: boolean;
  surfaceFrom: number;
  surfaceCount: number;
  rimSpacing: number;
  maxError: number;
  maxNodes: number;
  seal: boolean;
  sealMode: 'proportional' | 'void';
  minThickness: number;
  maxFill: number;
  collapseThreshold: number;
  constrainCoverage: boolean;
  section: boolean;
  sectionMode: 'fixed' | 'camera';
  sectionCameraDistance: number;
  sectionVertical: boolean;
  sectionAzimuth: number;
  sectionDip: number;
  sectionDistance: number;
  sectionFlip: boolean;
  sectionAnimate: boolean;
  sectionAnimateSpeed: number;
  sectionWater: boolean;
  sectionCarrier: boolean;
  sectionKeep: number;
  sectionDebug: boolean;
  water: boolean;
  seaLevel: number;
  waterOpacity: number;
  waterLayerOpacity: number;
  windSpeed: number;
  foamAmount: number;
  bedTint: number;
  immersion: boolean;
  immersionColor: string;
  immersionVisibility: number;
  immersionTransition: number;
  immersionSettle: number;
  immersionBackground: boolean;
  floor: boolean;
  floorClearance: number;
  floorColor: string;
  surfaceOpacity: number;
  wallOpacity: number;
  wireframe: boolean;
  peel: number;
  inferredStyle: ChunkInferenceStyle;
  detail: ChunkDetailPreset | 'none';
  detailStrength: number;
  wellbores: boolean;
  wellboreColor: string;
  wellboreSelectedColor: string;
  wellboreRadius: number;
  wellboreTubeDistance: number;
  wellbore: string;
  fence: boolean;
  fenceSide: 1 | -1;
  fenceWidth: number;
  fenceOffset: number;
  fenceResolution: number;
  fenceCellSize: number;
  fenceAzimuth: number;
  fenceReveal: number;
  fenceHeadWidth: number;
  fenceShallowDepth: number;
  fenceDeepDepth: number;
  fenceDebug: boolean;
};

/** Publishes `window.videx3d.locate('wellbore', id)`; must sit inside `UtmArea`. */
const Videx3dLocate = () => {
  useVidex3dLocate();
  return null;
};

const FieldColumnStory = (props: FieldColumnStoryProps) => {
  const surfaceMetaDict = useSurfaceMetaDict();
  const fieldOutline = useFieldOutline();

  // Held HERE rather than in `FieldWells` because the wellbore fence reads it at
  // this level, alongside the stack. ⭐ Two channels, not one: the 3D view and the
  // well map both select by EVENT, and the `wellbore` control selects directly —
  // which is what makes a specific well reachable for an A/B without hunting for
  // it in the scene.
  const [selectedWellbore, setSelectedWellbore] = useState<string | undefined>(
    props.wellbore,
  );
  useEffect(() => setSelectedWellbore(props.wellbore), [props.wellbore]);
  useEffect(() => {
    const onSelect = (event: WellboreSelectedEvent) =>
      setSelectedWellbore(event.detail.id);
    addEventListener(wellboreSelectedEventType, onSelect);
    return () => removeEventListener(wellboreSelectedEventType, onSelect);
  }, []);

  // Every mapped surface the dataset carries, in stratigraphic order. Age is the
  // only key that is right by construction — see `sortByStratAge`, which excludes
  // (loudly) any surface the strat column has no horizon for.
  //
  // ⭐ The sea BED comes first, and is generated when the field maps none: the sea
  // is built as [level, the column's shallowest surface], so without one it would
  // stand on the shallowest HORIZON and turn the entire overburden into water.
  const column = useMemo<SurfaceMeta[]>(() => {
    const all = sortByStratAge(
      Object.keys(surfaceOptions)
        .map(id => surfaceMetaDict[id])
        .filter((m): m is SurfaceMeta => !!m),
    );
    if (!props.seabed) return all;
    if (SEABED_ID) {
      const from = all.findIndex(m => m.id === SEABED_ID);
      return from >= 0 ? all.slice(from) : all;
    }
    return GENERATED_SEABED ? [GENERATED_SEABED, ...all] : all;
  }, [surfaceMetaDict, props.seabed]);

  // The whole survey rectangle of the widest surface in the column.
  // ⚠️ Built through `surfaceGridToWorld` over the grid CORNERS, not from the
  // header's xmax/ymax: those are the origin plus the span in the GRID's own
  // frame, and this survey is rotated 220°, so reading them as UTM bounds puts
  // the footprint somewhere else entirely.
  const gridOutline = useMemo<PlanarPolygonGeometry | null>(() => {
    const widest = column.reduce<SurfaceMeta | null>(
      (best, m) =>
        !best ||
        m.header.nx * m.header.xinc * (m.header.ny * m.header.yinc) >
          best.header.nx *
            best.header.xinc *
            (best.header.ny * best.header.yinc)
          ? m
          : best,
      null,
    );
    if (!widest) return null;
    const { nx, ny, xinc, yinc, rot, xori, yori } = widest.header;
    const p = crs.utmToWorld(xori, yori, 0);
    const toWorld = surfaceGridToWorld({ nx, ny, xinc, yinc, rot }, [p.x, p.z]);
    const ring = [
      toWorld(0, 0),
      toWorld(nx - 1, 0),
      toWorld(nx - 1, ny - 1),
      toWorld(0, ny - 1),
    ];
    return new PlanarPolygonGeometry([[[...ring, ring[0]]]], [0, 0]);
  }, [column]);

  // A square crop about the scene origin, for a like-for-like comparison with the
  // generated column (whose grid is centred there and 7 km across by default).
  // ⚠️ Axis-aligned in the SCENE, while the surveys are rotated 220°, so a crop
  // approaching the survey's own size will poke past its corners.
  const cropOutline = useMemo<PlanarPolygonGeometry>(() => {
    const h = (props.cropSize * 1000) / 2;
    const ring: Vec2[] = [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ];
    return new PlanarPolygonGeometry([[[...ring, ring[0]]]], [0, 0]);
  }, [props.cropSize]);

  const outline =
    props.outline === 'grid'
      ? gridOutline
      : props.outline === 'crop'
        ? cropOutline
        : fieldOutline;

  const selected = useMemo(
    () =>
      column.slice(props.surfaceFrom, props.surfaceFrom + props.surfaceCount),
    [column, props.surfaceFrom, props.surfaceCount],
  );

  // ⭐ COLOUR IS THE HOST'S JOB. The library takes array order as stratigraphic
  // order and never assigns a colour; here the story maps each surface's name to
  // the strat column's unit and takes the colour the column itself gives it —
  // exactly the mapping a real host app would own.
  const { layers, names } = useMemo(() => {
    const names = selected.map(m => m.name);
    const colors = stratLayerColors(names);
    const detail =
      props.detail === 'none'
        ? undefined
        : { preset: props.detail, strength: props.detailStrength };
    const layers: ChunkLayer[] = selected.map((surface, i) => ({
      surface,
      material: colors[i],
      // The unit's colour serves as both the cap and the volume below it: they
      // are the same rock seen from two sides.
      fill: i < selected.length - 1 || props.floor ? colors[i] : undefined,
      detail,
      // One layer can opt out of the cut, so it stands whole over the section.
      section: i === props.sectionKeep ? false : undefined,
    }));
    return { layers, names };
  }, [
    selected,
    props.floor,
    props.detail,
    props.detailStrength,
    props.sectionKeep,
  ]);

  const resolve = useMemo<ChunkResolveOptions>(
    () => ({
      seal: props.seal,
      sealMode: props.sealMode,
      minThickness: props.minThickness,
      maxFill: props.maxFill,
      collapseThreshold: props.collapseThreshold,
      constrainCoverage: props.constrainCoverage,
      maxNodes: props.maxNodes,
    }),
    [
      props.seal,
      props.sealMode,
      props.minThickness,
      props.maxFill,
      props.collapseThreshold,
      props.constrainCoverage,
      props.maxNodes,
    ],
  );

  // The sea belongs to the COLUMN, not to a chunk: one lid over the whole stack.
  const water = useMemo<StackWater | undefined>(
    () =>
      props.water
        ? {
            depth: props.seaLevel,
            opacity: props.waterLayerOpacity,
            waterOpacity: props.waterOpacity,
            windSpeed: props.windSpeed,
            foamAmount: props.foamAmount,
            bedTint: props.bedTint,
          }
        : undefined,
    [
      props.water,
      props.seaLevel,
      props.waterLayerOpacity,
      props.waterOpacity,
      props.windSpeed,
      props.foamAmount,
      props.bedTint,
    ],
  );

  // Absent unless asked for — its presence is what installs `scene.fog`, and that
  // is not free even when it would fog nothing.
  const immersion = useMemo<StackImmersion | undefined>(
    () =>
      props.immersion
        ? {
            color: props.immersionColor,
            visibility: props.immersionVisibility,
            transition: props.immersionTransition,
            settle: props.immersionSettle,
            background: props.immersionBackground,
          }
        : undefined,
    [
      props.immersion,
      props.immersionColor,
      props.immersionVisibility,
      props.immersionTransition,
      props.immersionSettle,
      props.immersionBackground,
    ],
  );

  // ⭐ Created once and MUTATED — the supported way to animate a section: the
  // stack reads it every frame, so it costs no React render.
  const sectionPlane = useMemo(() => new Plane(new Vector3(0, 0, 1), 0), []);
  const section = useMemo<ChunkSection>(
    () => ({
      plane: sectionPlane,
      // ⚠️ The two cuts are mutually exclusive, and the section's PRESENCE is a
      // build input — so the fence disables it rather than removing the prop,
      // which would rebuild the geometry.
      enabled: props.section && !props.fence,
      // In camera mode the stack computes the plane itself and `plane` is ignored.
      cameraDistance:
        props.sectionMode === 'camera'
          ? props.sectionCameraDistance
          : undefined,
      vertical: props.sectionVertical,
      water: props.sectionWater,
      carrier: props.sectionCarrier,
      debug: props.sectionDebug,
    }),
    [
      sectionPlane,
      props.section,
      props.fence,
      props.sectionMode,
      props.sectionCameraDistance,
      props.sectionVertical,
      props.sectionWater,
      props.sectionCarrier,
      props.sectionDebug,
    ],
  );

  // The fence follows whichever wellbore is selected — pick another in the 3D view
  // or the well map and the cut moves with it, with no rebuild.
  const fence = useMemo<ChunkFence | undefined>(
    () =>
      props.fence
        ? {
            wellbore: selectedWellbore,
            side: props.fenceSide,
            width: props.fenceWidth,
            offset: props.fenceOffset,
            resolution: props.fenceResolution,
            cellSize: props.fenceCellSize,
            azimuth: (props.fenceAzimuth * Math.PI) / 180,
            reveal: props.fenceReveal,
            headWidth: props.fenceHeadWidth,
            shallowDepth: props.fenceShallowDepth,
            deepDepth: props.fenceDeepDepth,
            debug: props.fenceDebug,
          }
        : undefined,
    [
      props.fence,
      selectedWellbore,
      props.fenceSide,
      props.fenceWidth,
      props.fenceOffset,
      props.fenceResolution,
      props.fenceCellSize,
      props.fenceAzimuth,
      props.fenceReveal,
      props.fenceHeadWidth,
      props.fenceShallowDepth,
      props.fenceDeepDepth,
      props.fenceDebug,
    ],
  );

  // Per-layer build report. `coverage` is what the surface has data of its own
  // for inside the footprint; `unit` is what the strat column called it; `kept` is
  // its share of the SHARED tessellation, which every layer pays for in full
  // whatever it ends up drawing.
  const report = useMemo(
    () => (metrics: SurfaceChunkMetrics) => {
      const d = metrics.diagnostics;
      const shared = d?.sharedTriangles ?? 0;
      const rows = (d?.layers ?? []).map(l => ({
        index: l.index,
        surface: names[l.index] ?? '(synthetic)',
        unit: stratLayerUnitName(names, l.index) ?? '-',
        coverage: +l.coverage.toFixed(3),
        inferred: +l.inferred.toFixed(3),
        triangles: l.triangles,
        kept: shared > 0 ? +(l.triangles / shared).toFixed(3) : null,
        droppedAbsent: l.droppedAbsent,
        droppedCollapsed: l.droppedCollapsed,
      }));
      console.log(
        `CHUNKREPORT ${JSON.stringify({
          surfaces: metrics.layers,
          triangles: metrics.triangles,
          wallTriangles: metrics.wallTriangles,
          // ⭐ The size every phase after the tessellation scales with: each layer
          // carries a full copy of the shared TIN.
          vertices: d?.vertices ?? null,
          sharedTriangles: shared,
          crossings: d?.crossings ?? null,
          constraintFailures: d?.constraintFailures ?? null,
          referenceNodes: d?.referenceNodes ?? null,
          referenceStep: d?.referenceStep ?? null,
          ...chunkTimings(metrics),
          layers: rows,
        })}`,
      );
      console.table(rows);
    },
    [names],
  );

  if (!outline || layers.length === 0) return null;

  return (
    <>
      <UtmArea origin={origin} utmZone={utmZone}>
        <Videx3dLocate />
        <ambientLight intensity={0.6} />
        <directionalLight position={[0.5, 1, 0.3]} intensity={1.1} />
        <ChunkStack
          outline={outline}
          surfaces={column}
          water={water}
          immersion={immersion}
          section={section}
          fence={fence}
          resolve={resolve}
          rimSpacing={props.rimSpacing}
          maxError={props.maxError}
          carrier={
            props.floor
              ? { below: props.floorClearance, material: props.floorColor }
              : undefined
          }
        >
          {props.sectionMode === 'fixed' && (
            <SectionDriver
              plane={sectionPlane}
              azimuth={props.sectionAzimuth}
              dip={props.sectionDip}
              distance={props.sectionDistance}
              flip={props.sectionFlip}
              animate={props.sectionAnimate}
              speed={props.sectionAnimateSpeed}
            />
          )}
          <Chunk
            layers={layers}
            surfaceOpacity={props.surfaceOpacity}
            wallOpacity={props.wallOpacity}
            wireframe={props.wireframe}
            inferredStyle={props.inferredStyle}
            peel={Math.min(Math.max(0, Math.round(props.peel)), layers.length)}
            onBuild={report}
          />
        </ChunkStack>
        {props.wellbores && (
          <FieldWells
            selected={selectedWellbore}
            color={props.wellboreColor}
            selectedColor={props.wellboreSelectedColor}
            radius={props.wellboreRadius}
            tubeDistance={props.wellboreTubeDistance}
          />
        )}
      </UtmArea>
      {props.wellbores && <Highlighter />}
      <ChunkPipeline />
    </>
  );
};

const meta = {
  title: 'Spikes/Chunks/FieldColumn',
  component: FieldColumnStory,
  parameters: {
    // Framed for the DEFAULT `field` outline — the footprint buffered from the
    // wells. ⚠️ `grid` is an order of magnitude wider (~25 x 42 km here), so it
    // needs dollying out.
    scale: 5000,
    cameraPosition: [9000, 4000, 9000],
    cameraTarget: [0, -1500, 0],
    colorScale,
    docs: {
      description: {
        component:
          'The whole demo field as ONE chunk: every mapped surface the dataset carries, in stratigraphic order, coloured from the field’s own stratigraphic column.\n\n' +
          '⭐ This is `SyntheticColumn` run on REAL data. The generated column is exact by construction — every unit is a known function of the one above it — which makes it the right place to prove the pipeline. This story is the opposite check: real surveys, with everything the generated column does not have. Surfaces mapped over different extents and interior holes (see `coverage` per layer), horizons that are coincident over most of the field, and pairs whose stratigraphic order and depth order disagree.\n\n' +
          '⭐⭐ **Order and colour both come from the strat column, and both are the HOST’s job.** The library takes the array order as the stratigraphic order and never assigns a colour. Here the story matches each surface NAME to the column’s `top`/`base` horizons: the age gives the order (`sortByStratAge`), and the unit’s own colour gives the layer its material. A colour belongs to the INTERVAL rather than to the horizon — what you see is the top of the unit underneath — so the same colour serves as the cap and as the wall below it.\n\n' +
          '⚠️ Surfaces the column has no horizon for are EXCLUDED, not guessed at, and the exclusion is reported as an error: placing them by depth is exactly the mistake the age ordering exists to avoid. On this dataset two surfaces (an intra-formation top and an unconformity) drop out that way.\n\n' +
          '⭐ **`maxNodes` is the quality/speed dial.** Every layer is resampled onto one common grid; almost all of the build cost is linear in that grid’s node count, so halving the budget quarters the work. What it costs is resolution of the coverage MASKS — data edges, holes and pinch-out contours — rather than of the heights, which stay bounded by `maxError`. Watch `referenceNodes` and `referenceStep` in the report: a step above 1 means the trade is active. The `outline` control is the other end of the same lever — the survey rectangle is roughly ten times the area the wells occupy.\n\n' +
          '⭐ The **section** cuts the block with a plane and closes it with a real face, and in `camera` mode the plane rides in front of the camera — so orbiting picks the angle and dollying drives the cut through the field, with nothing to grab. **Peel** is the non-destructive alternative: it lifts the layers apart instead of removing anything. **Immersion** fogs the view when the camera goes under the sea surface.\n\n' +
          '⭐ **Wellbores** (off by default) draws every wellbore the dataset carries, straight through the block. Click one to select it — plain click flies the camera to the hit point, ctrl+click selects without moving. Once a well is selected the **well map** on the left comes alive: dragging its depth handle drives the camera along the trajectory.\n\n' +
          '⭐⭐ The **fence** opens the block along that selected well, instead of with a plane. It is the wellbore counterpart of the section: `split` halves the block so the well lies in the cut face, `slot` opens a corridor with the well in the gap, and the cut runs out past the wellhead and past TD so it reaches clear of the block at both ends. ⭐ A fence is VERTICAL, so what it removes depends on the map position alone — one number per vertex, which the shader reads as a varying and the CPU contours to build the cut face. That is why switching wells costs a resample rather than a build, and why the width is free to sweep.\n\n' +
          'No ships and no facilities here: the import sets carry no such data, and inventing it would say something about the field that is not in it.',
      },
    },
  },
} satisfies Meta<typeof FieldColumnStory>;

export default meta;
type Story = StoryObj<typeof FieldColumnStory>;

export const Default: Story = {
  args: {
    // Surfaces
    outline: 'field',
    cropSize: 7,
    seabed: true,
    surfaceFrom: 0,
    surfaceCount: 12,
    rimSpacing: 250,
    maxError: 5,
    maxNodes: 4000000,
    // Wellbores
    wellbores: false,
    wellboreColor: '#9aa0a6',
    wellboreSelectedColor: 'tomato',
    wellboreRadius: 4,
    wellboreTubeDistance: 12000,
    wellbore: storyArgs.defaultWellbore,
    // Fence
    fence: false,
    fenceSide: 1,
    fenceWidth: 0,
    fenceOffset: 0,
    fenceResolution: 10,
    fenceCellSize: 25,
    fenceAzimuth: 0,
    fenceReveal: 0.5,
    fenceHeadWidth: 0,
    fenceShallowDepth: 1000,
    fenceDeepDepth: 2500,
    fenceDebug: false,
    // Resolve
    seal: true,
    sealMode: 'proportional',
    minThickness: 1,
    maxFill: 250,
    collapseThreshold: 0.5,
    constrainCoverage: false,
    // Section
    section: false,
    sectionMode: 'camera',
    sectionCameraDistance: 6000,
    sectionVertical: true,
    sectionAzimuth: 0,
    sectionDip: 0,
    sectionDistance: 0,
    sectionFlip: false,
    sectionAnimate: false,
    sectionAnimateSpeed: 1,
    sectionWater: true,
    sectionCarrier: true,
    sectionKeep: -1,
    sectionDebug: false,
    // Water
    water: true,
    seaLevel: 0,
    waterOpacity: 0.7,
    waterLayerOpacity: 1,
    windSpeed: 10,
    foamAmount: 0.5,
    bedTint: 0.6,
    // Immersion
    immersion: false,
    // ⚠️ This fogs INSIDE THE BLOCK, so it is a near-black brown, not a water
    // colour; and `transition` is METRES of boundary fade while `settle` is
    // SECONDS of catch-up. Both match the documented defaults.
    immersionColor: '#0b0a08',
    immersionVisibility: 400,
    immersionTransition: 5,
    immersionSettle: 0.12,
    immersionBackground: true,
    // Floor
    floor: true,
    floorClearance: 400,
    floorColor: '#6b6b6b',
    // Appearance
    surfaceOpacity: 1,
    wallOpacity: 1,
    wireframe: false,
    peel: 0,
    inferredStyle: 'none',
    detail: 'none',
    detailStrength: 1,
  },
  argTypes: {
    outline: {
      control: { type: 'inline-radio' },
      options: ['grid', 'field', 'crop'],
      description:
        '`grid` crops nothing — the whole survey rectangle of the widest surface (~1050 km² here). `field` uses the footprint buffered from the WELLS, which is where the field actually is (~10× smaller) and is the default. `crop` is a square about the scene origin, sized to match the generated column so the two can be compared like for like. ⚠️ A footprint reaching past a survey buys INFERENCE — watch `coverage` per layer. ⭐ It is also the control that makes `maxNodes` matter: watch `referenceNodes`.',
      table: { category: 'Surfaces' },
    },
    cropSize: {
      control: { type: 'select' },
      options: [3, 5, 7, 9, 12, 15, 20, 25],
      description:
        'Side of the `crop` outline, in km. 7 is the generated column’s own size.',
      table: { category: 'Surfaces' },
    },
    seabed: {
      description:
        'Put a sea BED under the sea. Most fields map none — bathymetry is not stratigraphy — so one is GENERATED when the dataset has no `seabedSurface`. ⚠️ Off, the sea stands on the shallowest HORIZON instead (Volve: `Utsira Fm. Top` at ~820 m), which draws the whole overburden as water.',
      table: { category: 'Surfaces' },
    },
    surfaceFrom: {
      control: { type: 'select' },
      options: [0, 2, 4, 6, 8, 10, 12, 15, 18],
      description: 'First surface of the column to draw (shallowest = 0).',
      table: { category: 'Surfaces' },
    },
    surfaceCount: {
      control: { type: 'select' },
      options: [1, 2, 4, 6, 8, 12, 16, 20, 30, 40],
      description:
        'How many surfaces to draw, CLAMPED to what the dataset has (19 on Volve). ⚠️ The whole column over the whole field is a LOT of geometry — one shared tessellation, copied per layer — so the default draws the shallowest 12. Raising it is exactly where `maxNodes` earns its keep.',
      table: { category: 'Surfaces' },
    },
    rimSpacing: {
      control: { type: 'select' },
      options: [50, 100, 250, 500, 1000],
      table: { category: 'Surfaces' },
    },
    maxError: {
      control: { type: 'select' },
      options: [1, 2, 5, 10, 25, 50],
      description:
        'Greedy TIN simplification error, in metres of height. Bounds how far the drawn surface may sit from the grid.',
      table: { category: 'Surfaces' },
    },
    maxNodes: {
      control: { type: 'select' },
      options: [250000, 500000, 1000000, 2000000, 4000000],
      description:
        '⭐ QUALITY vs SPEED. Node budget for the stack’s common grid; beyond it the grid is decimated by an integer step. Resample, seal, depth-order resolve and refinement are all linear in it, so halving the budget quarters the work — at the cost of resolving every layer’s data edges and holes on a coarser cell. Check `referenceStep` in the report.',
      table: { category: 'Surfaces' },
    },
    wellbores: {
      description:
        'Draw every wellbore the dataset carries (all 35 here — no count filter), straight through the block. Click one to select it and fly the camera to the hit point; ctrl+click selects without moving. The selected well drives the WELL MAP on the left, and is the input for the planned wellbore fence section.',
      table: { category: 'Wellbores' },
    },
    wellboreColor: {
      control: { type: 'color' },
      table: { category: 'Wellbores' },
    },
    wellboreSelectedColor: {
      control: { type: 'color' },
      table: { category: 'Wellbores' },
    },
    wellboreRadius: {
      control: { type: 'select' },
      options: [1, 2, 4, 8, 16],
      description:
        'Tube radius in metres. ⚠️ A real 12¾" casing is well under a pixel across a 20 km field, so this is deliberately exaggerated.',
      table: { category: 'Wellbores' },
    },
    wellboreTubeDistance: {
      control: { type: 'select' },
      options: [2000, 5000, 12000, 30000, 100000],
      description:
        'Distance at which the tube gives way to the 1px line. The line is always drawn underneath it.',
      table: { category: 'Wellbores' },
    },
    wellbore: {
      options: Object.keys(storyArgs.wellboreOptions),
      control: { type: 'select', labels: storyArgs.wellboreOptions },
      description:
        'Which wellbore the fence follows. ⭐ The 3D view and the well map still select by event and will override this; picking here is for reaching a NAMED well directly, which is what an A/B needs. Ones worth trying: `NO 15/9-F-12`, `NO 15/9-F-11 A/B`, `NO 15/9-F-15 D` all misbehave, `NO 15/9-19 S` is clean.',
      table: { category: 'Wellbores' },
    },
    fence: {
      description:
        'Open the block along the SELECTED wellbore, instead of with a plane. ⚠️ Needs a wellbore selected (turn `wellbores` on and click one) — nothing is cut until then. ⭐ Changing which well is cut costs a resample and an upload, not a build, which is why it can happen inside a fly-to. Turning this on disables the plane section.',
      table: { category: 'Fence' },
    },
    fenceResolution: {
      control: { type: 'select' },
      options: [2, 5, 10, 25, 50],
      description:
        'Spacing the cut face is built at, in metres. ⭐ The face is a ribbon along the trajectory, INDEPENDENT of the tessellation, so this alone sets how smooth it is — it is not floored by the triangle size the way a cut through the cells was.',
      table: { category: 'Fence' },
    },
    fenceSide: {
      control: { type: 'inline-radio' },
      options: [1, -1],
      description:
        'Which half goes, in `split`. ⚠️ Explicit for now — deriving it from the camera so the cut always faces you is the obvious next step, but it would re-orient mid fly-to, which is a judgement to make with the animation rather than before it.',
      table: { category: 'Fence' },
    },
    fenceWidth: {
      control: { type: 'range', min: 0, max: 2000, step: 25 },
      description:
        'Metres of clearance between the well and the face. 0 puts the face through the well itself — the classic section, with the trajectory lying in the cut. ⭐ Free to sweep: no rebuild behind it.',
      table: { category: 'Fence' },
    },
    fenceOffset: {
      control: { type: 'range', min: -20, max: 20, step: 0.5 },
      description:
        'Metres to move the cut face toward the KEPT side. ⚠️ Normally 0 — the face is drawn with a material that is not itself cut, so it needs no nudge to escape its own test, and an inset leaves the unit’s cap overhanging it as a thin bright lip. A small NEGATIVE value pushes the face slightly proud instead, which is how to tell a SEAM apart from a geometry fault: if a seam closes at −2 it was never a geometry problem.',
      table: { category: 'Fence' },
    },
    fenceCellSize: {
      control: { type: 'select' },
      options: [12.5, 25, 50, 100],
      description:
        'Metres per cell of the distance field the CLIP reads. ⭐ Coarse is fine: a SIGNED distance is continuous across the curve, and the shader smooths its own sampling — the error is in where the boundary sits, not in how ragged it is.',
      table: { category: 'Fence' },
    },
    fenceAzimuth: {
      control: { type: 'range', min: 0, max: 360, step: 5 },
      description:
        'Degrees. Only used for a well with too little PLAN deviation to give the fence a direction — a vertical well’s plan trace is a point, so every direction through it is equally arbitrary and this is a knob rather than a rule. Drag it to swing the cut around the wellhead.',
      table: { category: 'Fence' },
    },
    fenceReveal: {
      control: { type: 'range', min: 0.05, max: 0.8, step: 0.05 },
      description:
        'Share of the block the cut aims to take away on the side being removed. ⭐⭐ What the run-outs are chosen by: a fence exists to take away whatever stands between you and the well, so what matters is that the removed side is a usable piece of block. Measured on the Volve data the healthy wells split 43-58% while the broken ones left one side 0-17%, which is a cut that either shows nothing or removes everything. ⚠️ A target, not a guarantee — a well near the edge of the footprint cannot leave half of it on both sides, and the two sides will differ markedly. ⚠️ Rebuilds, unlike `fenceWidth`.',
      table: { category: 'Fence' },
    },
    fenceHeadWidth: {
      control: { type: 'range', min: 0, max: 1500, step: 25 },
      description:
        'Extra metres of clearance at the SHALLOW end, closing to nothing by `fenceDeepDepth`. 0 is a cut of uniform width. ⭐⭐ The shallow section of a well is near-vertical, so its plan trace is a few tens of metres of survey noise standing in for kilometres of hole — following it hugs something that is not there and pinches the cut to a blade. Opening the corridor out gives that wiggle somewhere to live, and costs nothing down in the reservoir where the cut should follow the well closely.',
      table: { category: 'Fence taper' },
    },
    fenceShallowDepth: {
      control: { type: 'range', min: 0, max: 3000, step: 50 },
      description:
        'Metres below MSL down to which `fenceHeadWidth` applies in full.',
      table: { category: 'Fence taper' },
    },
    fenceDeepDepth: {
      control: { type: 'range', min: 0, max: 4000, step: 50 },
      description:
        'Metres below MSL by which the widening has closed to nothing. ⚠️ Must be deeper than `fenceShallowDepth`, or the taper is ignored.',
      table: { category: 'Fence taper' },
    },
    fenceDebug: {
      description:
        'Draw the cut face as a magenta wireframe instead of as rock — the ribbon the fence actually generated, on its own. ⭐ The face is built independently of the block, so this is the only way to tell a geometry fault from a clipping one.',
      table: { category: 'Fence' },
    },
    seal: {
      description:
        'Close the block where a surface is not mapped, by tapering it between its neighbours instead of leaving a hole.',
      table: { category: 'Resolve' },
    },
    sealMode: {
      control: { type: 'inline-radio' },
      options: ['proportional', 'void'],
      description:
        '`proportional` carries the ratio between the surfaces above and below, so both units survive. `void` splits the surface in two and opens a lens-shaped cavity — the hole IS the statement that the units are not defined there.',
      table: { category: 'Resolve' },
    },
    minThickness: {
      control: { type: 'select' },
      options: [0.5, 1, 2, 5, 10, 20],
      description:
        'How much of each neighbouring unit a taper leaves standing, in metres. ⚠️ Must stay above `collapseThreshold` or the sliver is dropped and the hole comes back.',
      table: { category: 'Resolve' },
    },
    maxFill: {
      control: { type: 'select' },
      options: [0, 100, 250, 500, 1000, 2000],
      description:
        'How far a layer counts as covered past its own data, in metres. Behaves as an EROSION RADIUS: a hole of radius r vanishes at maxFill = r, and a larger one merely loses a rim of that width.',
      table: { category: 'Resolve' },
    },
    collapseThreshold: {
      control: { type: 'select' },
      options: [0, 0.25, 0.5, 1, 2, 5],
      description:
        'Thickness below which a unit is treated as pinched out and its triangles dropped, in metres.',
      table: { category: 'Resolve' },
    },
    constrainCoverage: {
      description:
        'Constrain each layer’s data boundary into the shared tessellation, so a triangle is either wholly inside a survey or wholly outside it. Costs vertices along every partly-mapped layer’s edge.',
      table: { category: 'Resolve' },
    },
    water: { table: { category: 'Water' } },
    section: {
      description:
        'Cut the block with a plane. ⭐ Toggling is free — the cut face’s build payload is requested by the section’s PRESENCE, so switching it off throws no geometry away.',
      table: { category: 'Section' },
    },
    sectionMode: {
      control: { type: 'inline-radio' },
      options: ['fixed', 'camera'],
      description:
        '`camera` locks the plane in front of the camera, so orbiting chooses the angle and dollying drives the cut through the block — no gizmo to hit. `fixed` drives it from the azimuth/dip/distance controls below.',
      table: { category: 'Section' },
    },
    sectionCameraDistance: {
      control: { type: 'range', min: 0, max: 20000, step: 100 },
      description:
        'Metres in front of the camera to put the plane (`camera` mode). With `sectionVertical` on this is measured in PLAN.',
      table: { category: 'Section' },
    },
    sectionVertical: {
      description:
        'Keep a camera-locked plane VERTICAL — it takes the camera’s heading but never its dip. A cut that tilts as you orbit makes the block appear to shear, which is exactly what stops the geology being readable.',
      table: { category: 'Section' },
    },
    sectionAzimuth: {
      control: { type: 'range', min: 0, max: 360, step: 5 },
      table: { category: 'Section' },
    },
    sectionDip: {
      control: { type: 'range', min: -90, max: 90, step: 5 },
      table: { category: 'Section' },
    },
    sectionDistance: {
      control: { type: 'range', min: -20000, max: 20000, step: 250 },
      table: { category: 'Section' },
    },
    sectionFlip: {
      description: 'Keep the other half.',
      table: { category: 'Section' },
    },
    sectionAnimate: {
      description: 'Tumble the fixed plane, to see the cut face rebuild live.',
      table: { category: 'Section' },
    },
    sectionAnimateSpeed: {
      control: { type: 'range', min: 0.1, max: 4, step: 0.1 },
      table: { category: 'Section' },
    },
    sectionWater: {
      description:
        'Cut the sea too. ⚠️ The water gets no cut FACE — it simply ends at the plane, so you look into an open water body. Off keeps the sea whole over a sliced block.',
      table: { category: 'Section' },
    },
    sectionCarrier: {
      description:
        'Cut the floor too. Off leaves the block standing on an intact base plate.',
      table: { category: 'Section' },
    },
    sectionKeep: {
      control: { type: 'number', min: -1, max: 40, step: 1 },
      description:
        'Index into the DRAWN layers of one to leave uncut, so it stands whole over the section (-1 = cut everything). Clamped to what is drawn.',
      table: { category: 'Section' },
    },
    sectionDebug: {
      description: 'Draw where the plane is.',
      table: { category: 'Section' },
    },
    seaLevel: {
      control: { type: 'select' },
      options: [-200, -100, -50, 0, 50, 100, 200],
      description: 'Depth of the sea surface, positive DOWN.',
      table: { category: 'Water' },
    },
    waterOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'The water shader’s own base opacity, before the fresnel term. Distinct from `waterLayerOpacity`, which multiplies the lot.',
      table: { category: 'Water' },
    },
    waterLayerOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Water' },
    },
    windSpeed: {
      control: { type: 'range', min: 0, max: 25, step: 0.5 },
      table: { category: 'Water' },
    },
    foamAmount: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Water' },
    },
    bedTint: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'Tint the sea bed toward the water colour by DEPTH, so the shoreline appears on its own.',
      table: { category: 'Water' },
    },
    immersion: {
      description:
        'Fog the view when the camera goes inside a medium — the sea, or the block itself — so being inside it reads as being inside it. ⚠️ Absent unless enabled: its presence is what installs `scene.fog`.',
      table: { category: 'Immersion' },
    },
    immersionColor: {
      control: { type: 'color' },
      description:
        'Colour INSIDE THE BLOCK (the sea has its own). A near-black brown, not a water colour.',
      table: { category: 'Immersion' },
    },
    immersionVisibility: {
      control: { type: 'range', min: 10, max: 3000, step: 10 },
      description:
        'Roughly how far you can see inside the medium, in metres. ⚠️ `FogExp2` saturates quadratically: ~63% fogged at this distance, ~98% at twice it.',
      table: { category: 'Immersion' },
    },
    immersionTransition: {
      control: { type: 'range', min: 0, max: 50, step: 1 },
      description:
        'Metres over which a medium fades in at its boundaries — what stops the edge of the sea, or of the block, reading as a hard line.',
      table: { category: 'Immersion' },
    },
    immersionSettle: {
      control: { type: 'range', min: 0, max: 1, step: 0.02 },
      description:
        'Seconds for the fog to catch up with a step change. ⚠️ Keep it short — leaving a medium SIDEWAYS has no distance to ramp over, and a slow settle reads as a bug.',
      table: { category: 'Immersion' },
    },
    immersionBackground: {
      description: 'Tint the background to match, not just the geometry.',
      table: { category: 'Immersion' },
    },
    floor: {
      description:
        'Close the block with a flat plane below its deepest surface — the column’s carrier.',
      table: { category: 'Floor' },
    },
    floorClearance: {
      control: { type: 'select' },
      options: [0, 100, 200, 400, 800, 1500, 2000],
      description:
        'Metres below the column’s deepest MAPPED sample to put the floor.',
      table: { category: 'Floor' },
    },
    floorColor: { control: { type: 'color' }, table: { category: 'Floor' } },
    surfaceOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Appearance' },
    },
    wallOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Appearance' },
    },
    wireframe: { table: { category: 'Appearance' } },
    peel: {
      control: { type: 'number', min: 0, max: 40, step: 1 },
      description:
        'Hide the first N UNITS, exposing what is under them — a COUNT, so whole units only. Pure appearance: no rebuild, free to sweep. Clamped to what is drawn.',
      table: { category: 'Appearance' },
    },
    inferredStyle: {
      control: { type: 'inline-radio' },
      options: ['none', 'hatched', 'checker', 'zigzag'],
      description:
        'Mark the regions the seal INFERRED — where a surface has no data of its own and its height was carried in from its neighbours.',
      table: { category: 'Appearance' },
    },
    detail: {
      control: { type: 'select' },
      options: ['none', ...CHUNK_DETAIL_PRESET_NAMES],
      description:
        'Procedural surface detail, applied uniformly. ⚠️ The strat column carries no lithology, so there is nothing to pick a per-unit preset from — that mapping would be the host’s, like the colour.',
      table: { category: 'Appearance' },
    },
    detailStrength: {
      control: { type: 'range', min: 0, max: 2, step: 0.05 },
      table: { category: 'Appearance' },
    },
  },
  decorators: [
    EventEmitterDecorator,
    GlyphsDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    WellMapDecorator,
    DataProviderDecorator,
  ],
};
