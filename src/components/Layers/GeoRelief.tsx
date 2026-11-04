import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Group } from 'three';
import type { ReliefLayer } from '../../sdk/geometries/relief-tiles';
import type { ProgressReport } from '../Progress/progress-store';
import {
  ReliefColor,
  ReliefContours,
  ReliefLook,
  resolveReliefContourLabels,
  resolveReliefContours,
} from '../Scenery/scenery-relief-look';
import { useReliefLooks } from '../Scenery/useReliefLooks';
import type { ReliefSampler } from '../Scenery/scenery-relief-sampler';
import type { SceneryReliefTileDebug } from '../Scenery/scenery-relief-tiles';
import {
  createReliefProgress,
  RELIEF_PROGRESS_LABELS,
  ReliefProgressLabels,
} from '../Scenery/scenery-progress';
import { sceneryDefaults } from '../Scenery/scenery-model';
import {
  SceneryStageReliefTiles,
  SceneryReliefTileStats,
} from '../Scenery/SceneryStageReliefTiles';
import { useWorld } from '../World/world-context';
import { useWorldFields } from '../World/world-fields';
import { useWorldRelief } from '../World/world-relief';
import {
  GeoReliefContourLabels,
  type ReliefContourLabelLook,
} from './GeoReliefContourLabels';

/**
 * GeoRelief props
 * @expand
 */
export type GeoReliefProps = {
  /**
   * The reliefs in the store — `relief-meta` records (`ReliefMeta`) and their
   * `relief-values` — coarse to fine: later ones win where they have data. Merged onto tiles
   * by the `sceneryReliefTile` generator, so it needs a `GeneratorsProvider`; any number, of
   * any size: only the tiles in view are read. Where the ground in view reaches past the
   * camera's far plane, the same tiles, coarser, are also drawn past it as an overview, from
   * anywhere on the Earth; a layer in longitude and latitude all the way round (a world
   * relief) covers it everywhere.
   */
  layers: ReliefLayer[];
  /**
   * the flat seabed where no layer has data, metres below the sea. Default the sea's depth:
   * the last a `Scenery` gave, `sceneryDefaults.ocean.depth` until one does. A change loads
   * every tile again: give it to keep them as a `Scenery` with another depth comes in
   */
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
  /**
   * ms a swap between levels of detail takes: each tile blends from the one it replaces —
   * its heights (a geomorph), its slopes and its colour — instead of popping, and children
   * merging back into their parent blend toward it first. Not over the ground handed to a
   * column, which must meet what is drawn exactly. 0 swaps at once. Default 300
   */
  transition?: number;
  /**
   * How the land and seabed are coloured: one colour for the land, the seabed taking the
   * sea's; or by height through a colour ramp — a terrain ramp, or any other, such as
   * `'rainbow'` — over a range of heights, the seabed the sea's, the same ramp, or a ramp of
   * its own (see {@link ReliefColorRamp}). `'ramp'` is `{ ramp: 'terrain' }`. Changing it
   * builds nothing again. Default `#34433b`, a dark green-grey
   */
  color?: ReliefColor;
  /**
   * contour lines over it (see {@link ReliefContours}); `true` for the defaults. With
   * `labels`, their heights written along them on the ground. Default none
   */
  contours?: boolean | ReliefContours;
  /**
   * a look of its own for a layer, by its id: its `color` and `contours` where it gave the
   * ground, over the relief's (a local survey by a rainbow and 10 m contours, say). Where
   * layers overlap, the ground is the one that gave most of it, node by node.
   */
  layerLooks?: Record<string, ReliefLook>;
  /** draw it. Default true: hidden, its tiles stay in */
  visible?: boolean;
  /**
   * Without a `Scenery`, how much of what lies beneath the relief it hides, everywhere, 0 to
   * 1: below 1 all of it is drawn see-through. With one, the sky decides. Default 1
   */
  opacity?: number;
  /**
   * Without a `Scenery`, the same over the fields — the anchored stage's area (the `World`'s
   * `boundary`) and each field loaded in the `World` (a `UtmArea` with a `boundary`), in its
   * own frame, each of its own shape — so the data under the seabed there shows through it:
   * the lower of this and `opacity` there. With one, the sea's `seabedOpacity` decides, over
   * the same. Default 1
   */
  fieldOpacity?: number;
  /**
   * Without a `Scenery`, draw the land: the ground at or above the sea's level. With one, the
   * sky decides. A change recompiles its material. Default true
   */
  land?: boolean;
  /**
   * Without a `Scenery`, draw the seabed: the ground below the sea's level. With one, the sky
   * decides. A change recompiles its material. Default true
   */
  seabed?: boolean;
  /**
   * `'tiles'` tints each tile by its depth and outlines it; `'layers'` colours each node by
   * the layer that gave it (grey for the flat base). Recompiles its material
   */
  debug?: SceneryReliefTileDebug;
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
   * Told how its tiles load whenever that changes, for a progress display (see
   * `ProgressStore.source`): a run from when one is waited for until none is; once more with
   * no items when it goes away.
   */
  onProgress?: (report: ProgressReport) => void;
  /** the texts of its progress (see {@link RELIEF_PROGRESS_LABELS}) */
  progressLabels?: Partial<ReliefProgressLabels>;
};

