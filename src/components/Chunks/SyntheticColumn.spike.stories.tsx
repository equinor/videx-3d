import { useFrame, useThree } from '@react-three/fiber';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plane, Vector3 } from 'three';
import { useData } from '../../hooks/useData';
import { OITRenderPass, Pass } from '../../main';
import { OutputPass } from '../../rendering/passes/OutputPass';
import { RenderingPipeline } from '../../rendering/RenderingPipeline';
import {
  PlanarPolygonGeometry,
  SedimentClass,
  SurfaceChunkMetrics,
  SurfaceMeta,
  Vec2,
} from '../../sdk';
import {
  getSyntheticColumn,
  syntheticColumnKeys,
  SyntheticColumnUnit,
} from '../../storybook/data/synthetic-surfaces';
import {
  SUBSEA_ROUTES,
  SUBSEA_SITES,
  siteByName,
} from '../../storybook/data/subsea-facilities';
import {
  SeabedFacility,
  SeabedFacilityReport,
} from '../../storybook/components/SeabedFacility';
import { Pipeline, PipelineReport } from '../Pipeline';
import {
  SurfacePlacement,
  useSurfaceCursor,
} from '../../storybook/components/useSurfaceCursor';
import { Canvas3dDecorator } from '../../storybook/decorators/canvas-3d-decorator';
import { DataProviderDecorator } from '../../storybook/decorators/data-provider-decorator';
import { EventEmitterDecorator } from '../../storybook/decorators/event-emitter-decorator';
import { GeneratorsProviderDecorator } from '../../storybook/decorators/generators-provider-decorator';
import { GlyphsDecorator } from '../../storybook/decorators/glyphs-decorator';
import storyArgs from '../../storybook/story-args.json';
import { Tanker } from '../Tanker/Tanker';
import { UtmArea } from '../UtmArea';
import { Chunk } from './Chunk';
import { ChunkLayer, ChunkResolveOptions, StackWater } from './chunk-defs';
import { ChunkStack } from './ChunkStack';
import { ChunkInferenceStyle } from './inference-material';

const utmZone = storyArgs.utmZone;
const origin = storyArgs.origin as Vec2;

/**
 * Point the section plane, in the stack's own frame. `azimuth` swings the normal
 * in XZ and `dip` tilts it up out of horizontal, so dip 0 is a vertical cut — the
 * one a geological section is normally drawn on.
 *
 * `distance` is measured along the UNFLIPPED normal, so flipping which half is
 * kept leaves the plane where it is.
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
 * ⚠️ Rendered INSIDE the `ChunkStack`, deliberately: child `useFrame`s subscribe
 * before their parent's, so the stack reads the plane in the same frame this wrote
 * it. Driving it from the story component (which renders the stack) would put the
 * cut one frame behind the control while animating.
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
    // Advancing the CLOCK rather than scaling the terms keeps the tumble's shape
    // fixed at any speed.
    clock.current += delta * speed;
    const t = clock.current;
    // Three incommensurate periods, so it never repeats and there is nothing to
    // tune. A demo effect, not a feature.
    setSectionPlane(
      plane,
      t * 23,
      45 * Math.sin(t * 0.21),
      2600 * Math.sin(t * 0.13),
      flip,
    );
  });
  return null;
};

/**
 * Sediment class → colour. ⭐ This mapping lives in the STORY on purpose: the
 * library never assigns a colour, because the name → unit → colour lookup is
 * company-specific (documents/chunks.md, "colour is config").
 */
const CLASS_COLOUR: Record<SedimentClass, string> = {
  sand: '#e0b96a',
  silt: '#a8ac8a',
  shale: '#6c7f8b',
  carbonate: '#cbd5d0',
  salt: '#efe6d8',
  coal: '#3c3c40',
  basement: '#8a6f63',
};

/** The industry's fluid colours, and the basis of the tinted palette. */
const FLUID_COLOUR = {
  gas: '#c8452f',
  oil: '#3f7a3f',
  water: '#3f6fa8',
} as const;

/** The contact plane itself — a level between two legs, not a unit of its own. */
const CONTACT_COLOUR = '#2b2b30';

