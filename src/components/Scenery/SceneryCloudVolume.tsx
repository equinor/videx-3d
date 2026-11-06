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
  cloudLayersOf,
  weatherPreset,
  weatherSystemsOf,
  type CloudLayer,
  type CloudLevel,
} from '../../sdk/weather/weather';
import { WeatherClock } from '../../sdk/weather/weather-clock';
import { useWeather, useWeatherClock } from '../Weather/weather-context';
import { useWorldRelief } from '../World/world-relief';
import {
  CloudVolumeRenderer,
  cloudVolumeQuality,
} from './scenery-cloud-volume';
import { sceneryDefaults, SceneryCloudVolumeProps } from './scenery-model';
import { SceneryRegistryContext } from './scenery-registry';

// Without layers of its own or a Weather's.
const DEFAULT_LAYERS: CloudLayer[] = weatherPreset('scattered').clouds ?? [];
// Drawn after the scenery's sea's surface (at its renderOrder + 1).
const AFTER_SURFACE = 2;

const scratch = new Color();
const toHex = (value: ColorRepresentation) => scratch.set(value).getHex();

/**
 * 3D clouds over a {@link Scenery}'s sky (see {@link SceneryCloudVolumeProps} and
 * `documents/clouds.md`): its layers of cumulus and stratus, marched through on the globe at a
 * share of the screen's resolution and drawn over the scene, so what lies in front of them
 * hides them and they hide what lies behind. The same field from sea level to space, fixed to
 * the Earth; some hundreds of kilometres from the scene, the weather systems' cover over the
 * whole Earth. Its layers, the wind that lines its cumulus up into streets and the weather
 * systems are the enclosing `Weather`'s unless given. Over the ground of the enclosing `World`'s
 * `GeoRelief` they rise over high ground, gather on windward slopes and part in the lee, and the
 * ground stands in them (`terrain`). Anywhere under the `Scenery`; it
 * compiles its own programs and draws its noise and its map of the weather systems, and shows
 * once they are ready.
 *
 * @example
 * <Weather weather={weatherPreset('broken', 'cumulus')}>
 *   <Scenery>
 *     <SceneryCloudVolume />
 *   </Scenery>
 * </Weather>
 *
 * @example
 * // Its own layers, by name, whatever the weather's
 * <SceneryCloudVolume layers="overcast stratus" />
 *
 * @group Components
 */
