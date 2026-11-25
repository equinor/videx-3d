import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { IUniform, Vector3, Vector4 } from 'three';
import { releaseMaterial } from '../../rendering/precompile';
import {
  createWaterContactRegistry,
  WaterContactRegistry,
} from '../Water/water-contact';
import {
  applyWaterBodyProps,
  applyWaterSettings,
} from '../Water/water-settings';
import { WaterMaterial } from '../Water/water-material';
import { createWaterSampler, WaterSampler } from '../Water/water-sampler';
import { WaterVolumeMaterial } from '../Water/water-volume-material';
import { useWeatherWind } from '../Weather/useWeatherWind';
import { useWeatherWaves } from '../Weather/useWeatherWaves';
import { useWeatherStep } from '../Weather/useWeatherStep';
import { ZoneDepthMap } from './zone-depth-map';
import { ZoneStackSea } from './zone-defs';
import { ZoneFenceUniforms } from './zone-material';
import { ZONE_MATERIAL_LINGER } from './zone-resources';

// The way the camera looks, for the whitecaps' life.
const lookScratch = new Vector3();

/** What a {@link ZoneStackProps.sea} sea is drawn and sampled with. */
export type StackSeaMaterials = {
  /** the animated sea surface, for the lid */
  surface: WaterMaterial;
  /** the water body, for the walls at the rim and the shoreline */
  volume: WaterVolumeMaterial;
  /**
   * The water body again, UNCUT, for the face that closes it at a section or a
   * fence. `null` when the stack declares no cut.
   *
   * ⚠️ A separate material because the face lies exactly ON the cut: testing it
   * against the very thing it exists to close punches holes along its length. The
   * block's own faces are built the same way.
   */
  face: WaterVolumeMaterial | null;
  /**
   * The wave field, for floating objects. Heights come back ABSOLUTE in the
   * stack's frame (sea level included), so a floater needs no sea-level parent
   * group of its own.
   */
  sampler: WaterSampler;
  /** where floating children register their contact-foam footprints */
  contacts: WaterContactRegistry;
};

/**
 * Create, drive and dispose the ocean materials for a `ZoneStack`'s sea, and
 * with them the two things its floating children need: the wave sampler and the
 * contact-foam registry.
 *
 * ⚠️ The materials are created ONCE and then have their UNIFORMS updated — unlike
 * the rest of a zone's appearance, which is rebuilt on every change so the OIT
 * pass re-classifies it. A sea state is swept continuously, and rebuilding a
 * `ShaderMaterial` recompiles its program.
 *
 * @group Components
 */