/** Mix two `#rrggbb` colours; `t` is the share of `b`. */
function mixHex(a: string, b: string, t: number): string {
  const channels = (hex: string) =>
    [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const from = channels(a);
  const to = channels(b);
  return `#${from
    .map((c, i) =>
      Math.round(c + (to[i] - c) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Unit names of the demo column, for the contact's host-unit control. */
const UNIT_NAMES = getSyntheticColumn(syntheticColumnKeys[0]).map(u => u.name);

// Always-on OIT pipeline (SMAA), matching the sibling chunk stories.
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

type SyntheticColumnProps = {
  column: string;
  from: number;
  count: number;
  outlineSize: number;
  maxError: number;
  contact: boolean;
  contactUnit: string;
  gasContact: boolean;
  gocDepth: number;
  owcDepth: number;
  contactRelief: number;
  contactColours: 'tinted' | 'convention';
  floor: boolean;
  floorClearance: number;
  floorColor: string;
  water: boolean;
  waterDepth: number;
  waterOpacity: number;
  waterLayerOpacity: number;
  windSpeed: number;
  windDirection: number;
  foamAmount: number;
  displacement: boolean;
  waterResolution: number;
  bodyFogDensity: number;
  bodyMaxOpacity: number;
  bodyShimmer: number;
  bedTint: number;
  bedTintDepth: number;
  ship: boolean;
  shipX: number;
  shipZ: number;
  shipHeading: number;
  facilities: boolean;
  facilityBase: boolean;
  facilitySize: number;
  baseLevel: 'max' | 'mean' | 'min';
  baseStandoff: number;
  baseEmbedment: number;
  pipelines: boolean;
  pipeExaggeration: number;
  pipeSpacing: number;
  pipeSpan: number;
  pipeSmoothing: number;
  cursor: boolean;
  cursorRadius: number;
  cursorSamples: number;
  cursorFocus: boolean;
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
  peel: number;
  seal: boolean;
  sealMode: 'proportional' | 'void';
  minThickness: number;
  maxFill: number;
  constrainCoverage: boolean;
  coverageAbsence: boolean;
  collapseThreshold: number;
  surfaceOpacity: number;
  wallOpacity: number;
  wireframe: boolean;
  detail: boolean;
  detailStrength: number;
  inferredStyle: ChunkInferenceStyle;
};

/**
 * Everything drawn INSIDE the stack.
 *
 * ⚠️ Its own component on purpose: `useSurfaceCursor` reads the sampler the
 * `ChunkStack` provides, so it has to be called BELOW that provider. Calling it in
 * the story component — which renders the stack — gets `null` and the pointer does
 * nothing, with no error to say why.
 */
const StackContents = ({
  props,
  layers,
  sectionPlane,
  onBuild,
  onSite,
  onLine,
  onPlace,
}: {
  props: SyntheticColumnProps;
  layers: ChunkLayer[];
  sectionPlane: Plane;
  onBuild: (metrics: SurfaceChunkMetrics) => void;
  onSite: (report: SeabedFacilityReport) => void;
  onLine: (name: string, report: PipelineReport) => void;
  onPlace: (placement: SurfacePlacement) => void;
}) => {
  const cursor = useSurfaceCursor({
    radius: props.cursorRadius,
    samples: props.cursorSamples,
    focus: props.cursorFocus,
    onPlace,
  });

  return (
    <>
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
        maxError={props.maxError}
        surfaceOpacity={props.surfaceOpacity}
        wallOpacity={props.wallOpacity}
        wireframe={props.wireframe}
        inferredStyle={props.inferredStyle}
        peel={props.peel}
        onBuild={onBuild}
        {...(props.cursor ? cursor.events : null)}
      />
      {/* The gizmo stays OUTSIDE the chunk, or the pointer picks it instead of
          the ground. */}
      {props.cursor && cursor.node}
      {/* The wave sampler and the contact-foam registry reach the hull through
          context. Its origin IS its waterline. */}
      {props.ship && (
        <Tanker
          position={[props.shipX, -props.waterDepth, props.shipZ]}
          heading={(props.shipHeading * Math.PI) / 180}
        />
      )}
      {/* Sites given as UTM coordinates, put down by sampling the sea bed the
          chunk actually drew. */}
      {props.facilities &&
        SUBSEA_SITES.map(site => (
          <SeabedFacility
            key={site.name}
            site={site}
            size={props.facilitySize}
            base={props.facilityBase}
            level={props.baseLevel}
            standoff={props.baseStandoff}
            embedment={props.baseEmbedment}
            onReport={onSite}
          />
        ))}
      {/* The same data, laid along a route instead of at a point. Site names are
          resolved to coordinates here — the component takes plain UTM. */}
      {props.pipelines &&
        SUBSEA_ROUTES.map(route => (
          <Pipeline
            key={route.name}
            route={route.nodes.map(node =>
              typeof node === 'string'
                ? ((): Vec2 => {
                    const site = siteByName(node);
                    return site ? [site.easting, site.northing] : [0, 0];
                  })()
                : node,
            )}
            diameter={route.diameter}
            material={route.color}
            exaggeration={props.pipeExaggeration}
            spacing={props.pipeSpacing}
            span={props.pipeSpan}
            smoothing={props.pipeSmoothing}
            trim={props.facilityBase ? props.facilitySize * 0.55 : 0}
            onBuild={report => onLine(route.name, report)}
          />
        ))}
    </>
  );
};

const SyntheticColumnStory = (props: SyntheticColumnProps) => {
  const store = useData();

  // The units, shallowest first — the order a chunk's layer array takes, which
  // here is GUARANTEED right because the generator deposited them in it.
  const units = useMemo<SyntheticColumnUnit[]>(
    () => getSyntheticColumn(props.column),
    [props.column],
  );

  const selected = useMemo(
    () => units.slice(props.from, props.from + props.count),
    [units, props.from, props.count],
  );

  // ⚠️ Through the STORE, not `useSurfaceMetaDict` — that hook fetches
  // /data/surface-meta.json directly and never sees a generated surface.
  const [column, setColumn] = useState<SurfaceMeta[]>([]);
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    (async () => {
      const metas = await Promise.all(
        selected.map(u => store.get<SurfaceMeta>('surface-meta', u.id)),
      );
      if (cancelled) return;
      setColumn(metas.filter((m): m is SurfaceMeta => !!m));
    })();
    return () => {
      cancelled = true;
    };
  }, [store, selected]);

  const outline = useMemo<PlanarPolygonGeometry>(() => {
    const h = (props.outlineSize * 1000) / 2;
    const ring: Vec2[] = [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ];
    return new PlanarPolygonGeometry([[[...ring, ring[0]]]], [0, 0]);
  }, [props.outlineSize]);

  // ⚠️ The names travel WITH the layers: a contact spliced into the middle shifts
  // every layer index below it, and the diagnostics are reported by index.
  const { layers, info } = useMemo(() => {
    const info = column.map((surface, i) => ({
      name: selected[i]?.name ?? surface.name,
      class: (selected[i]?.class ?? '') as string,
    }));
    const units: ChunkLayer[] = column.map((surface, i) => {
      const sediment = selected[i]?.class ?? 'shale';
      const colour = CLASS_COLOUR[sediment];
      // ⭐ The class → detail mapping is the story's, exactly like the colour one:
      // the library ships the presets but never decides which unit is sand.
      const detail = props.detail
        ? { preset: sediment, strength: props.detailStrength }
        : undefined;
      return { surface, material: colour, fill: colour, detail };
    });
    // One unit kept WHOLE while the rest is cut — the cap that floors it comes
    // along on its own, which is the point of the flag being per unit.
    if (props.sectionKeep >= 0 && props.sectionKeep < units.length) {
      units[props.sectionKeep] = {
        ...units[props.sectionKeep],
        section: false,
      };
    }
    // ⭐ Fluid contacts INSIDE a unit — an oil/water contact and a gas cap. A
    // contact is a LEVEL, not a horizon, so `fluid` keeps it from ever becoming
    // the authority for what lies below: the reservoir's base is not dragged down
    // to make room for it, and where a leg has no room it simply pinches out.
    const host = props.contact
      ? info.findIndex(u => u.name === props.contactUnit)
      : -1;
    if (host >= 0 && host < units.length - 1) {
      const rock = CLASS_COLOUR[selected[host]?.class ?? 'shale'];
      const leg = (fluid: keyof typeof FLUID_COLOUR) =>
        props.contactColours === 'tinted'
          ? // Mostly the fluid: an even mix leaves the water leg indistinguishable
            // from the sand it sits in.
            mixHex(rock, FLUID_COLOUR[fluid], 0.7)
          : FLUID_COLOUR[fluid];
      // ⚠️ Clamped by the STORY: a gas cap cannot lie below the oil/water contact,
      // and nothing in the library would put it right — two fluids in one unit are
      // each measured against the nearest SOLID boundary above, never against each
      // other, so crossing them would simply stay crossed.
      const goc = Math.min(props.gocDepth, props.owcDepth);
      const common = {
        fluid: true,
        material: CONTACT_COLOUR,
        detail: units[host].detail,
        // A kept unit is now two or three legs, and a slab missing its water leg
        // is the hollow shell the flag exists to avoid.
        section: units[host].section,
        // Gravity makes a contact flat; anything else is a test of the relief path.
        relief:
          props.contactRelief > 0
            ? {
                kind: 'dunes' as const,
                amplitude: props.contactRelief,
                featureSize: 3000,
                seed: 5,
              }
            : undefined,
      };
      const contacts: { name: string; layer: ChunkLayer }[] = [];
      if (props.gasContact) {
        contacts.push({
          name: 'GOC',
          layer: { ...common, depth: goc, fill: leg('oil') },
        });
      }
      contacts.push({
        name: 'OWC',
        layer: { ...common, depth: props.owcDepth, fill: leg('water') },
      });
      // The host unit's own fill becomes the TOPMOST leg.
      units[host] = {
        ...units[host],
        fill: props.gasContact ? leg('gas') : leg('oil'),
      };
      units.splice(host + 1, 0, ...contacts.map(c => c.layer));
      info.splice(
        host + 1,
        0,
        ...contacts.map(c => ({ name: c.name, class: 'fluid' })),
      );
    }
    // ⭐ The floor is asked for by the FILL on the last layer, and by nothing else:
    // a volume there has no next boundary to end on, so the column's carrier ends
    // it. Take the fill away and the block simply stops at its deepest surface,
    // even though the carrier is still declared on the stack.
    const last = units.length - 1;
    if (!props.floor && last >= 0) {
      units[last] = { ...units[last], fill: undefined };
    }
    return { layers: units, info };
  }, [
    column,
    selected,
    props.detail,
    props.detailStrength,
    props.floor,
    props.sectionKeep,
    props.contact,
    props.contactUnit,
    props.gasContact,
    props.gocDepth,
    props.owcDepth,
    props.contactRelief,
    props.contactColours,
  ]);

  // The sea is the COLUMN's, not a chunk layer: one lid over the whole stack,
  // drawn once however many chunks are cut from it.
  const water = useMemo<StackWater | undefined>(() => {
    if (!props.water) return undefined;
    const angle = (props.windDirection * Math.PI) / 180;
    return {
      depth: props.waterDepth,
      opacity: props.waterLayerOpacity,
      windSpeed: props.windSpeed,
      windDirection: [Math.cos(angle), Math.sin(angle)] as Vec2,
      waterOpacity: props.waterOpacity,
      foamAmount: props.foamAmount,
      displacement: props.displacement,
      resolution: props.waterResolution > 0 ? props.waterResolution : undefined,
      bodyFogDensity: props.bodyFogDensity,
      bodyMaxOpacity: props.bodyMaxOpacity,
      bodyShimmer: props.bodyShimmer,
      bedTint: props.bedTint,
      bedTintDepth: props.bedTintDepth,
    };
  }, [
    props.water,
    props.waterDepth,
    props.waterOpacity,
    props.waterLayerOpacity,
    props.windSpeed,
    props.windDirection,
    props.foamAmount,
    props.displacement,
    props.waterResolution,
    props.bodyFogDensity,
    props.bodyMaxOpacity,
    props.bodyShimmer,
    props.bedTint,
    props.bedTintDepth,
  ]);

  const resolve = useMemo<ChunkResolveOptions>(
    () => ({
      maxFill: props.maxFill,
      seal: props.seal,
      sealMode: props.sealMode,
      minThickness: props.minThickness,
      constrainCoverage: props.constrainCoverage,
      coverageAbsence: props.coverageAbsence,
      collapseThreshold: props.collapseThreshold,
    }),
    [
      props.maxFill,
      props.seal,
      props.sealMode,
      props.minThickness,
      props.constrainCoverage,
      props.coverageAbsence,
      props.collapseThreshold,
    ],
  );

  const report = useMemo(
    () => (metrics: SurfaceChunkMetrics) => {
      const d = metrics.diagnostics;
      const rows = (d?.layers ?? []).map(l => ({
        unit: info[l.index]?.name ?? 'floor',
        class: info[l.index]?.class ?? '',
        coverage: +l.coverage.toFixed(4),
        filled: +l.filled.toFixed(4),
        inferred: +l.inferred.toFixed(4),
        voided: l.voided,
        triangles: l.triangles,
        droppedAbsent: l.droppedAbsent,
        droppedCollapsed: l.droppedCollapsed,
      }));
      console.log(
        `CHUNKREPORT ${JSON.stringify({
          column: props.column,
          triangles: metrics.triangles,
          wallTriangles: metrics.wallTriangles,
          crossings: d?.crossings ?? null,
          maxOverlap: d?.maxOverlap ?? null,
          coverageRingPoints: d?.coverageRingPoints ?? null,
          constraintFailures: d?.constraintFailures ?? null,
          tessellateMs: Math.round(d?.tessellateMs ?? 0),
          layers: rows,
        })}`,
      );
      console.table(rows);
    },
    [props.column, info],
  );

  // Every site reports what the sea bed under it turned out to be — the numbers
  // that say whether a base was needed and how much of one.
  const sites = useRef(new Map<string, SeabedFacilityReport>());
  const reportSite = useMemo(
    () => (site: SeabedFacilityReport) => {
      sites.current.set(site.name, site);
      const rows = [...sites.current.values()].map(s => ({
        site: s.name,
        level: +s.level.toFixed(1),
        bedMin: +s.min.toFixed(1),
        bedMax: +s.max.toFixed(1),
        relief: +(s.max - s.min).toFixed(1),
        fill: +s.fill.toFixed(1),
        cut: +s.cut.toFixed(1),
        volume: Math.round(s.volume),
        coverage: +s.coverage.toFixed(3),
      }));
      console.log(`SITEREPORT ${JSON.stringify(rows)}`);
      if (sites.current.size === SUBSEA_SITES.length) console.table(rows);
    },
    [],
  );

  const lines = useRef(new Map<string, PipelineReport & { name: string }>());
  const reportLine = useMemo(
    () => (name: string, line: PipelineReport) => {
      lines.current.set(name, { ...line, name });
      const rows = [...lines.current.values()].map(l => ({
        line: l.name,
        nodes: l.nodes,
        mapLength: Math.round(l.mapLength),
        // The ground it follows is always longer than the route on the map.
        length: Math.round(l.length),
        climb: +(l.length - l.mapLength).toFixed(1),
        lifted: +l.lifted.toFixed(1),
        gaps: l.gaps,
      }));
      console.log(`PIPEREPORT ${JSON.stringify(rows)}`);
      if (lines.current.size === SUBSEA_ROUTES.length) console.table(rows);
    },
    [],
  );

  // One log per CLICK. A move must stay free of anything but the sample itself.
  const reportPlacement = useMemo(
    () => (placement: SurfacePlacement) => {
      console.log(
        `CURSORREPORT ${JSON.stringify({
          x: Math.round(placement.position[0]),
          y: +placement.position[1].toFixed(1),
          z: Math.round(placement.position[2]),
          tilt: +placement.tilt.toFixed(2),
          relief: +placement.relief.toFixed(2),
          coverage: placement.coverage,
        })}`,
      );
    },
    [],
  );

  // The gizmo and the handlers to hand to the chunk (see `useSurfaceCursor`).

  // ⭐ Created once and MUTATED — that is the supported way to animate a section:
  // the stack reads it every frame, so it costs no React render.
  const sectionPlane = useMemo(() => new Plane(new Vector3(0, 0, 1), 0), []);
  const section = useMemo(
    () => ({
      plane: sectionPlane,
      enabled: props.section,
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
      props.sectionMode,
      props.sectionCameraDistance,
      props.sectionVertical,
      props.sectionWater,
      props.sectionCarrier,
      props.sectionDebug,
    ],
  );

  // Only waiting for the store fetch — the block's bottom is the stack's carrier,
  // not a second layer.
  if (layers.length === 0) return null;
  return (
    <>
      <UtmArea origin={origin} utmZone={utmZone}>
        <ChunkStack
          outline={outline}
          surfaces={column}
          water={water}
          resolve={resolve}
          section={section}
          carrier={{
            below: props.floorClearance,
            material: props.floorColor,
          }}
        >
          <StackContents
            props={props}
            layers={layers}
            sectionPlane={sectionPlane}
            onBuild={report}
            onSite={reportSite}
            onLine={reportLine}
            onPlace={reportPlacement}
          />
        </ChunkStack>
      </UtmArea>
      <ChunkPipeline />
    </>
  );
};

const meta = {
  title: 'Spikes/Chunks/SyntheticColumn',
  component: SyntheticColumnStory,
  parameters: {
    scale: 5000,
    cameraPosition: [7000, 3500, 7000],
    cameraTarget: [0, -1400, 0],
    docs: {
      description: {
        component:
          'A chunk cut from a GENERATED stratigraphic column — a set of surfaces that are exact functions of one another, rather than the independent surfaces of `SyntheticCoverage`.\n\n' +
          'Each unit is deposited as `thickness = drape + fill · max(0, dPrev − datum)`: `drape` blankets the topography, `fill` levels it toward `datum`. Where the surface below is already shallower than the datum the unit has NO thickness, so it **pinches out over the highs** — a real zero-thickness termination, which the demo field only shows by accident.\n\n' +
          'The column also contains a **fault** (gridded into a ramp and dying out along strike — a height field cannot hold the break, so the surfaces are carried across it exactly as an interpreter would), a **partly-mapped unit** (a survey extent, not geology), and an **angular unconformity** whose truncated horizons are recorded as NO DATA by default, which is what an interpreter delivers and what makes them indistinguishable from a survey edge.\n\n' +
          '⭐ The SHALLOWEST surface is the SEA BED, and it is shaped rather than noised: a basin ~210 m deep, a coast rising out of it to ~45 m above sea level on one side, and an island standing off it with a hill on top (~99 m). Those are composable landform primitives (`ramp`, `dome`) with a little dune texture over them — noise alone reads as static, not as terrain. The sea is declared on the `ChunkStack` rather than as a chunk layer, and takes no part in the depth order, so the ground rises THROUGH the plane instead of being flattened onto it and the water body ends at the shoreline. `bedTint` then tints the bed toward the water colour BY DEPTH, so the shoreline appears on its own.\n\n' +
          '⭐ The deep Rotliegend sand carries **fluid contacts** — a gas cap and an oil/water contact, as synthetic `fluid` layers. A contact is a LEVEL, not a horizon: it is clamped into place by the reservoir’s top like any boundary, but it is never the AUTHORITY for what lies below, so the base is never dragged down to make room for it. Both defaults are picked to STRADDLE their surface — the gas leg stands over ~43% of the block and pinches out over the highs, the water leg has no room over ~29% of it — so the pinch-out is the thing you see, not a deformed base. Peel to the reservoir or cut a section through it to see the legs. See the Contacts group.\n\n' +
          '⭐ Everything about the column — grid size and resolution, number of units, structure, seed, erosion encoding, where the fault and the unconformity fall — comes from the `COLUMN` constants in `src/storybook/data/synthetic-surfaces.ts`. Change one and reload to get a different field.\n\n' +
          'A **tanker** floats in the sea for scale — 253 m against a 7 km field. It reads the wave sampler and the contact-foam registry the `ChunkStack` provides, exactly as it would inside an `<Ocean>`, so it heaves with the swell and spreads foam where it meets the water.\n\n' +
          '⭐⭐ Because every relationship is known, a crossing or a mis-ordering reported here is unambiguously a pipeline bug — with ONE caveat. `crossings` and `maxOverlap` are measured on the column BEFORE the order is enforced, and the seal’s tapers legitimately pass through each other there (see chunks.md §10.7), so they read non-zero whenever a layer is sealed: turn `seal` off, or draw a range with no partly-mapped unit, to see them fall to zero. ⚠️ The fluid contacts cannot contribute to either figure — both count COLUMN pairs, and a contact is a chunk-private synthetic layer.',
      },
    },
  },
} satisfies Meta<typeof SyntheticColumnStory>;

export default meta;
type Story = StoryObj<typeof SyntheticColumnStory>;

export const Default: Story = {
  args: {
    column: syntheticColumnKeys[0],
    from: 0,
    count: 20,
    outlineSize: 7,
    maxError: 5,
    contact: true,
    contactUnit: 'Rotliegend',
    gasContact: true,
    gocDepth: 2200,
    owcDepth: 2600,
    contactRelief: 0,
    contactColours: 'convention',
    floor: true,
    floorClearance: 400,
    floorColor: '#6b6b6b',
    water: true,
    waterDepth: 0,
    waterOpacity: 0.7,
    waterLayerOpacity: 1,
    windSpeed: 10,
    windDirection: 30,
    foamAmount: 0.5,
    displacement: false,
    waterResolution: 0,
    bodyFogDensity: 0.004,
    bodyMaxOpacity: 0.9,
    bodyShimmer: 0.5,
    bedTint: 0.6,
    bedTintDepth: 80,
    ship: true,
    shipX: 2200,
    shipZ: 1800,
    shipHeading: -30,
    facilities: true,
    facilityBase: true,
    facilitySize: 80,
    baseLevel: 'max',
    baseStandoff: 0,
    baseEmbedment: 2,
    pipelines: true,
    pipeExaggeration: 1,
    pipeSpacing: 25,
    pipeSpan: 0,
    pipeSmoothing: 0,
    cursor: false,
    cursorRadius: 120,
    cursorSamples: 12,
    cursorFocus: true,
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
    peel: 0,
    seal: true,
    sealMode: 'proportional',
    minThickness: 1,
    maxFill: 250,
    constrainCoverage: false,
    coverageAbsence: true,
    collapseThreshold: 0.5,
    surfaceOpacity: 1,
    wallOpacity: 1,
    wireframe: false,
    detail: false,
    detailStrength: 1,
    inferredStyle: 'hatched',
  },
  argTypes: {
    column: {
      control: 'select',
      options: syntheticColumnKeys,
      table: { category: 'Column' },
    },
    from: {
      control: { type: 'range', min: 0, max: 12, step: 1 },
      description:
        'First unit to draw, counting from the SHALLOWEST. Raise it to start below the unconformity.',
      table: { category: 'Column' },
    },
    count: {
      control: { type: 'range', min: 2, max: 20, step: 1 },
      description:
        'How many units to draw from `from` downward. ⭐ The column itself — its length, grid, structure, seed and erosion encoding — is built from the `COLUMN` constants in `src/storybook/data/synthetic-surfaces.ts`; edit those and reload.',
      table: { category: 'Column' },
    },
    outlineSize: {
      control: { type: 'range', min: 1, max: 10, step: 0.5 },
      description:
        'Side of the square crop, in km. The grids are 10 km across and rotated 220°, so much above 7 km puts the corners outside them.',
      table: { category: 'Column' },
    },
    maxError: {
      control: { type: 'range', min: 0.5, max: 20, step: 0.5 },
      description:
        'Simplification error of the shared tessellation, in metres of height.',
      table: { category: 'Column' },
    },
    contact: {
      control: 'boolean',
      description:
        'Put FLUID CONTACTS inside one unit — an oil/water contact, and optionally a gas cap above it. ⭐ A contact is a LEVEL, not a horizon: `fluid: true` keeps it out of the depth order’s authority chain, so it is clamped into place by the reservoir’s top but never truncates the base below it. Without that flag an ordinary layer here would drag the reservoir’s base down wherever the contact sits deeper than it — an oil column with no water leg — and silently deform real geology.\n\n⚠️ NOT the sea, which is declared once on the `ChunkStack` (see the Water group).',
      table: { category: 'Contacts' },
    },
    contactUnit: {
      control: 'select',
      options: UNIT_NAMES,
      description:
        'The unit the contacts sit in, named by its TOP surface. `Rotliegend` is the deep sand: it lies BELOW the fault, so its top is offset by the throw, and both its boundaries carry real structure (top 2059–2312 m, base 2317–2808 m) — which is what lets both legs pinch out. ⚠️ `Jurassic` is the other sand and is the instructive contrast: its `fill` levels it almost flat (1327–1358 m), so a gas cap there can only ever be a ~30 m sliver. ⚠️ Ignored when the chosen unit is outside the drawn range (see `from` / `count`).',
      table: { category: 'Contacts' },
    },
    gasContact: {
      control: 'boolean',
      description:
        'Add a gas/oil contact above the oil/water one, so the unit holds three legs. ⚠️ The two contacts are NOT ordered against each other — each fluid is measured against the nearest SOLID boundary above it — so the story clamps the gas cap to the OWC itself rather than leaving a crossing the library would not fix.',
      table: { category: 'Contacts' },
    },
    gocDepth: {
      control: { type: 'range', min: 1250, max: 2800, step: 25 },
      description:
        'Gas/oil contact, metres below sea level (POSITIVE-DOWN, as surfaces are given). ⭐ Raise it through the reservoir’s top and the gas leg pinches out over the highs: the contact is clamped onto the top like any boundary, and the leg above it collapses for having no thickness. At the default it stands above ~43% of the Rotliegend.',
      table: { category: 'Contacts' },
    },
    owcDepth: {
      control: { type: 'range', min: 1250, max: 2800, step: 25 },
      description:
        'Oil/water contact, metres below sea level. ⭐ Push it BELOW the reservoir’s base and nothing is deformed: the base stays where the geology put it and the water leg simply pinches out over the crests, which is the whole reason a contact is a fluid. At the default it has no room over ~29% of the Rotliegend — watch `droppedCollapsed` on the OWC row in the console table.',
      table: { category: 'Contacts' },
    },
    contactRelief: {
      control: { type: 'range', min: 0, max: 100, step: 5 },
      description:
        'Amplitude of a dune field on the contacts, in metres. ⚠️ Deliberately unphysical — gravity makes a contact flat — and here only to exercise the relief path on a synthetic layer that is also a fluid.',
      table: { category: 'Contacts' },
    },
    contactColours: {
      control: 'inline-radio',
      options: ['tinted', 'convention'],
      description:
        'How the legs are coloured. `convention` is the industry’s (gas red, oil green, water blue) and is the default because it is the more legible — the three legs separate at a glance. `tinted` mixes those into the host unit’s own colour, so they still read as ONE rock holding several fluids, which is what they are; it is the better statement and the worse demo.',
      table: { category: 'Contacts' },
    },
    floor: {
      control: 'boolean',
      description:
        'Close the block from below with the column’s CARRIER — one flat plane declared on the `ChunkStack`. ⭐ The control does not add or remove the carrier: it adds or removes the `fill` on the LAST layer, which is the only thing that asks for it. A volume there has no next boundary to end on, so the floor ends it; without the fill the block simply stops at its deepest surface.',
      table: { category: 'Floor' },
    },
    floorClearance: {
      control: { type: 'range', min: 50, max: 2000, step: 50 },
      description:
        'Metres below the column’s deepest MAPPED sample. Measured over the whole envelope, and by construction it never truncates anything — use an absolute `depth` instead to cut the block off flat.',
      table: { category: 'Floor' },
    },
    floorColor: {
      control: 'color',
      description:
        'The floor’s own cap material. Declared on the carrier rather than on a layer — the floor is inferred, so it has none. Leave it unset and the floor is drawn with the fill of the unit resting on it.',
      table: { category: 'Floor' },
    },
    water: {
      control: 'boolean',
      description:
        'Put a sea over the column. ⭐ It is declared on the `ChunkStack`, not as a chunk layer: there is ONE sea per column, drawn once however many chunks are cut from it. It takes no part in the depth order, so the unit below it rises THROUGH the plane where it stands above it instead of being flattened onto it.',
      table: { category: 'Water' },
    },
    waterDepth: {
      control: { type: 'range', min: 0, max: 2600, step: 25 },
      description:
        'Sea level, in metres below datum (positive-down, as surfaces are given). 0 is where the sea bed was designed for — it spans roughly 210 m deep to 99 m above sea level, so the coast, the island and its hill all stand clear. Raise it to drown them: the ground is not truncated by the water, it simply goes under.',
      table: { category: 'Water' },
    },
    waterOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'The WATER’s own opacity, looking straight down. ⭐ It is a base, not the final alpha: the shader mixes it toward 1 with the Fresnel term, so the surface is see-through from above and mirror-like at grazing angles whatever this says. 1 = opaque from every angle.',
      table: { category: 'Water' },
    },
    waterLayerOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'Master opacity of the SEA, multiplying whatever the shader arrives at. Leave it at 1 unless the whole sea should fade.',
      table: { category: 'Water' },
    },
    windSpeed: {
      control: { type: 'range', min: 0, max: 25, step: 0.5 },
      description:
        'Wind speed in m/s (U10) — the single physical input to the sea state.',
      table: { category: 'Sea state' },
    },
    windDirection: {
      control: { type: 'range', min: 0, max: 360, step: 5 },
      description: 'Wind direction, in degrees.',
      table: { category: 'Sea state' },
    },
    foamAmount: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Sea state' },
    },
    displacement: {
      control: 'boolean',
      description:
        'Displace the water surface vertices. ⚠️ Needs a lid fine enough to displace — see `waterResolution`; the waves are shaded per pixel either way.',
      table: { category: 'Sea state' },
    },
    waterResolution: {
      control: { type: 'range', min: 0, max: 500, step: 25 },
      description:
        'Target triangle edge for the water lid, in metres. 0 = leave it to the library: the fewest triangles that fill the outline when displacement is off, a default resolution when it is on. ⚠️ A cost knob over the whole footprint — halving it roughly quadruples the lid.',
      table: { category: 'Sea state' },
    },
    bodyFogDensity: {
      control: { type: 'range', min: 0, max: 0.02, step: 0.0005 },
      description:
        'Per-metre tint build-up of the water BODY — the volume seen through the walls of the sea, which stand at the outline rim and at the shoreline.',
      table: { category: 'Water body' },
    },
    bodyMaxOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'Densest tint the body reaches far through the water. Follows `waterOpacity` when the sea leaves it unset.',
      table: { category: 'Water body' },
    },
    bodyShimmer: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'Animated caustic light play in the body, concentrated just under the surface. Footprint-anti-aliased, so it fades out as you zoom to field scale rather than shimmering.',
      table: { category: 'Water body' },
    },
    bedTint: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'Tint the SEA BED toward the water colour, as if seen through the water column — the chunk’s answer to the `Ocean` component’s `seaBedWaterTint`. ⭐ Depth-dependent where that one is flat, because this sea bed is real geology and rises through the water: the tint fades to nothing at the waterline, so the coast and the island stay dry-looking without anything having to know where the shoreline runs.',
      table: { category: 'Water body' },
    },
    bedTintDepth: {
      control: { type: 'range', min: 5, max: 400, step: 5 },
      description:
        'Depth below sea level at which `bedTint` reaches ~86% of its strength, in metres — how tight the gradient at the shoreline is.',
      table: { category: 'Water body' },
    },
    ship: {
      control: 'boolean',
      description:
        'Put an Aframax tanker (253 m) in the sea. Its origin is its own WATERLINE, so it is simply placed at the water plane and follows `waterDepth`. It heaves with the swell and spreads contact foam: the `ChunkStack` provides the same wave sampler and contact registry an `<Ocean>` does.',
      table: { category: 'Ship' },
    },
    shipX: {
      control: { type: 'range', min: -3500, max: 3500, step: 50 },
      description:
        'Position across the field, in metres. ⭐ The default puts it in ~120 m of water: the coast rises toward azimuth 300, so deep water is toward +X/−Z, and this is 2.8 km off the island’s centre. Move it onto the island to see it run aground — nothing stops it.',
      table: { category: 'Ship' },
    },
    shipZ: {
      control: { type: 'range', min: -3500, max: 3500, step: 50 },
      table: { category: 'Ship' },
    },
    shipHeading: {
      control: { type: 'range', min: -180, max: 180, step: 5 },
      description:
        'Heading, in degrees about the scene’s Y axis (0 = bow toward +X). The default lines the hull up with the default wind, so the swell runs bow-on.',
      table: { category: 'Ship' },
    },
    facilities: {
      control: 'boolean',
      description:
        'Put four subsea templates on the sea bed. ⭐ Their sites are given the way real ones are — as UTM easting/northing on a map, with nothing said about depth (`src/storybook/data/subsea-facilities.ts`). Where they end up vertically comes from SAMPLING the sea bed the chunk actually drew, not the grid it was built from: the two differ by up to `maxError`, which is metres.',
      table: { category: 'Facilities' },
    },
    facilityBase: {
      control: 'boolean',
      description:
        '⭐ The comparison this scene exists for. ON, each structure gets a LEVELLED BASE built from the ground under its own footprint — a flat top to stand on, a skirt cut into the bed, and a report of the fill it needed. OFF, the same structure is simply dropped on the slope (`useSurfacePlacement`) and LEANS, which is why the base exists. Watch the console table: `relief` is what the base has to make up.',
      table: { category: 'Facilities' },
    },
    facilitySize: {
      control: { type: 'range', min: 40, max: 300, step: 10 },
      description:
        'Side of the base’s square footprint, in metres. A wider base spans more ground, so it needs more fill — the numbers move with it.',
      table: { category: 'Facilities' },
    },
    baseLevel: {
      control: 'inline-radio',
      options: ['max', 'mean', 'min'],
      description:
        'Which of the ground’s own heights the top is levelled at. `max` is pure FILL — nothing is excavated and the base is a berm thickest on the low side. `min` and `mean` cut into the ground instead, and the report’s `cut` says how much.',
      table: { category: 'Facilities' },
    },
    baseStandoff: {
      control: { type: 'range', min: 0, max: 30, step: 1 },
      description:
        'Raise the levelled top this far above the ground it was derived from, in metres.',
      table: { category: 'Facilities' },
    },
    baseEmbedment: {
      control: { type: 'range', min: 0, max: 20, step: 0.5 },
      description:
        'How far the skirt cuts below the sea bed, in metres. ⚠️ It is what stops a hairline of daylight showing under the base: the base and the sea bed are separate tessellations and agree only to within their own errors.',
      table: { category: 'Facilities' },
    },
    pipelines: {
      control: 'boolean',
      description:
        'Lay flowlines between the sites, and an export line out of the field. ⭐ Same data as the facilities — UTM positions on a map — but sampled ALONG a route: the line is densified, each node dropped onto the drawn sea bed, and the result run through a tube. The console table reports `climb`, the length the ground adds over the route measured on the map.',
      table: { category: 'Pipelines' },
    },
    pipeExaggeration: {
      control: { type: 'range', min: 1, max: 40, step: 1 },
      description:
        'Multiplier on the AS-BUILT diameter — the routes carry the real thing (12¾", 16", 30"). ⚠️ At 1 they are correct and essentially invisible at field scale: a 324 mm line is well under a pixel across 7 km. Raise it to look at them.',
      table: { category: 'Pipelines' },
    },
    pipeSpacing: {
      control: { type: 'range', min: 5, max: 200, step: 5 },
      description:
        'Distance between sampled nodes along the route, in metres. The cost knob: it decides how many times the sea bed is sampled and how finely the line follows it.',
      table: { category: 'Pipelines' },
    },
    pipeSpan: {
      control: { type: 'range', min: 0, max: 400, step: 10 },
      description:
        '⭐ Longest hollow the line bridges, in metres. 0 drapes it over every dip exactly — which is the one shape a stiff pipeline definitely does NOT take. Implemented as a rolling maximum, so it can only ever lift the line: it cannot push it into the ground. `lifted` in the table is how far it did.',
      table: { category: 'Pipelines' },
    },
    pipeSmoothing: {
      control: { type: 'range', min: 0, max: 400, step: 10 },
      description:
        'Rounds off the corners `pipeSpan` leaves, over a window in metres. ⚠️ A shape filter and nothing more — it is clamped back to the ground afterwards, so it cannot sink the line either.',
      table: { category: 'Pipelines' },
    },
    cursor: {
      control: 'boolean',
      description:
        'Follow the pointer across the block with a placeholder. ⭐ Two mechanisms, each answering what the other cannot: GPU picking says WHERE the pointer is (it reads what is actually rendered — a height sampler has no idea where the ray went), and the footprint fit says HOW the object sits there. Turns red where part of it would overhang the drawn surface.\n\n**Left click** leaves a marker, **ctrl+left** flies the camera there, **right click** clears the markers.',
      table: { category: 'Cursor' },
    },
    cursorRadius: {
      control: { type: 'range', min: 20, max: 600, step: 20 },
      description:
        '⭐ Radius of the placeholder, in metres — and of the ring it samples. This is the whole reason a pick is not enough: one point has no orientation, so a disc this wide would have to guess which way to lie. Widen it on the slope below the island and watch it tilt.',
      table: { category: 'Cursor' },
    },
    cursorSamples: {
      control: { type: 'range', min: 3, max: 32, step: 1 },
      description:
        'Points around the ring the plane is fitted to. More follows the ground more faithfully; fewer lets a single bump tip it.',
      table: { category: 'Cursor' },
    },
    cursorFocus: {
      control: 'boolean',
      description:
        '**Ctrl+click** flies the camera to the point under the cursor, as the wellbore examples do. Plain click keeps placing a marker, so the two gestures do not fight. ⚠️ The point is converted back to WORLD space first — the camera knows nothing about the stack’s frame.',
      table: { category: 'Cursor' },
    },
    section: {
      control: 'boolean',
      description:
        'Cut the whole stack with a plane and FILL the cut face per interval, so the block reads as a geological section rather than a hollow shell. ⭐ The face is assembled per PRISM CELL — one filled interval over one triangle of the shared tessellation — which is convex, so a plane cuts it in at most a pentagon. No ring chaining, and watertight by construction.\n\n⚠️ It cuts what the STACK draws — the chunk and, unless `sectionWater` says otherwise, the sea. The tanker, the facilities and the pipelines keep their whole geometry, so expect them to stand over the cut.',
      table: { category: 'Section' },
    },
    sectionMode: {
      control: 'inline-radio',
      options: ['camera', 'fixed'],
      description:
        '⭐ **camera** locks the plane in front of the camera, so ORBITING and DOLLYING are the interaction — no gizmo to grab, and the cut is always square to the view. **fixed** uses the azimuth/dip/distance below instead.',
      table: { category: 'Section' },
    },
    sectionCameraDistance: {
      control: { type: 'range', min: 0, max: 15000, step: 100 },
      description:
        'How far in front of the camera the plane sits, in metres. Everything NEARER than this is cut away, so reducing it drives the cut deeper into the block. `camera` mode only.',
      table: { category: 'Section' },
    },
    sectionVertical: {
      control: 'boolean',
      description:
        '⭐ Keep the camera-locked plane VERTICAL — it takes the camera’s heading and position but never its dip. On by default because a section is conventionally drawn on a vertical plane, and a cut that tilts with the camera makes the block appear to SHEAR as you orbit, which is exactly when the geology stops being readable. Off gives the literal view-aligned cut. ⚠️ `sectionCameraDistance` is then measured horizontally, in plan. `camera` mode only.',
      table: { category: 'Section' },
    },
    sectionAzimuth: {
      control: { type: 'range', min: -180, max: 180, step: 5 },
      description:
        'Swings the plane normal in XZ. The normal points at the half that is REMOVED. `fixed` mode only.',
      table: { category: 'Section' },
    },
    sectionDip: {
      control: { type: 'range', min: -80, max: 80, step: 5 },
      description:
        'Tilts the normal out of horizontal — 0 is a vertical cut, which is what a section is normally drawn on. ⭐ Nothing in the builder prefers vertical; that case is a simplification, not a requirement. `fixed` mode only.',
      table: { category: 'Section' },
    },
    sectionDistance: {
      control: { type: 'range', min: -4000, max: 4000, step: 50 },
      description:
        'How far the plane sits from the origin along the unflipped normal, in metres. `fixed` mode only.',
      table: { category: 'Section' },
    },
    sectionFlip: {
      control: 'boolean',
      description: 'Keep the other half.',
      table: { category: 'Section' },
    },
    sectionAnimate: {
      control: 'boolean',
      description:
        'A fixed tumble on three incommensurate periods (azimuth, dip and distance), so it never repeats and there is nothing to tune — it overrides the three controls above. ⭐ It MUTATES one `Plane` object the stack reads every frame, so it costs no React render and no geometry rebuild; the cut face is rebuilt into preallocated buffers with only the draw range moving. `fixed` mode only.',
      table: { category: 'Section' },
    },
    sectionAnimateSpeed: {
      control: { type: 'range', min: 0, max: 4, step: 0.05 },
      description:
        'Scales the tumble’s clock, so its SHAPE is unchanged at any speed. `fixed` mode only.',
      table: { category: 'Section' },
    },
    sectionWater: {
      control: 'boolean',
      description:
        'Cut the sea too. ⚠️ The water gets no cut FACE — it simply ends at the plane, so you look into an open water body. Turn it off to keep the sea whole over a sliced block, which is usually what you want when the cut is only meant to expose the geology. ⚠️ Changing it rebuilds the two ocean materials (the cut is a shader define).',
      table: { category: 'Section' },
    },
    sectionCarrier: {
      control: 'boolean',
      description:
        'Cut the column’s floor too. Off leaves the block standing on an intact base plate.',
      table: { category: 'Section' },
    },
    sectionKeep: {
      control: { type: 'range', min: -1, max: 19, step: 1 },
      description:
        '⭐ Keep ONE unit whole while the rest is cut away — a slab standing proud of the section. −1 for none.\n\nThe flag is per UNIT, not per surface: setting it keeps the cap, the volume below it AND the cap that FLOORS that volume, the last of which is INFERRED. A unit whose top survives the cut but whose base does not is not a slab, it is a lid over open space — the hollow shell the section exists to avoid.\n\n⚠️ Keep the LAST unit and the column’s floor comes with it, exactly as `sectionCarrier` would.',
      table: { category: 'Section' },
    },
    sectionDebug: {
      control: 'boolean',
      description:
        'Draw where the plane is: its outline through the stack’s bounds — traced against the box, so it shows exactly where the cut meets the block — and a cross at its centre. Always on top, and never an event emitter.',
      table: { category: 'Section' },
    },
    seal: { control: 'boolean', table: { category: 'Resolve' } },
    sealMode: {
      control: 'inline-radio',
      options: ['proportional', 'void'],
      table: { category: 'Resolve' },
    },
    minThickness: {
      control: { type: 'range', min: 0, max: 50, step: 0.5 },
      description:
        'How much of a neighbouring unit a seal must leave standing, in metres. ⚠️ Keep it above `collapseThreshold`.',
      table: { category: 'Resolve' },
    },
    maxFill: {
      control: { type: 'range', min: 0, max: 3000, step: 25 },
      table: { category: 'Resolve' },
    },
    constrainCoverage: {
      control: 'boolean',
      description:
        'Constrain each layer’s DATA boundary into the shared tessellation, so a triangle is either wholly inside a survey or wholly outside it. ⭐ Off, the boundary is only a per-vertex mask and a triangle spanning it has to go one way or the other — which leaves a bite up to a triangle deep, and a comb of slivers where the edge runs at an angle to the mesh. Costs vertices along every partly-mapped layer’s boundary.',
      table: { category: 'Resolve' },
    },
    coverageAbsence: { control: 'boolean', table: { category: 'Resolve' } },
    collapseThreshold: {
      control: { type: 'range', min: 0, max: 5, step: 0.5 },
      description:
        'Thickness below which a unit counts as absent — what turns the generated pinch-outs into terminations.',
      table: { category: 'Resolve' },
    },
    surfaceOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Appearance' },
    },
    peel: {
      control: { type: 'range', min: 0, max: 19, step: 1 },
      description:
        '⭐ Hide the first N UNITS, exposing what is under them. Exact and free, unlike lowering the opacity: alpha compounds, so a 20-layer stack at 0.5 is effectively opaque and a transparency slider cannot answer “what is underneath”. The layer array IS the depth order, so not drawing a PREFIX of it is exact — which is why this is a count and not a per-layer flag: an arbitrary set can open the block, a prefix cannot.\n\n⚠️ It removes each unit’s cap AND its volume, but keeps the cap of the first survivor, which is that unit’s own top — so the floor was never yours to drop and the block stays closed.',
      table: { category: 'Appearance' },
    },
    wallOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      table: { category: 'Appearance' },
    },
    wireframe: { control: 'boolean', table: { category: 'Appearance' } },
    detail: {
      control: 'boolean',
      description:
        'Procedural surface relief, with each unit taking the preset named after its SEDIMENT CLASS. ⭐ That mapping is the story’s, not the library’s — the presets exist, but which unit is sand is host knowledge, exactly like colour. Anchored in world space, so it needs no per-surface repeat/scale and only resolves as the camera comes in.',
      table: { category: 'Appearance' },
    },
    detailStrength: {
      control: { type: 'range', min: 0, max: 3, step: 0.1 },
      description: 'Scales every detail preset. 1 = as designed.',
      table: { category: 'Appearance' },
    },
    inferredStyle: {
      control: 'select',
      options: ['none', 'hatched', 'checker', 'zigzag'],
      description:
        'How the INVENTED part of the block is marked. ⭐ The column’s unconformity records its truncated horizons as NO DATA, so the seal reconstructs them — the marking is what tells that reconstruction apart from the units that were really deposited.',
      table: { category: 'Appearance' },
    },
  },
  decorators: [
    EventEmitterDecorator,
    GlyphsDecorator,
    Canvas3dDecorator,
    GeneratorsProviderDecorator,
    DataProviderDecorator,
  ],
};
