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
import { chunkTimings } from '../../storybook/data/chunk-timings';
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
import {
  ChunkLayer,
  ChunkResolveOptions,
  StackImmersion,
  StackWater,
} from './chunk-defs';
import { ChunkContact } from './chunk-contacts';
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

/** The industry's fluid colours — the default the library also ships. */
const CONTACT_DEFS = [
  { id: 'goc', type: 'goc' as const, surfaceId: 'synthetic:contact-goc' },
  { id: 'owc', type: 'owc' as const, surfaceId: 'synthetic:contact-owc' },
];

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
  gasContact: boolean;
  contactWidth: number;
  contactWidthSpace: 'screen' | 'world';
  contactDash: number;
  contactGap: number;
  floor: boolean;
  floorClearance: number;
  floorColor: string;
  water: boolean;
  seaLevel: number;
  waterOpacity: number;
  waterLayerOpacity: number;
  windSpeed: number;
  windDirection: number;
  foamAmount: number;
  displacement: boolean;
  waterResolution: number;
  shoalDepth: number;
  shoalOpacity: number;
  shoreFoam: number;
  shoreBreakDepth: number;
  surfScale: number;
  shoreFoamStrength: number;
  shoreFoamFade: number;
  shoreNoise: number;
  shoreNoiseScale: number;
  swash: number;
  wetBand: number;
  wetStrength: number;
  bodyFogDensity: number;
  bodyMaxOpacity: number;
  bodyShimmer: number;
  immersion: boolean;
  immersionColor: string;
  immersionVisibility: number;
  immersionTransition: number;
  immersionSettle: number;
  immersionBackground: boolean;
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
  sectionMode: 'fixed' | 'camera' | 'target';
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
          position={[props.shipX, -props.seaLevel, props.shipZ]}
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

  // Contacts are ordinary depth grids, fetched like any other surface — they are
  // NOT part of `surfaces`, so they take no part in the depth order.
  const [contactMetas, setContactMetas] = useState<Record<string, SurfaceMeta>>(
    {},
  );
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    (async () => {
      const found = await Promise.all(
        CONTACT_DEFS.map(async d => {
          const meta = await store.get<SurfaceMeta>(
            'surface-meta',
            d.surfaceId,
          );
          return [d.id, meta] as const;
        }),
      );
      if (cancelled) return;
      setContactMetas(
        Object.fromEntries(found.filter(([, m]) => !!m)) as Record<
          string,
          SurfaceMeta
        >,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [store]);

  const contacts = useMemo<ChunkContact[] | undefined>(() => {
    if (!props.contact) return undefined;
    const built = CONTACT_DEFS.filter(
      d => d.id !== 'goc' || props.gasContact,
    ).flatMap(d => {
      const surface = contactMetas[d.id];
      if (!surface) return [];
      return [
        {
          id: d.id,
          surface,
          type: d.type,
          width: props.contactWidth,
          widthSpace: props.contactWidthSpace,
          dash:
            props.contactDash > 0
              ? ([props.contactDash, props.contactGap] as Vec2)
              : undefined,
        },
      ];
    });
    return built.length ? built : undefined;
  }, [
    props.contact,
    props.gasContact,
    props.contactWidth,
    props.contactWidthSpace,
    props.contactDash,
    props.contactGap,
    contactMetas,
  ]);

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
  ]);

  // The sea is the COLUMN's, not a chunk layer: one lid over the whole stack,
  // drawn once however many chunks are cut from it.
  const water = useMemo<StackWater | undefined>(() => {
    if (!props.water) return undefined;
    const angle = (props.windDirection * Math.PI) / 180;
    return {
      depth: props.seaLevel,
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
      shoalDepth: props.shoalDepth,
      shoalOpacity: props.shoalOpacity,
      shoreFoam: props.shoreFoam,
      shoreBreakDepth: props.shoreBreakDepth,
      surfScale: props.surfScale,
      shoreFoamStrength: props.shoreFoamStrength,
      shoreFoamFade: props.shoreFoamFade,
      shoreNoise: props.shoreNoise,
      shoreNoiseScale: props.shoreNoiseScale,
      swash: props.swash,
      bedTint: props.bedTint,
      bedTintDepth: props.bedTintDepth,
      wetBand: props.wetBand,
      wetStrength: props.wetStrength,
    };
  }, [
    props.water,
    props.seaLevel,
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
    props.shoalDepth,
    props.shoalOpacity,
    props.shoreFoam,
    props.shoreBreakDepth,
    props.surfScale,
    props.shoreFoamStrength,
    props.shoreFoamFade,
    props.shoreNoise,
    props.shoreNoiseScale,
    props.swash,
    props.bedTint,
    props.bedTintDepth,
    props.wetBand,
    props.wetStrength,
  ]);

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
          ...chunkTimings(metrics),
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
      lockToTarget: props.sectionMode === 'target',
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
          immersion={immersion}
          contacts={contacts}
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
          '⭐ The column carries **fluid contacts** — a GOC at ~2200 m and an OWC at ~2600 m — drawn as LINES rather than as coloured volumes. A contact is an ordinary depth grid (mostly flat, same conventions as a horizon) but it is deliberately NOT a stack layer: it takes no part in the depth order, so it can neither truncate a horizon nor be truncated by one, and it carves the rock into nothing. It is drawn per FRAGMENT wherever the geometry’s own height crosses the contact’s grid, so ONE test gives both the accumulation outline on a cap and the horizontal line on a section face or a wall — note how the lines run dead flat across the dipping strata. ⭐ Being pure shading, swapping a contact rebuilds no geometry at all. See the Contacts group.\n\n' +
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
    gasContact: true,
    contactWidth: 2,
    contactWidthSpace: 'screen',
    contactDash: 0,
    contactGap: 6,
    floor: true,
    floorClearance: 400,
    floorColor: '#6b6b6b',
    water: true,
    seaLevel: 0,
    waterOpacity: 0.7,
    waterLayerOpacity: 1,
    windSpeed: 10,
    windDirection: 30,
    foamAmount: 0.5,
    displacement: false,
    waterResolution: 0,
    shoalDepth: 25,
    shoalOpacity: 0,
    shoreFoam: 0.8,
    shoreBreakDepth: 1.3,
    surfScale: 1,
    shoreFoamStrength: 0.65,
    shoreFoamFade: 0.3,
    shoreNoise: 1.5,
    shoreNoiseScale: 200,
    swash: 1,
    wetBand: 3,
    wetStrength: 0.4,
    bodyFogDensity: 0.004,
    bodyMaxOpacity: 0.9,
    bodyShimmer: 0.5,
    immersion: false,
    immersionColor: '#0b0a08',
    immersionVisibility: 400,
    immersionTransition: 5,
    immersionSettle: 0.12,
    immersionBackground: true,
    bedTint: 0.6,
    bedTintDepth: 80,
    ship: true,
    shipX: 2200,
    shipZ: 1800,
    shipHeading: -30,
    facilities: true,
    facilityBase: true,
    facilitySize: 40,
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
      description:
        'Which generated column to draw. Both are the same section; they differ in the sea bed over it — `shoreline` climbs out of the water into a coast, an island and a hill, `offshore` has no land at all and shoals only to shelf depth.',
      table: { category: 'Column' },
    },
    from: {
      control: { type: 'select' },
      options: [0, 2, 4, 6, 8, 10, 12, 15, 18],
      description:
        'First unit to draw, counting from the SHALLOWEST. Raise it to start below the unconformity.',
      table: { category: 'Column' },
    },
    count: {
      control: { type: 'select' },
      options: [1, 2, 4, 6, 8, 12, 16, 20, 30],
      description:
        'How many units to draw from `from` downward. ⭐ The column itself — its length, grid, structure, seed and erosion encoding — is built from the `COLUMN` constants in `src/storybook/data/synthetic-surfaces.ts`; edit those and reload.',
      table: { category: 'Column' },
    },
    outlineSize: {
      control: { type: 'select' },
      options: [1, 3, 5, 7, 9, 10],
      description:
        'Side of the square crop, in km. The grids are 10 km across and rotated 220°, so much above 7 km puts the corners outside them.',
      table: { category: 'Column' },
    },
    maxError: {
      control: { type: 'select' },
      options: [1, 2, 5, 10, 25, 50],
      description:
        'Simplification error of the shared tessellation, in metres of height.',
      table: { category: 'Column' },
    },
    contact: {
      control: 'boolean',
      description:
        'Draw FLUID CONTACTS as lines. ⭐ A contact is an ordinary depth grid — mostly flat, same conventions as a horizon — but it is deliberately NOT a stack layer: it takes no part in the depth order, so it can neither truncate a horizon nor be truncated by one, and it carves the rock into nothing. It is drawn per FRAGMENT, wherever the geometry’s own height crosses the contact’s grid.\n\n⭐⭐ One test covers every view: on the reservoir cap the line is the ACCUMULATION OUTLINE (the closed contour where the flat contact meets the domed top), and on a section face or a wall it is the familiar horizontal contact line. Turn `section` on to see the second.\n\n⭐ Because it is pure shading, changing a contact rebuilds NO geometry — which is what makes sweeping many realisations affordable.\n\n⚠️ Drawn on every unit unless the host says otherwise (`ChunkLayer.contacts`), so it will also cross rock that holds no fluid. Restricting it to a unit is interpretation, and the library will not invent it.',
      table: { category: 'Contacts' },
    },
    gasContact: {
      control: 'boolean',
      description:
        'Also draw the gas/oil contact at ~2200 m, above the oil/water contact at ~2600 m.',
      table: { category: 'Contacts' },
    },
    contactWidth: {
      control: { type: 'range', min: 0.5, max: 20, step: 0.5 },
      description:
        'Line width, in PIXELS or in METRES depending on `contactWidthSpace`.',
      table: { category: 'Contacts' },
    },
    contactWidthSpace: {
      control: 'inline-radio',
      options: ['screen', 'world'],
      description:
        '`screen` keeps the line a constant width on screen at any zoom — the right default for an annotation, and what makes it legible across a 7 km field. `world` measures it in metres, so it thins out as you zoom away and reads as a physical band.',
      table: { category: 'Contacts' },
    },
    contactDash: {
      control: { type: 'range', min: 0, max: 40, step: 1 },
      description:
        'Dash length in pixels; 0 for a solid line. ⚠️ Best-effort: the line is an implicit contour with no arc length, so the dash is stepped along the line in SCREEN space (from the gradient direction). It degrades where the line turns within a pixel or runs nearly edge-on.',
      table: { category: 'Contacts' },
    },
    contactGap: {
      control: { type: 'range', min: 1, max: 40, step: 1 },
      description: 'Gap between dashes, in pixels.',
      table: { category: 'Contacts' },
    },
    floor: {
      control: 'boolean',
      description:
        'Close the block from below with the column’s CARRIER — one flat plane declared on the `ChunkStack`. ⭐ The control does not add or remove the carrier: it adds or removes the `fill` on the LAST layer, which is the only thing that asks for it. A volume there has no next boundary to end on, so the floor ends it; without the fill the block simply stops at its deepest surface.',
      table: { category: 'Floor' },
    },
    floorClearance: {
      control: { type: 'select' },
      options: [0, 100, 200, 400, 800, 1500, 3000],
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
    seaLevel: {
      control: { type: 'select' },
      options: [-200, -100, -50, 0, 50, 100, 200],
      description:
        'Sea level, in metres below datum (positive-down, as surfaces are given). 0 is where the sea bed was designed for — it spans roughly 210 m deep to 99 m above sea level, so the coast, the island and its hill all stand clear. Raise it to drown them: the ground is not truncated by the water, it simply goes under. ⚠️ This is the sea SURFACE, not a water depth.',
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
      control: { type: 'select' },
      options: [0, 50, 100, 200, 400],
      description:
        'Target triangle edge for the water lid, in metres. 0 = leave it to the library: the fewest triangles that fill the outline when displacement is off, a default resolution when it is on. ⚠️ A cost knob over the whole footprint — halving it roughly quadruples the lid.',
      table: { category: 'Sea state' },
    },
    shoalDepth: {
      control: { type: 'range', min: 1, max: 200, step: 1 },
      description:
        'Water depth at which the sea reaches ~86% of its full colour and opacity, in metres. ⭐ The shader had NO depth input before the bathymetry texture and used the VIEW ANGLE as a stand-in — which cannot tell a metre of water over a bank from the open sea. This replaces the proxy with the real thing, so a shoal reads as a shoal from any angle.',
      table: { category: 'Shore' },
    },
    shoalOpacity: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'What is left of `waterOpacity` where the bed reaches the surface. 0 = water with no depth is fully clear and only the Fresnel reflection remains.',
      table: { category: 'Shore' },
    },
    shoreFoam: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'Surf where the waves break on the shore. ⭐ Folded into the SAME foam coverage as the whitecaps, so it picks up their noise, froth and distance fade rather than reading as a different kind of foam. ⭐ The profile peaks AT THE BREAK LINE and decays inshore — foam is generated where waves break and washes shoreward while dying — so the bright line stands offshore and the water’s edge is the dim end. Also modulated by exposure (a lee shore barely breaks) and by slow sets. ⚠️⚠️ Keyed on water DEPTH, never on the water body’s boundary: most of that boundary is the outline CROP, and surf along an arbitrary crop edge would be a confident lie.',
      table: { category: 'Shore' },
    },
    shoreBreakDepth: {
      control: { type: 'range', min: 0.5, max: 4, step: 0.1 },
      description:
        'Depth at which waves break, as a MULTIPLE OF THE WAVE HEIGHT — 1.3 is the measured breaking criterion. ⭐ So the surf zone widens and narrows with the sea state: a thin line in a calm, a wide belt in a storm. A fixed band was the most unphysical thing here, with the whole sea offshore responding to the wind and the shore not. ⚠️ The height is floored internally to stand in for background swell, so an open coast still breaks at wind 0.',
      table: { category: 'Shore' },
    },
    surfScale: {
      control: { type: 'range', min: 1, max: 20, step: 0.5 },
      description:
        'Exaggeration of the surf zone’s WIDTH. ⚠️ Default 1 = as measured. A realistic surf zone is a handful of pixels at field scale, so this is the same escape hatch as `pipeExaggeration` — and it costs the same thing: a correctly-sized shore is one of the cues that tells you how far away you are, and exaggerating it takes that away.',
      table: { category: 'Shore' },
    },
    shoreFoamStrength: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'How white the shore foam is drawn. 0 removes it entirely — colour AND opacity, so the water reads exactly as it would with no foam at all. ⚠️ Distinct from `shoreFoam`, which decides how much of the band is COVERED and so breaks it up against the foam noise; this one dims the whole band evenly.',
      table: { category: 'Shore' },
    },
    shoreFoamFade: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'Fraction of `shoreFoamStrength` lost once the foam detail goes sub-pixel — what softens the band as you zoom out. ⚠️ The band’s own analytic anti-aliasing does NOT do this: it only engages once the band is sub-pixel, and a band measured in metres of DEPTH is still hundreds of metres across on a gentle shelf.',
      table: { category: 'Shore' },
    },
    shoreNoise: {
      control: { type: 'range', min: 0, max: 6, step: 0.1 },
      description:
        'How ragged the foam’s landward edge is, in metres of water depth. 0 makes it follow the bathymetry contour exactly, which reads as unnaturally crisp. ⚠️ It perturbs the FOAM band only, not the water’s depth — perturbing that would make the transparency and colour ripple with it. ⚠️ Drifts slowly on its own rather than with the wind: a coastline’s raggedness belongs to the shore, so it must not stream downwind.',
      table: { category: 'Shore' },
    },
    shoreNoiseScale: {
      control: { type: 'range', min: 25, max: 1000, step: 25 },
      description:
        'Feature size of that raggedness, in metres. ⚠️ Footprint-faded, so it flattens out once it goes sub-pixel instead of speckling.',
      table: { category: 'Shore' },
    },
    swash: {
      control: { type: 'range', min: 0, max: 4, step: 0.1 },
      description:
        'How far the swell carries the waterline up and down the shore, as a multiple of the local wave height. ⭐ It offsets the LEVEL by this fragment’s own wave height, so the shore advances and retreats — varied along the coast, and with no clock of its own. 0 pins it to the still level.',
      table: { category: 'Shore' },
    },
    wetBand: {
      control: { type: 'range', min: 0, max: 30, step: 0.5 },
      description:
        'Depth of the WET band just below the waterline, in metres. 0 = off. Wet ground is darker, which is what stops the shore reading as a hard colour boundary between dry land and tinted bed. ⚠️ On the bed’s CAP only, the same scope as `bedTint`.',
      table: { category: 'Shore' },
    },
    wetStrength: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description: 'How much `wetBand` darkens the ground.',
      table: { category: 'Shore' },
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
    immersion: {
      control: 'boolean',
      description:
        'Fog the scene while the camera is INSIDE the sea or the block. ⭐ Both are made of SURFACES, not of a medium: from outside every sightline crosses one and picks up its attenuation, and from inside there is nothing in the path at all, so the view is impossibly clear. Fog attenuates by distance from the CAMERA — the quantity that matters there — and reaches the ship, the facilities and the pipelines, which no material of ours could. ⚠️ OFF by default and it has to be: installing `scene.fog` at all changes every material’s program cache key, so there is no free "disabled" state. Absent, nothing subscribes to the frame loop and no shader differs. ⚠️ Sets `scene.fog` and `scene.background`, restoring both on unmount.',
      table: { category: 'Immersion' },
    },
    immersionColor: {
      control: 'color',
      description:
        'Colour inside the BLOCK (the sea uses its own `deepColor`). ⚠️ One colour for the whole block, not per unit: the fills live in the appearance layer and the stack does not know them.',
      table: { category: 'Immersion' },
    },
    immersionVisibility: {
      control: { type: 'range', min: 25, max: 2000, step: 25 },
      description:
        'Roughly how far you can see inside the block, in metres. ⭐ The point of the effect is a positional CUE — telling you that you have flown the camera into the ground — not occlusion, so dimming that still leaves wellbores readable beats the blackout realism would ask for. ⚠️ `FogExp2` saturates QUADRATICALLY (`exp(-(d / visibility)²)`): ~63% fogged at this distance, ~98% at twice it. Three offers no way to bound fog short of patching every shader, so this is the only control over how much you can see. ⚠️ The sea uses `bodyFogDensity` instead, because that one has to agree with the water body’s wall shader.',
      table: { category: 'Immersion' },
    },
    immersionTransition: {
      control: { type: 'range', min: 0, max: 50, step: 1 },
      description:
        'Metres over which the fog fades in at a medium’s boundary — the water surface, the sea bed, the top of the block.',
      table: { category: 'Immersion' },
    },
    immersionSettle: {
      control: { type: 'range', min: 0, max: 1, step: 0.02 },
      description:
        'Seconds for the fog to catch up with a step change. ⚠️ Needed because a medium’s own boundaries ramp smoothly but leaving one SIDEWAYS — past the edge of the drawn footprint, or through a section plane — has no distance to ramp over. Keep it short: this is a cue, and a slow one reads as a bug.',
      table: { category: 'Immersion' },
    },
    immersionBackground: {
      control: 'boolean',
      description:
        'Take the scene background to the medium’s colour too. ⚠️ Fogged geometry against an unfogged background is the classic mismatch, and it is worse on a BRIGHT background than a dark one: the fog reads as a haze hanging in the room rather than as a medium. Off means setting your background yourself. ⚠️ Interpolated where the host’s background is a colour, swapped where it is a texture or cube map — those cannot be blended.',
      table: { category: 'Immersion' },
    },
    bedTint: {
      control: { type: 'range', min: 0, max: 1, step: 0.05 },
      description:
        'Tint the SEA BED toward the water colour, as if seen through the water column — the chunk’s answer to the `Ocean` component’s `seaBedWaterTint`. ⭐ Depth-dependent where that one is flat, because this sea bed is real geology and rises through the water: the tint fades to nothing at the waterline, so the coast and the island stay dry-looking without anything having to know where the shoreline runs.',
      table: { category: 'Sea bed' },
    },
    bedTintDepth: {
      control: { type: 'range', min: 5, max: 400, step: 5 },
      description:
        'Depth below sea level at which `bedTint` reaches ~86% of its strength, in metres — how tight the gradient at the shoreline is. ⚠️ Beer-Lambert saturates: at 80 anything below ~250 m is already past 95%, so on a deep bed the whole cap reads uniform and the gradient is spent around the coast. Raise it to see depth across the whole bed.',
      table: { category: 'Sea bed' },
    },
    ship: {
      control: 'boolean',
      description:
        'Put an Aframax tanker (253 m) in the sea. Its origin is its own WATERLINE, so it is simply placed at the water plane and follows `seaLevel`. It heaves with the swell and spreads contact foam: the `ChunkStack` provides the same wave sampler and contact registry an `<Ocean>` does.',
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
      control: { type: 'range', min: 20, max: 300, step: 10 },
      description:
        'Side of the base’s square footprint, in metres. A wider base spans more ground, so it needs more fill — the numbers move with it. ⚠️ The default 40 m is roughly a real four-slot subsea template, so it is comparable with the pipelines only at `pipeExaggeration` 1, where those carry their as-built diameters — which is why they are all but invisible beside it.',
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
      options: ['camera', 'target', 'fixed'],
      description:
        '⭐ **camera** locks the plane in front of the camera, so ORBITING and DOLLYING are the interaction — no gizmo to grab, and the cut is always square to the view. **target** anchors the same plane on the camera TARGET, so orbiting still swings the cut but zooming no longer drives it through the block — fly to a point and the cut lands on it, then come in close to read the face. **fixed** uses the azimuth/dip/distance below instead.',
      table: { category: 'Section' },
    },
    sectionCameraDistance: {
      control: { type: 'range', min: 0, max: 15000, step: 100 },
      description:
        'How far in front of the camera the plane sits, in metres. Everything NEARER than this is cut away, so reducing it drives the cut deeper into the block. `camera` mode only — `target` takes its position from the pivot and has no distance to set.',
      table: { category: 'Section' },
    },
    sectionVertical: {
      control: 'boolean',
      description:
        '⭐ Keep the camera-locked plane VERTICAL — it takes the camera’s heading but never its dip. On by default because a section is conventionally drawn on a vertical plane, and a cut that tilts with the camera makes the block appear to SHEAR as you orbit, which is exactly when the geology stops being readable. Off gives the literal view-aligned cut. ⚠️ `sectionCameraDistance` is then measured horizontally, in plan; in `target` mode the plane stands vertically ON the pivot. `camera` and `target` modes only.',
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
        'Cut the sea too. ⭐ The water body is CLOSED by a face of its own, built over the sea’s level and bed the way the block’s face is built over its layers. Off (the library default) keeps the sea whole over a sliced block, which frames it — usually what you want when the cut is only meant to expose the geology. ⚠️ Changing it rebuilds the two ocean materials (the cut is a shader define).',
      table: { category: 'Section' },
    },
    sectionCarrier: {
      control: 'boolean',
      description:
        'Cut the column’s floor too. Off (the library default) leaves the block standing on an intact base plate.',
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
      control: { type: 'select' },
      options: [0.5, 1, 2, 5, 10, 20],
      description:
        'How much of a neighbouring unit a seal must leave standing, in metres. ⚠️ Keep it above `collapseThreshold`.',
      table: { category: 'Resolve' },
    },
    maxFill: {
      control: { type: 'select' },
      options: [0, 100, 250, 500, 1000, 2000],
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
      control: { type: 'select' },
      options: [0, 0.25, 0.5, 1, 2, 5],
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
