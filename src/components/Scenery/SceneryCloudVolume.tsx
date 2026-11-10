import { useFrame, useThree } from '@react-three/fiber';
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { Color, ColorRepresentation } from 'three';
import {
  precompile,
  PRECOMPILE_PRIORITY,
  releaseMaterial,
} from '../../rendering/precompile';
import {
  CLOUD_LEVELS,
  cloudLayersByLevel,
  cloudLayersInProportion,
  cloudLayersOf,
  WEATHER_LOCAL_RADIUS,
  weatherSystemsOf,
  type CloudLayer,
  type CloudType,
} from '../../sdk/weather/weather';
import { WeatherClock } from '../../sdk/weather/weather-clock';
import { useWeather, useWeatherClock } from '../Weather/weather-context';
import { useWorldRelief } from '../World/world-relief';
import {
  CLOUD_VOLUME_LOOKS,
  cloudVolumeChainLayer,
  CloudVolumeRenderer,
  cloudVolumeQuality,
  type CloudVolumeGlobal,
  type CloudVolumeLevel,
  type CloudVolumeLook,
} from './scenery-cloud-volume';
import { sceneryDefaults, SceneryCloudVolumeProps } from './scenery-model';
import { SceneryRegistryContext } from './scenery-registry';

// Without layers of its own or a Weather's: a few high clouds, hiding little of the scene.
const DEFAULT_LAYERS: CloudLayer[] = cloudLayersOf('few-high');
// Drawn after the scenery's sea's surface (at its renderOrder + 1).
const AFTER_SURFACE = 2;
const NO_DEBUG = {};
// A level covering less than this is left out.
const LEAST_COVER = 0.005;
const ALL_LEVELS = {};

const scratch = new Color();
const toHex = (value: ColorRepresentation) => scratch.set(value).getHex();

/**
 * 3D clouds over a {@link Scenery}'s sky (see {@link SceneryCloudVolumeProps} and
 * `documents/clouds.md`): a local weather's layers, one at each level, each drawn as its type
 * looks; or a global weather's weather systems over the whole Earth, each level's cover and
 * types from their map. Marched through on the globe every frame at a share of the screen's
 * resolution and drawn over the scene, so what lies in front of them hides them and they hide
 * what lies behind. Fixed to the Earth, each level drifting with its wind on the enclosing
 * `Weather`'s clock. Anywhere under the `Scenery`; it compiles its own programs and draws its
 * noise and, for a global weather, its map of the weather systems, and shows once they are
 * ready.
 *
 * Being rebuilt (2026-11-09): the scenery's bakes, its sea, its light and its shadows take none
 * of them yet.
 *
 * @example
 * <Weather weather={weatherPresetOf('scattered')}>
 *   <Scenery>
 *     <SceneryCloudVolume />
 *   </Scenery>
 * </Weather>
 *
 * @example
 * // Its own layer, by name, whatever the weather's: local
 * <SceneryCloudVolume layers="overcast stratus" />
 *
 * @group Components
 */
