import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Vector3, type IUniform } from 'three';
import type { LayerVisibility } from '../../sdk/layers/layer-visibility';
import {
  createGraticuleUniforms,
  graticuleStep,
  graticuleViewDegreesPerPixel,
  setGraticuleOrigin,
  setGraticuleStep,
  setGraticuleUniforms,
  type GraticuleStep,
  type GraticuleUniforms,
} from '../../sdk/materials/graticule';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import type { Globe } from '../../sdk/projection/globe';
import { LabelLayer } from '../Labels/LabelLayer';
import type { Label, LabelsProvider, LabelStyle } from '../Labels/types';
import { useSceneryOcean } from '../Scenery/scenery-context';
import { useWorldRelief } from '../World/world-relief';
import { GeoTileLayer, type GeoTileLayerSource } from './GeoTileLayer';
import {
  GRATICULE_LABEL_DENSITY,
  GRATICULE_LABEL_REACH,
  GRATICULE_LABEL_SIZE,
  GRATICULE_LABEL_SMOOTH_MAX,
  graticuleLabelCentre,
  graticuleLabels,
  graticuleLabelSize,
  graticuleLabelSpacing,
  graticuleLabelStep,
} from './graticule-labels';
import {
  graticuleLatLonLabels,
  graticuleStyles,
  graticuleZoneLabelsOf,
  type GeoGraticuleOptions,
  type GraticuleLabels,
  type GraticuleZoneLabels,
} from './graticule-options';
import {
  GRATICULE_ZONE_LABEL_SIZE,
  graticuleZoneLabels,
  timeZoneCells,
  utmZoneCells,
} from './graticule-zone-labels';
import { useLayerGlobe } from './layer-globe';
import sample from './shaders/geo-graticule-sample.glsl';

/**
 * GeoGraticule props
 * @expand
 */
export type GeoGraticuleProps = GeoGraticuleOptions &
  LayerVisibility & {
    /**
     * lie on the relief a `GeoRelief` in the `World` draws — its land and its seabed — as
     * drawn; over a `Scenery`'s sea, on the sea's level. Default true where there is a
     * relief
     */
    drape?: boolean;
    /** metres over the sea's level where it lies flat: where no relief is drawn, or without `drape`. Default 0 */
    height?: number;
    /** the whole layer's, from 0 to 1. Default 1 */
    opacity?: number;
    /** where the scene lies on the Earth, without a `World` or `Scenery` to say */
    frame?: GeoFrame;
    /** the order among see-through objects drawn without an `OITRenderPass`. Default 999, over them */
    renderOrder?: number;
  };

// Every geographic tile has lines over it.
const EVERYWHERE: GeoTileLayerSource = { size: 16, covers: () => true };
// A tile is split until each of its 16 cells along a side spans no more than this many
// pixels: patches about 256 pixels across, fine enough to follow the globe's curve (the
// lines themselves are worked out per pixel, whatever the patch).
const CELL_PIXELS = 16;

/**
 * The look of a `GeoGraticule`'s names, by default: small and light, a thin soft halo, so
 * they read without covering the scene; and never faded for being seen at a slant, only
 * when too small on screen (`minPixels`); never drawn larger than `maxPixels`, either: one
 * near the camera while the lines' step is judged far away is shrunk to it. Turned to read
 * left to right from wherever they are seen (`flip`).
 */
export const GRATICULE_LABEL_STYLE: Partial<LabelStyle> = {
  fontWeight: 500,
  haloWidth: 0.07,
  haloColor: 'rgba(0, 0, 0, 0.55)',
  minFacing: 0,
  maxPixels: 48,
  flip: true,
};

// Centred on their places, whatever the options: the cells' middles.
const CENTRED: Partial<LabelStyle> = {
  align: 'center',
  baseline: 'middle',
  offset: [0, 0],
};

const NO_LABELS: Label[] = [];
const dir = new Vector3();
const there = { latitude: 0, longitude: 0 };