export const SceneryCloudVolume = ({
  enabled = true,
  layers,
  levels = CLOUD_LEVELS,
  systems,
  scale = sceneryDefaults.cloudVolume.scale,
  density = sceneryDefaults.cloudVolume.density,
  color = sceneryDefaults.cloudVolume.color,
  seed = sceneryDefaults.cloudVolume.seed,
  quality = sceneryDefaults.cloudVolume.quality,
  resolution,
  steps,
  temporal = sceneryDefaults.cloudVolume.temporal,
  terrain = sceneryDefaults.cloudVolume.terrain,
}: SceneryCloudVolumeProps) => {
  const registry = useContext(SceneryRegistryContext);
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const camera = useThree(state => state.camera);
  const weather = useWeather();
  // The World's relief's tiles, for the ground the clouds lie over.
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
      releaseMaterial(gl, volume.resolveMaterial);
      releaseMaterial(gl, volume.compositeMaterial);
      volume.dispose(material => releaseMaterial(gl, material));
    },
    [gl, volume],
  );

  // The ground: none while off, or without a relief.
  const terrainSource = terrain ? loader : null;
  useEffect(() => {
    volume?.terrain.setSource(terrainSource);
  }, [volume, terrainSource]);

  // For the light: in the scenery's bakes of the air and its sea's reflection, as seen from
  // the scene, and the share of its light they let through (ScenerySkyOverlay).
  useLayoutEffect(() => {
    if (!registry || !volume) return;
    const overlay = registry.overlay;
    overlay.current = volume;
    return () => {
      if (overlay.current === volume) overlay.current = null;
    };
  }, [registry, volume]);

  // Inline arrays and colours, compared by value.
  const colorHex = toHex(color);
  // The weather systems: the strength given here, else the weather's; their seed the
  // weather's, else the clouds' own.
  const weatherSystems = weatherSystemsOf(weather, {
    strength: systems,
    seed: weather?.systems?.seed ?? seed,
  });
  const strength = weatherSystems.strength;
  const mapSeed = weatherSystems.seed;
  const own =
    (typeof layers === 'string' ? cloudLayersOf(layers) : layers) ??
    weather?.clouds ??
    DEFAULT_LAYERS;
  const layersKey = JSON.stringify(own);
  // One layer a level is drawn: the others are left out.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const given = JSON.parse(layersKey) as CloudLayer[];
    const drawn = cloudLayersByLevel(given).filter(layer => layer).length;
    if (drawn < given.length)
      console.warn(
        `SceneryCloudVolume draws one layer at each level (low, mid, high): ${given.length - drawn} left out`,
      );
  }, [layersKey]);
  const windSpeed = weather?.wind?.speed;
  const windFrom = weather?.wind?.from;
  // In the order of CLOUD_LEVELS, compared by value.
  const levelsKey = CLOUD_LEVELS.filter(level => levels.includes(level)).join(
    ',',
  );
  useLayoutEffect(() => {
    volume?.set({
      layers: JSON.parse(layersKey) as CloudLayer[],
      levels: levelsKey ? (levelsKey.split(',') as CloudLevel[]) : [],
      systems: strength,
      wind:
        windSpeed === undefined || windFrom === undefined
          ? null
          : { speed: windSpeed, from: windFrom },
      scale,
      density,
      color: new Color(colorHex),
      seed,
      quality: cloudVolumeQuality(quality, { resolution, steps }),
      temporal,
    });
  }, [
    volume,
    layersKey,
    levelsKey,
    strength,
    windSpeed,
    windFrom,
    scale,
    density,
    colorHex,
    seed,
    quality,
    resolution,
    steps,
    temporal,
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
      ...volume.mapGenerators(gl).map(generator =>
        precompile(gl, generator, camera, scene, 'offscreen', {
          priority: PRECOMPILE_PRIORITY.background,
        }),
      ),
      precompile(gl, volume.terrain.generator, camera, scene, 'offscreen', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      precompile(gl, volume.march, camera, scene, 'offscreen', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      precompile(gl, volume.shadowMesh, camera, scene, 'offscreen', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      precompile(gl, volume.resolve, camera, scene, 'offscreen', {
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

  // As the scenery's own clouds' layer is shown: where the camera's zone shows the sky. Once
  // its programs are ready, and while enabled, its terrain is drawn as it comes in and its map
  // of the weather systems a few strips a frame (once the terrain's Earth is in), and it shows
  // once there is one: on the screen, and as seen from the scene for the light. They drift and
  // change on the Weather's clock, without one on their own. Off, none of it is drawn; on
  // again, the map is drawn anew once the weather has moved on from it.
  const weatherClock = useWeatherClock();
  const [ownClock] = useState(() => new WeatherClock());
  useFrame((_, delta) => {
    if (!volume || !registry) return;
    volume.time = (weatherClock ?? ownClock).time;
    const drawing = ready && enabled;
    if (drawing) volume.updateTerrain(gl, camera);
    const mapped = drawing && volume.bakeMap(gl, mapSeed);
    const shown = mapped && volume.cloudy;
    volume.filmable = shown;
    volume.updateLight(delta);
    volume.updateFilm();
    volume.updateShadow(gl, camera);
    volume.updateReflection();
    volume.composite.renderOrder = registry.view.renderOrder + AFTER_SURFACE;
    volume.composite.visible = shown && registry.view.clouds;
  });

  return volume ? <primitive object={volume.composite} dispose={null} /> : null;
};