/**
 * Land and seabed from the store, drawn from tiles: Earth data, as the geographic layers are,
 * placed on the enclosing `World`'s globe by latitude and longitude. Its layers are merged —
 * global, regional, local — as fine as the data where the camera is and no finer anywhere
 * else, covering everything out to the horizon. See `documents/relief.md`.
 *
 * Place it anywhere inside a `World`, beside the `Scenery` or in it. With a `Scenery` and its
 * sea it is drawn with the sky: land where it rises above the sea, lit and fading into the
 * air as the far sea does, and seabed below it, seen through the water; from under it, the
 * void's lid; past the camera's far plane, an overview out to the horizon. A `SceneryStage`
 * then has it for its seabed, the ground its occupants are built on (`onGround`). Over the
 * fields — the anchored stage's area and each field loaded in the `World` (a `UtmArea` with
 * a `boundary`) — it is see-through at the sea's seabed opacity. Without a `Scenery` it is drawn
 * plainly: its looks lit by the scene's lights, out to the far plane, nothing of it from under
 * the ground, at its own `opacity` (and `fieldOpacity` over the fields), its `land` and
 * `seabed` each as asked. Its tiles stay in as the `Scenery` comes and goes, and through a
 * `Suspense`. Layers inside the `World` lie on what it draws (`drape`).
 *
 * One `GeoRelief` with layers to a `World`.
 *
 * @example
 * <World frame={frame} boundary={boundary}>
 *   <Scenery>
 *     <SceneryOcean level={0} depth={120} />
 *     <SceneryStage />
 *   </Scenery>
 *   <GeoRelief
 *     layers={[{ id: 'etopo-2022-nordic' }, { id: 'my-survey', feather: 500 }]}
 *     color={{ ramp: 'terrain' }}
 *   />
 * </World>
 *
 * @group Components
 */