/**
 * Lines on the Earth — latitude and longitude, the UTM zones and the nautical time zones
 * (see {@link GeoGraticuleOptions}) — each a width in screen pixels at any distance, from the
 * field out to the horizon and from space: a {@link GeoTileLayer} drawn from its shader
 * alone (`graticule.glsl`), over everything see-through, as a map is. Latitude and
 * longitude follow the zoom unless given an `interval`; `labels` names the lines and the
 * zones drawn, each kind's names on or off or in a look of their own: latitude and
 * longitude's along their lines, the zones' in their cells, flat on the sea's level.
 *
 * Needs no `Scenery` and no relief: in a `World` (or with a `frame`) it lies flat on the
 * sea's level. With a `GeoRelief` in the `World` it lies on the land and the seabed as they
 * are drawn (`drape`). With a `Scenery`'s sea — inside the `Scenery`, or anywhere in its
 * `World` — it lies on the sea's level over the sea and on the land above it, and is hidden
 * while the camera is under the sea's surface (`minHeight` 0, unless given one); inside the
 * `Scenery`, under the ground too. Lifted toward the camera rather than drawn on the waves:
 * close up, high waves may cut through it unless an `OITRenderPass` draws it over the sea.
 *
 * @example
 * <World frame={frame}>
 *   <GeoGraticule utm={{ color: '#ffd23f' }} labels={{ latLon: true, utm: true }} />
 * </World>
 *
 * See `documents/layers.md`.
 *
 * @group Components
 */
export const GeoGraticule = ({
  latLon,
  utm,
  timeZones,
  labels: named,
  drape,
  height = 0,
  opacity = 1,
  frame,
  renderOrder,
  visible = true,
  minHeight,
  maxHeight,
  fade,
}: GeoGraticuleProps) => {
  const gl = useThree(state => state.gl);
  const placed = useLayerGlobe(frame);
  const globe = placed?.globe ?? null;
  const ocean = useSceneryOcean();
  const relief = useWorldRelief();
  // A Scenery's sea, from inside it or anywhere in its World: lines lie on its surface.
  const sea = ocean ?? relief?.sky ?? null;
  const onSea = !!sea?.water;

  const key = JSON.stringify({ latLon, utm, timeZones, labels: named });
  const options = useMemo(() => JSON.parse(key) as GeoGraticuleOptions, [key]);
  const styles = useMemo(() => graticuleStyles(options), [options]);
  const uniforms = useMemo(createGraticuleUniforms, []);
  const shader = useMemo(
    () => ({
      sample,
      uniforms: uniforms as unknown as Record<string, IUniform>,
    }),
    [uniforms],
  );
  // The zoom the step was last chosen for: chosen again when it changes.
  const scale = useRef(-1);
  const step = useMemo<GraticuleStep>(
    () => ({ step: 0, finer: 0, weight: 0 }),
    [],
  );
  useLayoutEffect(() => {
    setGraticuleUniforms(uniforms, styles);
    scale.current = -1;
  }, [uniforms, styles]);

  // Latitude and longitude's step follows the zoom where the view is centred; the lines are
  // measured from under the camera, so they hold in 32-bit floats close in.
  useFrame(({ camera }) => {
    if (!globe?.location || !visible) return;
    const latLonStyle = styles.latLon;
    if (latLonStyle) {
      const degreesPerPixel = graticuleViewDegreesPerPixel(
        globe,
        camera,
        gl.domElement.height,
      );
      if (degreesPerPixel !== scale.current) {
        scale.current = degreesPerPixel;
        const interval = latLonStyle.interval ?? 0;
        setGraticuleStep(
          uniforms,
          interval > 0
            ? { step: interval, finer: interval, weight: 0 }
            : graticuleStep(degreesPerPixel, latLonStyle.minSpacing, step),
        );
      }
    }
    setGraticuleOrigin(uniforms, globe, camera.position);
  });

  const labels = useMemo(() => graticuleLatLonLabels(options), [options]);
  const utmLabels = useMemo(
    () => graticuleZoneLabelsOf(options, 'utm'),
    [options],
  );
  const timeZoneLabels = useMemo(
    () => graticuleZoneLabelsOf(options, 'timeZones'),
    [options],
  );
  // No kind on: nothing to draw, nor tiles to choose.
  const lined = !!(styles.latLon || styles.utm || styles.timeZones);

  return (
    <>
      <GeoTileLayer
        source={EVERYWHERE}
        shader={shader}
        water="clear"
        drape={drape ?? !!relief?.present}
        floor={onSea ? 0 : undefined}
        height={height}
        opacity={opacity}
        texelPixels={CELL_PIXELS}
        transition={0}
        reach="horizon"
        frame={frame}
        renderOrder={renderOrder}
        visible={visible && lined}
        minHeight={minHeight ?? (onSea ? 0 : undefined)}
        maxHeight={maxHeight}
        fade={fade}
      />
      {visible && globe && labels && (
        <LatLonLabels globe={globe} uniforms={uniforms} options={labels} />
      )}
      {visible && globe && utmLabels && (
        <ZoneLabels globe={globe} kind="utm" options={utmLabels} />
      )}
      {visible && globe && timeZoneLabels && (
        <ZoneLabels globe={globe} kind="timeZones" options={timeZoneLabels} />
      )}
    </>
  );
};

