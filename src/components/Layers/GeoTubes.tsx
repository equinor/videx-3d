import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Color,
  ColorRepresentation,
  DataArrayTexture,
  Mesh,
  Vector2,
} from 'three';
import { useGenerator } from '../../hooks/useGenerator';
import { createLayers, LAYERS } from '../../layers/layers';
import {
  PlanarLineGeometry,
  type PlanarLineCoordinates,
} from '../../sdk/geometries/planar-geometry';
import type {
  GeoFeature,
  GeoJsonFeatureCollection,
} from '../../sdk/layers/geo-features';
import { geoDistance, type LonLat } from '../../sdk/layers/geo-lines';
import {
  geoTubeNodesAround,
  liftGeoTubeNodes,
  packGeoTubeRoutes,
  type GeoTubeNodesLaid,
  type GeoTubeRoute,
  type GeoTubeRoutes,
} from '../../sdk/layers/geo-tubes';
import {
  layerRevealAt,
  type LayerReveal,
  type LayerVisibility,
} from '../../sdk/layers/layer-visibility';
import type { GeoFrame } from '../../sdk/projection/geo-frame';
import { useSceneryOcean } from '../Scenery/scenery-context';
import { GeoTileStyles } from './geo-tile-layer';
import {
  createGeoTubeGeometry,
  createGeoTubeMaterial,
  GeoTubeNodes,
} from './geo-tubes';
import { geoTubeNodes } from './layer-defs';
import {
  drawOverSea,
  layerShownAt,
  useGeoFeatures,
  useLayerGlobe,
} from './layer-globe';

/**
 * How a line is drawn by {@link GeoTubes}.
 *
 * @group Layers
 */
export type GeoTubeStyle = {
  /** Default '#ffb000' */
  color?: ColorRepresentation;
  /** Default 1 */
  opacity?: number;
  /** outer diameter as built, metres: drawn `exaggeration` times as wide, and never under `minPixels`. Default 0.5 */
  diameter?: number;
};

/**
 * GeoTubes props
 * @expand
 */
export type GeoTubesProps<P = Record<string, unknown>> = LayerVisibility & {
  /** the lines, in longitude and latitude: GeoJSON, or features read from it (`geoFeaturesFromGeoJson`). Other kinds are left out */
  data: GeoJsonFeatureCollection<P> | GeoFeature<P>[] | null;
  /** one style for all, or one per feature. Keep a function stable (`useCallback`) */
  style?: GeoTubeStyle | ((feature: GeoFeature<P>) => GeoTubeStyle);
  /** how many times wider than built each is drawn. Default 1 */
  exaggeration?: number;
  /** the least width drawn, in pixels, however far: the tube reads as a line from afar. 0 for none: drawn as built, thinning out of sight with distance as any geometry does. Default 2 */
  minPixels?: number;
  /** metres between a tube's nodes near the camera. Default 20 */
  spacing?: number;
  /** farther off, nodes this share of the distance to the camera apart, if more than `spacing`. Default 0.01 */
  spacingPerDistance?: number;
  /** metres from the camera past which lines are not drawn. Default Infinity */
  maxDistance?: number;
  /** the longest hollow a pipe bridges, resting on the high points, metres. Default 0, on the ground everywhere */
  span?: number;
  /** rounds off the corners `span` leaves, over a window in metres. Default 0 */
  smoothing?: number;
  /** metres over the sea where there is no ground (no relief). Default 0 */
  height?: number;
  /** sides round a tube. Default 8 */
  radialSegments?: number;
  /** the colour the silhouette darkens toward. Default '#000000' */
  shadingColor?: ColorRepresentation;
  /** how much it darkens at the silhouette, 0 flat. Default 0.6 */
  shadingStrength?: number;
  /** higher hugs the silhouette, lower spreads inward. Default 2 */
  shadingFalloff?: number;
  /** the whole layer's. Default 1 */
  opacity?: number;
  /** inside a `Scenery` with a sea, `'fog'` is seen through the water as the seabed is; `'clear'` as it is. Default 'fog' */
  water?: 'fog' | 'clear';
  /** with `water` 'fog', revealed as a map: lifted to the sea's level where it lies below it, and drawn over the sea, through its surface and seabed. `true` always, or by the camera's height (see `LayerReveal`) */
  reveal?: LayerReveal;
  /** where the scene lies on the Earth, without a `World` or `Scenery` to say */
  frame?: GeoFrame;
  /** the most nodes made at once: past it, nodes are spaced farther apart until they fit. Default 131072 */
  maxNodes?: number;
};