export const SceneryCloudVolume = ({
  enabled = true,
  layers,
  dominance = sceneryDefaults.cloudVolume.dominance,
  looks,
  levels: levelsOn = ALL_LEVELS,
  scale = sceneryDefaults.cloudVolume.scale,
  density = sceneryDefaults.cloudVolume.density,
  color = sceneryDefaults.cloudVolume.color,
  seed = sceneryDefaults.cloudVolume.seed,
  quality = sceneryDefaults.cloudVolume.quality,
  resolution,
  debug = NO_DEBUG,
  terrain = sceneryDefaults.cloudVolume.terrain,
  lightMap = sceneryDefaults.cloudVolume.lightMap,
}: SceneryCloudVolumeProps) => {
  const registry = useContext(SceneryRegistryContext);
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const camera = useThree(state => state.camera);
  const weather = useWeather();
  // The World's relief: the ground the clouds lie over.
  const loader = useWorldRelief()?.loader ?? null;

  useEffect(() => {
    if (!registry && import.meta.env.DEV)
      console.warn('SceneryCloudVolume draws nothing outside a Scenery');
  }, [registry]);

  const volume = useMemo(
    () =>
      registry
        ? new CloudVolumeRenderer(
            registry.material,
            registry.view.renderOrder + AFTER_SURFACE,
          )
        : null,
    [registry],
  );
  useEffect(
    () => () => {
      if (!volume) return;
      // Let go once their programs have linked (`releaseMaterial`).
      releaseMaterial(gl, volume.marchMaterial);
      releaseMaterial(gl, volume.compositeMaterial);
      volume.dispose(material => releaseMaterial(gl, material));
    },
    [gl, volume],
  );

  // The ground: the relief's, while `terrain`.
  const terrainSource = terrain ? loader : null;
  useEffect(() => {
    volume?.terrain.setSource(terrainSource);
  }, [volume, terrainSource]);

  const colorHex = toHex(color);
  const named = typeof layers === 'string' ? cloudLayersOf(layers) : layers;
  const own = named ?? weather?.clouds ?? DEFAULT_LAYERS;
  // Local with layers of its own, without a weather, or as the weather is; else global.
  const local =
    named || !weather ? (weather?.local ?? {}) : (weather.local ?? null);
  // A global weather's systems: the weather's seed, else the clouds' own.
  const systemsSeed = weatherSystemsOf(weather, {
    seed: weather?.systems?.seed ?? seed,
  }).seed;
  const localKey = local
    ? JSON.stringify({
        latitude: local.latitude,
        longitude: local.longitude,
        radius: local.radius ?? WEATHER_LOCAL_RADIUS,
      })
    : '';
  // Each type's look, over the defaults.
  const allLooks = Object.fromEntries(
    (Object.keys(CLOUD_VOLUME_LOOKS) as CloudType[]).map(type => [
      type,
      { ...CLOUD_VOLUME_LOOKS[type], ...looks?.[type] },
    ]),
  ) as Record<CloudType, CloudVolumeLook>;
  // Local: one layer a level, in proportion, each drawn as its type looks. Global: each level
  // on, over its chain's heights, its cover the weather systems'.
  const levels: CloudVolumeLevel[] = local
    ? cloudLayersInProportion(cloudLayersByLevel(own), dominance)
        .filter(
          (layer): layer is CloudLayer => !!layer && layer.cover >= LEAST_COVER,
        )
        .map(layer => ({ layer, look: allLooks[layer.type] }))
    : CLOUD_LEVELS.filter(level => levelsOn[level] !== false).map(level => {
        const layer = cloudVolumeChainLayer(level);
        return { layer, look: allLooks[layer.type] };
      });
  const levelsKey = JSON.stringify(levels);
  const looksKey = JSON.stringify(allLooks);
  const global: CloudVolumeGlobal | null = local
    ? null
    : {
        seed: systemsSeed,
        dominance,
        types: debug.types ?? true,
        thickness: debug.thickness ?? true,
      };
  const globalKey = global ? JSON.stringify(global) : '';
  const windSpeed = weather?.wind?.speed;
  const windFrom = weather?.wind?.from;
  const debugView = debug.view;
  const debugAir = debug.air;
  const debugSteer = debug.steer;

  // The light maps' program, compiled once they are asked for (`lightMap`): lit as marched until
  // then, so the default compiles nothing more.
  const [lightReady, setLightReady] = useState(false);
  useLayoutEffect(() => {
    if (!volume || !lightMap) return;
    let current = true;
    const wait = precompile(
      gl,
      volume.lightGenerator(),
      camera,
      scene,
      'offscreen',
      { priority: PRECOMPILE_PRIORITY.background },
    );
    if (!wait) setLightReady(true);
    else
      wait.then(() => {
        if (current) setLightReady(true);
      });
    return () => {
      current = false;
    };
  }, [gl, scene, camera, volume, lightMap]);
  const lit = lightMap && lightReady;

  useLayoutEffect(() => {
    if (!volume) return;
    const place = localKey
      ? (JSON.parse(localKey) as {
          latitude?: number;
          longitude?: number;
          radius: number;
        })
      : { radius: WEATHER_LOCAL_RADIUS };
    volume.set({
      levels: JSON.parse(levelsKey) as CloudVolumeLevel[],
      looks: JSON.parse(looksKey) as Record<CloudType, CloudVolumeLook>,
      global: globalKey ? (JSON.parse(globalKey) as CloudVolumeGlobal) : null,
      local: place,
      wind:
        windSpeed === undefined || windFrom === undefined
          ? null
          : { speed: windSpeed, from: windFrom },
      scale,
      density,
      color: new Color(colorHex),
      seed,
      quality: cloudVolumeQuality(quality, { resolution }),
      lightMap: lit,
      debug: { view: debugView, air: debugAir, steer: debugSteer },
    });
  }, [
    volume,
    levelsKey,
    looksKey,
    globalKey,
    localKey,
    windSpeed,
    windFrom,
    scale,
    density,
    colorHex,
    seed,
    quality,
    resolution,
    debugView,
    debugAir,
    debugSteer,
    lit,
  ]);

  // Hidden until its programs are compiled: drawn before, the browser waits for them.
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    if (!volume) return;
    let current = true;
    setReady(false);
    const noise = volume.noise(gl);
    const waits = [
      precompile(gl, noise.generator, camera, scene, 'offscreen', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      precompile(gl, volume.terrain.generator, camera, scene, 'offscreen', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      ...volume.weatherGenerators(gl).map(generator =>
        precompile(gl, generator, camera, scene, 'offscreen', {
          priority: PRECOMPILE_PRIORITY.background,
        }),
      ),
      precompile(gl, volume.march, camera, scene, 'offscreen', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      precompile(gl, volume.composite, camera, scene, 'scene', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
    ].filter(wait => wait !== null);
    // Its noise drawn once its generator is compiled, before it shows.
    const show = () => {
      if (!current) return;
      volume.generate(gl);
      setReady(true);
    };
    if (waits.length === 0) show();
    else Promise.all(waits).then(show);
    return () => {
      current = false;
    };
  }, [gl, scene, camera, volume]);

  // As the scenery's own clouds' layer is shown: where the camera's zone shows the sky. They
  // drift and change on the Weather's clock, without one on their own.
  const weatherClock = useWeatherClock();
  const [ownClock] = useState(() => new WeatherClock());
  useFrame(state => {
    if (!volume || !registry) return;
    const clock = weatherClock ?? ownClock;
    volume.time = clock.time;
    volume.rate = clock.paused ? 0 : clock.timeScale;
    volume.composite.renderOrder = registry.view.renderOrder + AFTER_SURFACE;
    const drawn = ready && enabled && volume.cloudy;
    volume.composite.visible = drawn && registry.view.clouds;
    // Its ground drawn as it comes in, and asked for about the camera as it moves.
    if (drawn) volume.updateTerrain(gl, state.camera);
  });

  return volume ? <primitive object={volume.composite} dispose={null} /> : null;
};