// Latitude and longitude's names (GraticuleLabels): a LabelLayer around where the view is
// centred, at the step of the lines `uniforms` draw on `globe`.
const LatLonLabels = ({
  globe,
  uniforms,
  options,
}: {
  globe: Globe;
  uniforms: GraticuleUniforms;
  options: GraticuleLabels;
}) => {
  const {
    size: fraction = GRATICULE_LABEL_SIZE,
    reach = GRATICULE_LABEL_REACH,
    density = GRATICULE_LABEL_DENSITY,
    sizing = 'stepped',
    lift,
    ...style
  } = options;

  // The step the lines are seen at, from what the graticule sets each frame: it changes
  // seldom, and only then renders. Drawn `'smooth'`, the labels' size follows the lines'
  // spacing between their steps each frame, on the GPU alone (`scaleRef`).
  const [step, setStep] = useState(0);
  const scale = useRef(1);
  useFrame(() => {
    if (!globe.location) {
      if (step) setStep(0);
      return;
    }
    const lines = uniforms.uGraticuleLatLon.value;
    const now = graticuleLabelStep(lines.x, lines.y, lines.z, step);
    if (now !== step) setStep(now);
    scale.current =
      sizing === 'smooth' && now > 0
        ? Math.min(
            graticuleLabelSpacing(lines.x, lines.y, lines.z) / now,
            GRATICULE_LABEL_SMOOTH_MAX,
          )
        : 1;
  });

  // The same labels while the nearest lines to the view's centre stay the same, so the
  // layer writes nothing again as the view moves. Thinned toward the poles from the
  // latitude their size is judged at, the field's.
  const provider = useMemo<LabelsProvider>(() => {
    let key = '';
    let found = NO_LABELS;
    return ({ camera }) => {
      const location = globe.location;
      if (!step || !location) return NO_LABELS;
      camera.getWorldDirection(dir);
      graticuleLabelCentre(globe, camera.position, dir, there);
      const now = `${Math.round(there.latitude / step)}|${Math.round(there.longitude / step)}|${location.latitude}`;
      if (now !== key) {
        key = now;
        found = graticuleLabels(globe, step, there, {
          reach,
          density,
          reference: location.latitude,
        });
      }
      return found;
    };
  }, [globe, step, reach, density]);

  const location = globe.location;
  if (!step || !location) return null;
  // At the field's latitude: across the few degrees a view spans, near enough.
  const size = graticuleLabelSize(step, location.latitude, fraction);
  return (
    <LabelLayer
      provider={provider}
      size={size}
      scaleRef={scale}
      // Over the waves near the field, which would cut through text at the sea's level.
      lift={lift ?? Math.max(5, 0.05 * size)}
      {...GRATICULE_LABEL_STYLE}
      {...style}
      {...CENTRED}
    />
  );
};

// The UTM zones' or the time zones' names (GraticuleZoneLabels): one in the middle of each
// cell, sized by its cell (graticuleZoneLabels). All of them, made once for the globe's
// place on the Earth, so nothing is written as the view moves; those facing away are not
// drawn.
const ZoneLabels = ({
  globe,
  kind,
  options,
}: {
  globe: Globe;
  kind: 'utm' | 'timeZones';
  options: GraticuleZoneLabels;
}) => {
  const { size: fraction = GRATICULE_ZONE_LABEL_SIZE, ...style } = options;
  const cells = useMemo(
    () => (kind === 'utm' ? utmZoneCells() : timeZoneCells()),
    [kind],
  );
  // Made again only when the globe is placed anew (its location a new object).
  const provider = useMemo<LabelsProvider>(() => {
    let placed: object | null = null;
    let found = NO_LABELS;
    return () => {
      const location = globe.location;
      if (!location) return NO_LABELS;
      if (location !== placed) {
        placed = location;
        found = graticuleZoneLabels(globe, cells, fraction);
      }
      return found;
    };
  }, [globe, cells, fraction]);
  if (!globe.location) return null;
  return (
    <LabelLayer
      provider={provider}
      // Each label its own size in metres (Label.size).
      size={1}
      // Over the waves near the field, and clear of the sea far off.
      lift={5}
      liftPerDistance={1e-3}
      {...GRATICULE_LABEL_STYLE}
      {...style}
      {...CENTRED}
    />
  );
};