const LAYERS_TUBES = createLayers(LAYERS.NOT_EMITTER);
const DEFAULT_STYLE: GeoTubeStyle = {};
const color = new Color();
const foot = { longitude: 0, latitude: 0 };

/**
 * Lines in longitude and latitude — pipelines, cables — as 3D tubes lying on the ground:
 * inside a `Scenery`, on the relief its stage draws, as drawn, through its swaps between
 * levels of detail (the relief's heights read per node on the GPU); a pipe's free spans over
 * the hollows (`span`) laid on the CPU. Each its diameter as built, exaggerated, and never
 * thinner than `minPixels` (as a `Trajectory` is), so the same tube reads as a line from
 * afar, at any angle; its silhouette shaded; seen through the sea as the seabed is (`water`).
 *
 * One instanced draw for the whole network. Nodes are laid every `spacing` metres near the
 * camera and farther apart farther off (`spacingPerDistance`), and laid again as the camera
 * moves: by the `geoTubeNodes` generator where one is registered (`generateGeoTubeNodes`),
 * else on the main thread. The free spans near the camera are laid on the main thread, where
 * the relief's heights are.
 *
 * See `documents/layers.md`.
 *
 * @example
 * <Scenery>
 *   <SceneryStage bounds={bounds} relief={{ layers }} />
 *   <GeoTubes data={pipelines} style={f => ({ diameter: f.properties.diameter * 0.0254 })} exaggeration={20} />
 * </Scenery>
 *
 * @group Components
 */