export function useStackSea(
  sea: ZoneStackSea | undefined,
  wireframe = false,
  sectionPlane?: IUniform<Vector4>,
  bathymetry?: ZoneDepthMap | null,
  fence?: ZoneFenceUniforms,
  cut = false,
): StackSeaMaterials | null {
  const enabled = !!sea;
  const level = -(sea?.depth ?? 0);
  const gl = useThree(state => state.gl);

  const contacts = useMemo(createWaterContactRegistry, []);
  // Its own wind and swells where given, the enclosing Weather's for what it leaves out.
  const {
    windSpeed: seaWindSpeed,
    windDirection: seaWindDirection,
    gusts: seaGusts,
    swells: seaSwells,
  } = useWeatherWind(
    sea?.windSpeed,
    sea?.windDirection,
    sea?.gusts,
    sea?.swells,
  );

  // ⚠️ The section is a DEFINE, so cutting the sea or leaving it whole means new
  // materials. That is a discrete choice, unlike the sea state, which is swept.
  // ⚠️ The fence is one too; its uniforms carry the live curve, so only turning the
  // cut on or off reaches here.
  // ⚠️ So is the bathymetry, which arrives asynchronously — one rebuild, once.
  const materials = useMemo(() => {
    if (!enabled) return null;
    const surface = new WaterMaterial({
      sectionPlane,
      fence,
      bathymetry: bathymetry ?? undefined,
    });
    // Its water is the stack's own (`ZoneStackContextValue.waterBody`), not the scene's.
    surface.sharesSceneWater = false;
    return {
      surface,
      // A zone's interval wall measures its vertical coordinate in metres, so
      // the walls read their unit-relative height from `wallV` instead.
      volume: new WaterVolumeMaterial({
        wallAttribute: true,
        sectionPlane,
        fence,
      }),
      face: cut ? new WaterVolumeMaterial({ wallAttribute: true }) : null,
    };
  }, [enabled, sectionPlane, fence, bathymetry, cut]);
  // Leaving its waves to the weather, it draws the weather's sea.
  useWeatherWaves(materials?.surface ?? null, {
    windSpeed: sea?.windSpeed,
    windDirection: sea?.windDirection,
    swells: sea?.swells,
    amplitude: sea?.amplitude,
    waveTuning: sea?.waveTuning,
  });

  useEffect(() => {
    if (!materials) return;
    // Let go once their programs have linked, and kept a while for the next build's to take
    // them over (`releaseMaterial`): the bathymetry comes with each build.
    return () => {
      const release = { linger: ZONE_MATERIAL_LINGER };
      releaseMaterial(gl, materials.surface, release);
      releaseMaterial(gl, materials.volume, release);
      if (materials.face) releaseMaterial(gl, materials.face, release);
    };
  }, [gl, materials]);

  useEffect(() => {
    if (!materials || !sea) return;
    const opacity = sea.opacity ?? 1;
    const props = {
      ...sea,
      windSpeed: seaWindSpeed,
      windDirection: seaWindDirection,
      gusts: seaGusts,
      swells: seaSwells,
      opacity,
    };
    applyWaterSettings(materials.surface, props);
    // The bed grid is in the stack's frame, so the level it is measured against
    // has to be too.
    materials.surface.waterLevel = level;
    // The body shares the surface's sea layers by reference, so its top edge
    // follows the same swells.
    applyWaterBodyProps(materials.volume, props, materials.surface);
    if (materials.face)
      applyWaterBodyProps(materials.face, props, materials.surface);
    materials.surface.wireframe = wireframe;
    materials.volume.wireframe = wireframe;
    if (materials.face) materials.face.wireframe = wireframe;
  }, [
    materials,
    sea,
    seaWindSpeed,
    seaWindDirection,
    seaGusts,
    seaSwells,
    wireframe,
    level,
  ]);

  // The waves at the enclosing Weather's pace.
  const step = useWeatherStep();
  useFrame(({ gl: renderer, scene, camera }, delta) => {
    const waveStep = step(delta);
    if (!materials) return;
    // Its waves on the weather's clock while it draws the weather's sea; its walls with it.
    materials.surface.step(waveStep);
    // The sky it reflects and the sun it glints with: the scene's, its own where given.
    materials.surface.updateSky(renderer, scene);
    // The whitecaps' life about the camera, in the surface's wave plane (world X/Z), from its
    // height over the water's level, ahead of it the way it looks.
    const look = camera.getWorldDirection(lookScratch);
    materials.surface.renderWaves(
      renderer,
      camera,
      camera.position.y - materials.surface.water.level,
      { x: camera.position.x, y: camera.position.z },
      { x: look.x, y: look.z },
    );
    materials.volume.time = materials.surface.time;
    if (materials.face) materials.face.time = materials.surface.time;

    // Collect the registered floating-object footprints and upload them as
    // contact foam. Skipped entirely when nothing is registered, so a sea with no
    // floating children costs nothing per frame.
    contacts.upload(materials.surface);
  });

  return useMemo(
    () =>
      materials
        ? {
            ...materials,
            sampler: createWaterSampler(materials.surface, level),
            contacts,
          }
        : null,
    [materials, level, contacts],
  );
}
