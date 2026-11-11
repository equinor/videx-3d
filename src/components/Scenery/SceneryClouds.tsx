import { useFrame, useThree } from '@react-three/fiber';
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { Color, ColorRepresentation, Scene } from 'three';
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
  CLOUDS_LOOKS,
  cloudsChainLayer,
  CloudsRenderer,
  cloudsQuality,
  type CloudsGlobal,
  type CloudsLevel,
  type CloudsLook,
} from './scenery-clouds';
import { sceneryDefaults, SceneryCloudsProps } from './scenery-model';
import { SceneryRegistryContext } from './scenery-registry';

// Without layers of its own or a Weather's: a few high clouds, hiding little of the scene.
const DEFAULT_LAYERS: CloudLayer[] = cloudLayersOf('few-high');
// Drawn after the scenery's sea's surface (at its renderOrder + 1).
const AFTER_SURFACE = 2;
const NO_DEBUG = {};
// A level covering less than this is left out.
const LEAST_COVER = 0.005;
const ALL_LEVELS = {};

// The scene its own passes are compiled for: like those they are drawn in (the march's, the
// film's, its maps'), without lights. three keys a program on the lights of the scene it is
// compiled for, ShaderMaterials too: compiled for the host's scene (a sun, a light probe), each
// pass was compiled twice, the second time as it was first drawn, standing the page for seconds.
const OWN_SCENE = new Scene();

const scratch = new Color();
const toHex = (value: ColorRepresentation) => scratch.set(value).getHex();

/**
 * 3D clouds over a {@link Scenery}'s sky (see {@link SceneryCloudsProps} and
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
 *     <SceneryClouds />
 *   </Scenery>
 * </Weather>
 *
 * @example
 * // Its own layer, by name, whatever the weather's: local
 * <SceneryClouds layers="overcast stratus" />
 *
 * @group Components
 */