export const GeoTubes = <P,>({
  data,
  style = DEFAULT_STYLE,
  exaggeration = 1,
  minPixels = 2,
  spacing = 20,
  spacingPerDistance = 0.01,
  maxDistance = Infinity,
  span = 0,
  smoothing = 0,
  height = 0,
  radialSegments = 8,
  shadingColor = '#000000',
  shadingStrength = 0.6,
  shadingFalloff = 2,
  opacity = 1,
  water = 'fog',
  reveal,
  frame,
  maxNodes = 131072,
  visible = true,
  minHeight,
  maxHeight,
  fade,
}: GeoTubesProps<P>) => {
  const placed = useLayerGlobe(frame);
  const globe = placed?.globe ?? null;
  const ocean = useSceneryOcean();
  const sky = water === 'fog' && ocean ? ocean.material : null;
  const hub = ocean ? ocean.reliefTiles : null;
  const size = useThree(state => state.size);
  const features = useGeoFeatures(data);

  const routes = useMemo<GeoTubeRoute[]>(
    () =>
      features.flatMap((feature, id) =>
        feature.geometry instanceof PlanarLineGeometry
          ? [
              {
                id,
                parts: feature.geometry
                  .coordinates as PlanarLineCoordinates as LonLat[][],
                bounds: feature.bounds,
              },
            ]
          : [],
      ),
    [features],
  );

  const styles = useMemo(() => new GeoTileStyles(2), []);
  useEffect(() => () => styles.dispose(), [styles]);
  const styleKey = typeof style === 'function' ? style : JSON.stringify(style);
  const { texture: styleTexture, translucent: anyTranslucent } = useMemo(() => {
    let translucent = false;
    const texture = styles.set(features.length, (id, out, at) => {
      const given = typeof style === 'function' ? style(features[id]) : style;
      color.set(given.color ?? '#ffb000');
      const alpha = given.opacity ?? 1;
      if (alpha < 1) translucent = true;
      out.set([color.r, color.g, color.b, alpha], at);
      out.set([given.diameter ?? 0.5, 0, 0, 0], at + 4);
    });
    return { texture, translucent };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by the style's content
  }, [styles, features, styleKey]);
  const translucent = anyTranslucent || opacity < 1;

  const nodes = useMemo(() => new GeoTubeNodes(maxNodes), [maxNodes]);
  useEffect(() => () => nodes.dispose(), [nodes]);
  const geometry = useMemo(
    () => createGeoTubeGeometry(radialSegments, nodes),
    [radialSegments, nodes],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  // The relief's heights, once one is drawn: the material is made with them (as
  // GeoTileLayer's drape), kept when it goes.
  const [reliefTextures, setReliefTextures] = useState<{
    heights: DataArrayTexture;
    cells: number;
  } | null>(null);
  useEffect(() => {
    if (!hub) return;
    const take = () => {
      const current = hub.current;
      if (!current) return;
      setReliefTextures(known =>
        known?.heights === current.heights && known.cells === current.cells
          ? known
          : { heights: current.heights, cells: current.cells },
      );
    };
    take();
    return hub.subscribe(take);
  }, [hub]);

  const definesKey = sky ? ocean?.definesKey : '';
  const material = useMemo(
    () =>
      globe
        ? createGeoTubeMaterial({
            globe,
            styles: styleTexture,
            relief: hub ? reliefTextures : null,
            groups: nodes.groups,
            sky,
            translucent,
          })
        : null,
    // The style's texture is set below; the sky's defines are compiled in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [globe, hub, reliefTextures, nodes, sky, translucent, definesKey],
  );
  useEffect(() => () => material?.dispose(), [material]);
  useEffect(() => {
    if (!material) return;
    const u = material.uniforms;
    u.uTubeStyles.value = styleTexture;
    u.uTubeExaggeration.value = exaggeration;
    u.uTubeMinPixels.value = minPixels;
    (u.shadingColor.value as Color).set(shadingColor);
    u.shadingStrength.value = shadingStrength;
    u.shadingFalloff.value = shadingFalloff;
    (u.resolution.value as Vector2).set(size.width, size.height);
  }, [
    material,
    styleTexture,
    exaggeration,
    minPixels,
    shadingColor,
    shadingStrength,
    shadingFalloff,
    size,
  ]);

  // The relief chose again: the groups' tiles as drawn now, the nodes over tiles no longer
  // drawn placed again.
  useEffect(
    () => hub?.subscribe(() => nodes.groups.update(nodes, hub.current)),
    [hub, nodes],
  );

  const packed = useMemo(() => packGeoTubeRoutes(routes), [routes]);
  // Laid on a worker where the generator is registered; on this thread if not.
  const generate = useGenerator<GeoTubeNodesLaid>(geoTubeNodes);

  // What the nodes were laid for: laid again once the camera has moved a fifth of its height
  // (or of 20 nodes near it) from there, along or up, or anything they are laid from changed.
  const built = useRef({
    key: '',
    routes: null as GeoTubeRoutes | null,
    at: [0, 0] as LonLat,
    altitude: 0,
    resident: -1,
    time: 0,
  });
  // One request out at a time; the worker given up on once it fails.
  const job = useRef({ pending: false, worker: true, alive: true });
  useEffect(() => {
    const current = job.current;
    current.alive = true;
    return () => {
      current.alive = false;
    };
  }, []);
  const visibility = useRef<LayerVisibility>({});
  visibility.current = { visible, minHeight, maxHeight, fade };
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  const mesh = useRef<Mesh>(null);

  // The nodes near the camera on the ground the relief has in, free spans over the hollows.
  const lift = () => {
    const written = liftGeoTubeNodes(
      nodes.arrays,
      nodes.count,
      { span, smoothing },
      (longitude, latitude) =>
        hub?.current?.heightAt(longitude, latitude) ?? null,
      height,
    );
    if (written) nodes.upload(written[0], written[1]);
  };
  // Read when a request comes back, frames later.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const hubRef = useRef(hub);
  hubRef.current = hub;
  const liftRef = useRef(lift);
  liftRef.current = lift;

  useFrame(({ camera }) => {
    if (!mesh.current || !material) return;
    if (!globe || !globe.frame || routes.length === 0) {
      mesh.current.visible = false;
      return;
    }
    const altitude = globe.altitude(camera.position);
    const shown = layerShownAt(
      camera.position,
      globe,
      ocean,
      visibility.current,
      'ground',
    );
    if (shown <= 0) {
      mesh.current.visible = false;
      return;
    }
    // Revealed as a map: on the sea, over it, fading in.
    const revealed = sky ? layerRevealAt(altitude, revealRef.current) : 0;
    drawOverSea(mesh.current, revealed > 0, 0);
    (material.uniforms.uGeoReveal.value as Vector2).set(
      revealed > 0 ? 1 : 0,
      revealed > 0 ? revealed : 1,
    );
    material.uniforms.uTubeOpacity.value =
      opacity * shown * (revealed > 0 ? revealed : 1);
    globe.geographic(camera.position, foot);
    const here: LonLat = [foot.longitude, foot.latitude];
    const relief = hub?.current ?? null;
    const origin = globe.conformalOrigin!;
    const key = `${spacing}|${spacingPerDistance}|${maxDistance}|${span}|${smoothing}|${height}|${maxNodes}|${origin.sphere.latitude0},${origin.longitude0}`;
    const state = built.current;
    const now = performance.now();
    const above = Math.max(Math.abs(altitude), spacing * 20);
    const moved =
      geoDistance(here, state.at) > 0.2 * above ||
      Math.abs(altitude - state.altitude) > 0.2 * above;
    if (
      !job.current.pending &&
      (key !== state.key || packed !== state.routes || moved)
    ) {
      state.key = key;
      state.routes = packed;
      state.at = here;
      state.altitude = altitude;
      const laying = {
        spacing,
        spacingPerDistance,
        maxDistance,
        span,
        smoothing,
      };
      const centre = here;
      const cameraHeight = Math.max(altitude, 0);
      const local = () =>
        geoTubeNodesAround(
          packed,
          centre,
          cameraHeight,
          laying,
          origin,
          height,
          nodes.capacity,
        );
      const take = (laid: GeoTubeNodesLaid) => {
        // Laid for what no longer is: laid again next frame.
        if (
          !job.current.alive ||
          state.key !== key ||
          state.routes !== packed ||
          nodesRef.current !== nodes
        ) {
          state.key = '';
          return;
        }
        nodes.set(laid);
        state.resident = hubRef.current?.current?.resident ?? -1;
        state.time = performance.now();
        liftRef.current();
        nodes.groups.place(nodes, hubRef.current?.current ?? null);
      };
      if (job.current.worker) {
        job.current.pending = true;
        generate(
          packed,
          centre,
          cameraHeight,
          laying,
          origin,
          height,
          nodes.capacity,
        )
          .catch(() => null)
          .then(laid => {
            job.current.pending = false;
            if (laid) return take(laid);
            // Not registered: laid here from now on.
            job.current.worker = false;
            take(local());
          });
      } else {
        take(local());
      }
    }
    // The ground on the CPU (for the spans) sharpens as finer relief tiles come in: the
    // nodes near the camera rest on it again, no more often than every half second.
    if (
      span > 0 &&
      relief &&
      relief.resident !== state.resident &&
      now - state.time > 500
    ) {
      state.resident = relief.resident;
      state.time = now;
      lift();
    }
    geometry.instanceCount = Math.max(nodes.count - 1, 0);
    mesh.current.visible = nodes.count > 1;
  });
  if (!material) return null;
  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      layers={LAYERS_TUBES}
      visible={false}
      onBeforeRender={sky ? sky.onBeforeDraw : undefined}
    />
  );
};