export const GeoRelief = ({
  layers,
  depth,
  pixelError = 2,
  cellPixels = 8,
  transition = 300,
  color,
  contours,
  layerLooks,
  visible = true,
  opacity = 1,
  fieldOpacity = 1,
  land = true,
  seabed = true,
  debug,
  onStats,
  onSampler,
  onProgress,
  progressLabels,
}: GeoReliefProps) => {
  const world = useWorld();
  const relief = useWorldRelief();
  // The fields loaded in the World: it is see-through over each, as over the anchored stage.
  const fields = useWorldFields()?.fields;
  const far = useThree(state => state.camera.far);
  const hasLayers = layers.length > 0;

  useEffect(() => {
    if (!world)
      console.warn(
        'GeoRelief draws nothing outside a <World>: it says where the relief lies on the Earth',
      );
  }, [world]);

  // Its looks, and its layers', as its shaders read them: a texture, so a change of colour or
  // contours is an upload, never a new program. Compared by value.
  const idsKey = JSON.stringify(layers.map(layer => layer.id));
  const layerIds = useMemo(() => JSON.parse(idsKey) as string[], [idsKey]);
  const { looks, key: lookKey } = useReliefLooks(
    { color, contours, layerLooks },
    layerIds,
  );

  // What each look's contour labels label (`ReliefContours.labels`): by its place in the
  // looks, as its tiles mark their nodes — the relief's, then each layer's (its own look's
  // contours, else the relief's).
  const contourLabels = useMemo(() => {
    const [, base, own, ids] = JSON.parse(lookKey) as [
      unknown,
      boolean | ReliefContours | null,
      Record<string, ReliefLook> | null,
      string[],
    ];
    const resolve = (
      given: boolean | ReliefContours | null | undefined,
    ): ReliefContourLabelLook | null => {
      const lines = resolveReliefContours(given ?? undefined);
      const labels = resolveReliefContourLabels(lines);
      if (!lines || !labels) return null;
      const major = labels.lines === 'major' && lines.major > 1;
      return {
        step: lines.interval * (major ? lines.major : 1),
        seabed: lines.seabed,
        labels,
      };
    };
    const first = resolve(base);
    return [
      first,
      ...ids.map(id => {
        const look = own?.[id];
        return look && look.contours !== undefined
          ? resolve(look.contours)
          : first;
      }),
    ];
  }, [lookKey]);
  const labelled = contourLabels.some(Boolean);

  // The World knows it is there: a stage draws no seabed of its own, and lies on it.
  const addRelief = relief?.addRelief;
  useLayoutEffect(
    () => (hasLayers ? addRelief?.() : undefined),
    [addRelief, hasLayers],
  );

  // How its tiles load, for a progress display.
  const reportRef = useRef(onProgress);
  const labelsRef = useRef(progressLabels);
  useEffect(() => {
    reportRef.current = onProgress;
    labelsRef.current = progressLabels;
  });
  const [progress] = useState(() =>
    createReliefProgress(
      report => reportRef.current?.(report),
      () => ({ ...RELIEF_PROGRESS_LABELS, ...labelsRef.current }),
    ),
  );
  // Told again on mounting: a remount (React's strict mode) follows a report of none.
  useEffect(() => {
    progress.emit();
    return () => progress.close();
  }, [progress]);

  // Mounted whenever it has layers in a World, so its tiles stay in as the sky comes and
  // goes, and through a Suspense, which tears down layout effects (the World's knowing it
  // is there among them) while what suspended loads. Drawn once the World knows it is there,
  // as a stage then turns to it in the same render: what both compile with changes once.
  // With a sky, by it, and only where the sea has a seabed (without one the void lies below
  // the water); without one, plainly, its land and seabed as asked.
  const sky = relief?.sky ?? null;
  const stage = relief?.stage ?? null;
  const mounted = !!world && hasLayers && !!relief;
  const drawn = mounted && !!relief?.present;
  const shown = drawn && (sky ? sky.seabed : land || seabed);
  // The sea's depth where no layer has data, as the sky last gave it: the tiles' base, which
  // would load them all again were it to change as the sky goes.
  const [seaDepth, setSeaDepth] = useState<number>(sceneryDefaults.ocean.depth);
  const skyDepth = sky?.depth;
  useEffect(() => {
    if (skyDepth !== undefined) setSeaDepth(skyDepth);
  }, [skyDepth]);
  // The ground under the camera: none while not shown.
  const ground = relief?.ground;
  useEffect(() => {
    if (!shown || !ground) return;
    return () => {
      ground.current = null;
    };
  }, [shown, ground]);

  // Compiled with the sky's own before either is drawn; again when its parts may have changed.
  const root = useRef<Group>(null);
  const register = sky?.stage;
  useLayoutEffect(() => {
    if (!register || !root.current) return;
    return register(root.current);
  }, [
    register,
    mounted,
    sky?.definesKey,
    sky?.seabedOpacity,
    stage?.occupants,
    debug,
  ]);

  if (!mounted || !relief || !world) return null;
  return (
    <group ref={root} visible={sky ? sky.visible && sky.ready : true}>
      {/* Its tiles, and with a sky past them the overview: the same tiles, coarser, drawn
          per pixel where the ground in view reaches past the far plane. */}
      <SceneryStageReliefTiles
        sky={sky?.material ?? null}
        globe={world.globe}
        source={{ layers, base: -(depth ?? skyDepth ?? seaDepth) }}
        looks={looks.texture}
        reach={far}
        level={sky?.level ?? world.globe.level}
        pixelError={pixelError}
        cellPixels={cellPixels}
        transition={transition}
        definesKey={sky?.definesKey}
        visible={visible && shown}
        onStats={onStats}
        onLoading={progress.loading}
        cameraGround={shown ? relief.ground : undefined}
        stage={stage?.boundary ?? world.boundary}
        fields={fields}
        seeThrough={sky ? sky.seabedOpacity < 1 : fieldOpacity < 1}
        opacity={sky ? 1 : opacity}
        fieldOpacity={fieldOpacity}
        land={sky ? true : land}
        seabed={sky ? true : seabed}
        debug={debug}
        grounds={stage?.grounds}
        groundLive={stage?.groundLive ?? false}
        occupants={stage?.occupants}
        onSampler={onSampler}
        skyOrder={sky ? sky.renderOrder + 1 : 0}
        hub={relief.tiles}
      />
      {labelled && (
        <GeoReliefContourLabels
          hub={relief.tiles}
          globe={world.globe}
          looks={contourLabels}
          water={!!sky?.water}
          visible={visible && shown && (sky ? sky.visible && sky.ready : true)}
          cellPixels={cellPixels}
        />
      )}
    </group>
  );
};
