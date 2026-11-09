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
  cloudLayersByLevel,
  cloudLayersInProportion,
  cloudLayersOf,
  WEATHER_LOCAL_RADIUS,
  weatherPreset,
  type CloudLayer,
} from '../../sdk/weather/weather';
import { WeatherClock } from '../../sdk/weather/weather-clock';
import { useWeather, useWeatherClock } from '../Weather/weather-context';
import {
  CLOUD_VOLUME_LOOKS,
  CloudVolumeRenderer,
  cloudVolumeQuality,
  type CloudVolumeLevel,
} from './scenery-cloud-volume';
import { sceneryDefaults, SceneryCloudVolumeProps } from './scenery-model';
import { SceneryRegistryContext } from './scenery-registry';

// Without layers of its own or a Weather's.
const DEFAULT_LAYERS: CloudLayer[] = weatherPreset('scattered').clouds ?? [];
// Drawn after the scenery's sea's surface (at its renderOrder + 1).
const AFTER_SURFACE = 2;
const NO_DEBUG = {};
// A level covering less than this is left out.
const LEAST_COVER = 0.005;

const scratch = new Color();
const toHex = (value: ColorRepresentation) => scratch.set(value).getHex();

/**
 * 3D clouds over a {@link Scenery}'s sky (see {@link SceneryCloudVolumeProps} and
 * `documents/clouds.md`): a local weather's layers, one at each level, each drawn as its type
 * looks, marched through on the globe every frame at a share of the screen's resolution and
 * drawn over the scene, so what lies in front of them hides them and they hide what lies
 * behind. Fixed to the Earth, each level drifting with its wind on the enclosing `Weather`'s
 * clock. Anywhere under the `Scenery`; it compiles its own programs and draws its noise, and
 * shows once they are ready.
 *
 * Being rebuilt (2026-11-09): a global weather draws nothing yet, and the scenery's bakes, its
 * sea, its light and its shadows take none of them.
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
  scale = sceneryDefaults.cloudVolume.scale,
  density = sceneryDefaults.cloudVolume.density,
  color = sceneryDefaults.cloudVolume.color,
  seed = sceneryDefaults.cloudVolume.seed,
  quality = sceneryDefaults.cloudVolume.quality,
  resolution,
  debug = NO_DEBUG,
}: SceneryCloudVolumeProps) => {
  const registry = useContext(SceneryRegistryContext);
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const camera = useThree(state => state.camera);
  const weather = useWeather();

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
      volume.dispose();
    },
    [gl, volume],
  );

  const colorHex = toHex(color);
  const named = typeof layers === 'string' ? cloudLayersOf(layers) : layers;
  const own = named ?? weather?.clouds ?? DEFAULT_LAYERS;
  // Local with layers of its own, without a weather, or as the weather is; else global, which
  // draws nothing for now.
  const local =
    named || !weather ? (weather?.local ?? {}) : (weather.local ?? null);
  const localKey = local
    ? JSON.stringify({
        latitude: local.latitude,
        longitude: local.longitude,
        radius: local.radius ?? WEATHER_LOCAL_RADIUS,
      })
    : '';
  // One layer a level, in proportion, each drawn as its type looks.
  const levels: CloudVolumeLevel[] = local
    ? cloudLayersInProportion(cloudLayersByLevel(own), dominance)
        .filter(
          (layer): layer is CloudLayer => !!layer && layer.cover >= LEAST_COVER,
        )
        .map(layer => ({
          layer,
          look: { ...CLOUD_VOLUME_LOOKS[layer.type], ...looks?.[layer.type] },
        }))
    : [];
  const levelsKey = JSON.stringify(levels);
  useEffect(() => {
    if (import.meta.env.DEV && !localKey)
      console.warn(
        'SceneryCloudVolume draws no global weather while it is rebuilt: give the Weather `local`',
      );
  }, [localKey]);
  const windSpeed = weather?.wind?.speed;
  const windFrom = weather?.wind?.from;
  const debugView = debug.view;
  const debugAir = debug.air;

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
      debug: { view: debugView, air: debugAir },
    });
  }, [
    volume,
    levelsKey,
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
  useFrame(() => {
    if (!volume || !registry) return;
    const clock = weatherClock ?? ownClock;
    volume.time = clock.time;
    volume.rate = clock.paused ? 0 : clock.timeScale;
    volume.composite.renderOrder = registry.view.renderOrder + AFTER_SURFACE;
    volume.composite.visible =
      ready && enabled && volume.cloudy && registry.view.clouds;
  });

  return volume ? <primitive object={volume.composite} dispose={null} /> : null;
};