export const SceneryClouds = ({
  enabled = true,
  layers,
  dominance = sceneryDefaults.clouds.dominance,
  looks,
  levels: levelsOn = ALL_LEVELS,
  scale = sceneryDefaults.clouds.scale,
  density = sceneryDefaults.clouds.density,
  color = sceneryDefaults.clouds.color,
  seed = sceneryDefaults.clouds.seed,
  quality = sceneryDefaults.clouds.quality,
  resolution,
  debug = NO_DEBUG,
  terrain = sceneryDefaults.clouds.terrain,
  lightMap = sceneryDefaults.clouds.lightMap,
  temporal = sceneryDefaults.clouds.temporal,
}: SceneryCloudsProps) => {
  const registry = useContext(SceneryRegistryContext);
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const camera = useThree(state => state.camera);
  const weather = useWeather();
  // The World's relief: the ground the clouds lie over.
  const loader = useWorldRelief()?.loader ?? null;

  useEffect(() => {
    if (!registry && import.meta.env.DEV)
      console.warn('SceneryClouds draws nothing outside a Scenery');
  }, [registry]);

  const volume = useMemo(
    () =>
      registry
        ? new CloudsRenderer(
            registry.material,
            registry.view.renderOrder + AFTER_SURFACE,
          )
        : null,
    [registry],
  );
  // For the scene's light: in the scenery's bakes of the air and its sea's reflection, as seen
  // from the scene, the share of its light they let through, and their shadows
  // (ScenerySkyOverlay).
  useEffect(() => {
    if (!registry || !volume) return;
    const overlay = registry.overlay;
    overlay.current = volume;
    return () => {
      if (overlay.current === volume) overlay.current = null;
    };
  }, [registry, volume]);
  useEffect(
    () => () => {
      if (!volume) return;
      // Let go once their programs have linked (`releaseMaterial`).
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
  useEffect(() => {
    if (volume) volume.temporal = temporal;
  }, [volume, temporal]);

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
    (Object.keys(CLOUDS_LOOKS) as CloudType[]).map(type => [
      type,
      { ...CLOUDS_LOOKS[type], ...looks?.[type] },
    ]),
  ) as Record<CloudType, CloudsLook>;
  // Local: one layer a level, in proportion, each drawn as its type looks. Global: each level
  // on, over its chain's heights, its cover the weather systems'.
  const levels: CloudsLevel[] = local
    ? cloudLayersInProportion(cloudLayersByLevel(own), dominance)
        .filter(
          (layer): layer is CloudLayer => !!layer && layer.cover >= LEAST_COVER,
        )
        .map(layer => ({ layer, look: allLooks[layer.type] }))
    : CLOUD_LEVELS.filter(level => levelsOn[level] !== false).map(level => {
        const layer = cloudsChainLayer(level);
        return { layer, look: allLooks[layer.type] };
      });
  const levelsKey = JSON.stringify(levels);
  const looksKey = JSON.stringify(allLooks);
  const global: CloudsGlobal | null = local
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
      OWN_SCENE,
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
  }, [gl, camera, volume, lightMap]);
  const lit = lightMap && lightReady;

  // The mode drawn, local or global: switched once the other mode's programs (the march's, its
  // film's and its shadows', and a global weather's maps') are compiled off the main thread, the
  // clouds drawn as they were meanwhile. Compiled by the first frame drawn with them, they stood
  // the page for 9–13 s on Iris Xe.
  const mode = global ? 'global' : 'local';
  const [drawnMode, setDrawnMode] = useState(mode);
  useLayoutEffect(() => {
    if (!volume || mode === drawnMode) return;
    let current = true;
    const meshes = [
      ...volume.programsOf(mode === 'global'),
      ...(mode === 'global' ? volume.weatherGenerators(gl) : []),
    ];
    const waits = meshes
      .map(mesh => precompile(gl, mesh, camera, OWN_SCENE, 'offscreen'))
      .filter(wait => wait !== null);
    const done = () => {
      if (current) setDrawnMode(mode);
    };
    if (waits.length === 0) done();
    else Promise.all(waits).then(done);
    return () => {
      current = false;
    };
  }, [gl, camera, volume, mode, drawnMode]);

  useLayoutEffect(() => {
    if (!volume || mode !== drawnMode) return;
    const place = localKey
      ? (JSON.parse(localKey) as {
          latitude?: number;
          longitude?: number;
          radius: number;
        })
      : { radius: WEATHER_LOCAL_RADIUS };
    volume.set({
      levels: JSON.parse(levelsKey) as CloudsLevel[],
      looks: JSON.parse(looksKey) as Record<CloudType, CloudsLook>,
      global: globalKey ? (JSON.parse(globalKey) as CloudsGlobal) : null,
      local: place,
      wind:
        windSpeed === undefined || windFrom === undefined
          ? null
          : { speed: windSpeed, from: windFrom },
      scale,
      density,
      color: new Color(colorHex),
      seed,
      quality: cloudsQuality(quality, { resolution }),
      lightMap: lit,
      debug: {
        view: debugView,
        air: debugAir,
        steer: debugSteer,
      },
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
    mode,
    drawnMode,
  ]);

  // Hidden until its programs are compiled: drawn before, the browser waits for them.
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    if (!volume) return;
    let current = true;
    setReady(false);
    const noise = volume.noise(gl);
    const waits = [
      precompile(gl, noise.generator, camera, OWN_SCENE, 'offscreen', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      precompile(gl, volume.terrain.generator, camera, OWN_SCENE, 'offscreen', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      ...volume.weatherGenerators(gl).map(generator =>
        precompile(gl, generator, camera, OWN_SCENE, 'offscreen', {
          priority: PRECOMPILE_PRIORITY.background,
        }),
      ),
      precompile(gl, volume.march, camera, OWN_SCENE, 'offscreen', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      precompile(gl, volume.coverGenerator(), camera, OWN_SCENE, 'offscreen', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      precompile(gl, volume.placeGenerator(), camera, OWN_SCENE, 'offscreen', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      precompile(gl, volume.composite, camera, scene, 'scene', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      precompile(gl, volume.still, camera, OWN_SCENE, 'offscreen', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      precompile(gl, volume.filmMesh, camera, OWN_SCENE, 'offscreen', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      precompile(gl, volume.rebuild, camera, OWN_SCENE, 'offscreen', {
        priority: PRECOMPILE_PRIORITY.background,
      }),
      precompile(gl, volume.shadowMesh, camera, OWN_SCENE, 'offscreen', {
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
  useFrame((state, delta) => {
    if (!volume || !registry) return;
    const clock = weatherClock ?? ownClock;
    volume.time = clock.time;
    volume.rate = clock.paused ? 0 : clock.timeScale;
    volume.composite.renderOrder = registry.view.renderOrder + AFTER_SURFACE;
    const drawn = ready && enabled && volume.cloudy;
    volume.composite.visible = drawn && registry.view.clouds;
    // Its ground drawn as it comes in, and asked for about the camera as it moves.
    if (drawn) volume.updateTerrain(gl, state.camera);
    // The scene's light: what is filmed of them, the share of the light they let through, their
    // shadows and what the sea reflects of them.
    volume.filmable = drawn;
    volume.updateLight(gl, delta);
    volume.updateFilm();
    volume.updateShadow(gl, state.camera);
    volume.updateReflection();
  });

  return volume ? <primitive object={volume.composite} dispose={null} /> : null;
};
