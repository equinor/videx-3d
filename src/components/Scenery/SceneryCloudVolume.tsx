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
  cloudLayersOf,
  WEATHER_LOCAL_RADIUS,
  weatherPreset,
  type CloudLayer,
} from '../../sdk/weather/weather';
import { WeatherClock } from '../../sdk/weather/weather-clock';
import { useWeather, useWeatherClock } from '../Weather/weather-context';
import {
  CloudVolumeRenderer,
  cloudVolumeFormOf,
  cloudVolumeQuality,
} from './scenery-cloud-volume';
import { sceneryDefaults, SceneryCloudVolumeProps } from './scenery-model';
import { SceneryRegistryContext } from './scenery-registry';

// Without layers of its own or a Weather's.
const DEFAULT_LAYERS: CloudLayer[] = weatherPreset('scattered').clouds ?? [];
// Drawn after the scenery's sea's surface (at its renderOrder + 1).
const AFTER_SURFACE = 2;
const NO_DEBUG = {};

const scratch = new Color();
const toHex = (value: ColorRepresentation) => scratch.set(value).getHex();

/**
 * 3D clouds over a {@link Scenery}'s sky (see {@link SceneryCloudVolumeProps} and
 * `documents/clouds.md`): one layer of a local weather — separate cumulus, or soft strato veils
 * drawn out along the wind — marched through on the globe every frame at a share of the
 * screen's resolution and drawn over the scene, so what lies in front of them hides them and
 * they hide what lies behind. Fixed to the Earth, drifting with the layer's wind on the
 * enclosing `Weather`'s clock. Anywhere under the `Scenery`; it compiles its own programs and
 * draws its noise, and shows once they are ready.
 *
 * Being rebuilt (2026-11-08): only the low level's layer of a local weather is drawn, and the
 * scenery's bakes, its sea, its light and its shadows take none of it.
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
  scale = sceneryDefaults.cloudVolume.scale,
  density = sceneryDefaults.cloudVolume.density,
  color = sceneryDefaults.cloudVolume.color,
  seed = sceneryDefaults.cloudVolume.seed,
  quality = sceneryDefaults.cloudVolume.quality,
  resolution,
  debug = NO_DEBUG,
  soft,
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
  // The low level's layer, of a type drawn.
  const [low, ...others] = cloudLayersByLevel(own);
  const drawn = low && cloudVolumeFormOf(low.type) ? low : null;
  const layerKey = local && drawn ? JSON.stringify(drawn) : '';
  const left = (low && !drawn ? 1 : 0) + others.filter(layer => layer).length;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!localKey)
      console.warn(
        'SceneryCloudVolume draws no global weather while it is rebuilt: give the Weather `local`',
      );
    else if (left > 0)
      console.warn(
        `SceneryCloudVolume draws the low level's cumulus or strato alone while it is rebuilt: ${left} layer(s) left out`,
      );
  }, [localKey, left]);
  const windSpeed = weather?.wind?.speed;
  const windFrom = weather?.wind?.from;
  const debugView = debug.view;
  const debugAir = debug.air;
  const softKey = soft
    ? JSON.stringify({
        ...sceneryDefaults.cloudVolume.soft,
        ...(soft === true ? {} : soft),
      })
    : '';

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
      layer: layerKey ? (JSON.parse(layerKey) as CloudLayer) : null,
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
      soft: softKey ? JSON.parse(softKey) : null,
      debug: { view: debugView, air: debugAir },
    });
  }, [
    volume,
    layerKey,
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
    softKey,
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
