import { useFrame, useThree } from '@react-three/fiber';
import {
  ForwardedRef,
  forwardRef,
  ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BufferGeometry,
  Group,
  type Intersection,
  Mesh,
  Raycaster,
  Vector3,
} from 'three';
import { CommonComponentProps, CustomMaterialProps } from '../../common/types';
import { useCameraProbe } from '../../hooks/useCameraSite';
import {
  CAMERA_PROBE_ORDER,
  type CameraProbe,
  reportCameraWater,
} from '../../sdk/utils/camera-site';
import type { WaterQuality } from '../../sdk/weather/sea-state';
import { useWeatherWind } from '../Weather/useWeatherWind';
import { useWeatherWaves } from '../Weather/useWeatherWaves';
import { useWeatherStep } from '../Weather/useWeatherStep';
import { BedMaterial } from './bed-material';
import {
  applyBedProps,
  applyWaterBodyProps,
  applyWaterSettings,
  BedProps,
  DeprecatedBedProps,
  WaterBodyProps,
  WaterSettings,
} from './water-settings';
import {
  createWaterContactRegistry,
  WaterContactContext,
} from './water-contact';
import { WaterMaterial } from './water-material';
import { createWaterSampler, WaterSamplerContext } from './water-sampler';
import { WaterVolumeMaterial } from './water-volume-material';

/**
 * Water props
 * @expand
 */
export type WaterProps = CommonComponentProps &
  CustomMaterialProps &
  WaterSettings &
  WaterBodyProps &
  BedProps &
  DeprecatedBedProps & {
    /**
     * Geometry to render as the ocean surface. Typically a large plane lying in
     * the world X/Z plane at sea level (e.g. `createWaterBox(...).surface`). All
     * wave/foam animation is evaluated in world coordinates, so tiled/patched
     * geometry aligns seamlessly.
     */
    geometry: BufferGeometry;
    /**
     * Optional water-body (side walls) geometry, e.g.
     * `createWaterBox(...).body`. When provided, it is rendered as a separate,
     * double-sided, transparent-blue volume mesh so the water reads as a body.
     */
    bodyGeometry?: BufferGeometry;
    /**
     * Optional sea-bed geometry, e.g. `createWaterBox(...).bed`. When provided,
     * it is rendered as a separate sun-shaded mesh below the surface.
     */
    bedGeometry?: BufferGeometry;
    /**
     * How much of the sea it draws: `low` three coarse layers, the mean's roughness everywhere
     * (no gusts or slicks) and no light through the crests; `medium` (the default, sized for a
     * mid-range laptop) four layers; `high` the detail octave below them, the sun's glitter,
     * the whitecaps' life and the waves filtered along the view (sharper toward the horizon);
     * `ultra` three times the waves a layer (`WATER_QUALITY`, `WATER_QUALITY_DEFINES`).
     * ⚠️ Compile-time: another quality is another material.
     */
    quality?: WaterQuality;
    /** @deprecated the waves are a sea state's layers (`quality`); ignored */
    waveCount?: number;
    /** Octaves of the shore's ragged edge noise (compile-time). */
    detailOctaves?: number;
    /** Master opacity multiplier (also drives OIT routing). */
    opacity?: number;
    /** Toggles visibility of the water-surface mesh. Default `true`. */
    surfaceVisible?: boolean;
    /**
     * Toggles visibility of the water-body (side walls) mesh. Only has an effect
     * when `bodyGeometry` is provided. Default `true`.
     */
    bodyVisible?: boolean;
    /**
     * Toggles visibility of the sea-bed mesh. Only has an effect when
     * `bedGeometry` is provided. Default `true`.
     */
    bedVisible?: boolean;
    /** Debug: render all ocean materials (surface, body, sea bed) as wireframe. */
    wireframe?: boolean;
    /**
     * Children rendered inside the ocean's group, in its local frame. They
     * receive an {@link WaterSampler} via context (see `useWaterSampler` /
     * `useBuoyancy`) so floating objects (e.g. a vessel) can follow the waves.
     */
    children?: ReactNode;
  };

/**
 * Stylized animated ocean surface.
 *
 * Renders the provided geometry as a procedurally animated, OIT-compatible
 * water surface. Its waves are a sea state's (`SeaState`): a North-Sea JONSWAP
 * spectrum for the wind (m/s) and swells, which a change of wind eases toward
 * rather than rewrites, drawn from a few layers baked each frame and read so they
 * never repeat, all in world X/Z space so the pattern is continuous across tiled
 * patches. Each layer is filtered to the pixel, so there is no visible LOD ring,
 * and floating children ride the same waves. Transparency is Fresnel-driven
 * (see-through looking down, reflective at grazing angles) and composites
 * correctly with the other transparent subsurface geometry through the
 * OITRenderPass.
 *
 * @example
 * <Water geometry={planeGeometry} windDirection={[1, 0.3]} windSpeed={10} />
 *
 * @group Components
 */
export const Water = forwardRef(
  (
    {
      geometry,
      bodyGeometry,
      bedGeometry,
      windDirection,
      windSpeed,
      gusts,
      amplitude,
      swells,
      waveTuning,
      foamTuning,
      directionalSpread,
      steepness,
      displacement,
      quality = 'medium',
      detailOctaves = 4,
      optics,
      deepColor,
      shallowColor,
      waterOpacity,
      tonalVariation,
      tonalScale,
      tonalSharpness,
      tonalColor,
      skyColor,
      horizonColor,
      reflectionIntensity,
      sunDirection,
      sunColor,
      sunShininess,
      foamColor,
      foamAmount,
      fresnelPower,
      sparkle,
      crestLight,
      foamLife,
      detailScale,
      detailStrength,
      bedColor,
      bedWaterTint,
      bedOpacity,
      bedDuneStrength,
      bedDuneWavelength,
      bedDuneDirection,
      bedDuneSharpness,
      seaBedColor,
      seaBedWaterTint,
      seaBedOpacity,
      seaBedDuneStrength,
      seaBedDuneWavelength,
      seaBedDuneDirection,
      seaBedDuneSharpness,
      bodyFogDensity,
      bodyMaxOpacity,
      bodyShimmer,
      opacity = 1,
      surfaceVisible = true,
      bodyVisible = true,
      bedVisible = true,
      wireframe = false,
      children,
      name,
      userData,
      renderOrder,
      layers,
      position,
      visible = true,
      castShadow,
      receiveShadow,
      customMaterial,
      onMaterialPropertiesChange,
    }: WaterProps,
    fref: ForwardedRef<Group>,
  ) => {
    const ref = useRef<Group>(null);

    useImperativeHandle(fref, () => ref.current!);

    // Its own wind and swells where given, the enclosing Weather's for what it leaves out.
    const wind = useWeatherWind(windSpeed, windDirection, gusts, swells);
    const seaWindSpeed = wind.windSpeed;
    const seaWindDirection = wind.windDirection;
    const seaGusts = wind.gusts;
    const seaSwells = wind.swells;

    const material = useMemo(() => {
      if (customMaterial) return customMaterial;
      return new WaterMaterial({ quality, detailOctaves });
    }, [customMaterial, quality, detailOctaves]);
    // Leaving its waves to the weather, it draws the weather's sea.
    useWeatherWaves(material instanceof WaterMaterial ? material : null, {
      windSpeed,
      windDirection,
      swells,
      amplitude,
      waveTuning,
    });

    // Optional water-body (side walls) material — a separate mesh so it routes
    // through OIT independently of the surface and sea bed.
    const volumeMaterials = useMemo(
      () => (bodyGeometry ? [new WaterVolumeMaterial()] : null),
      [bodyGeometry],
    );

    // Optional sea-bed material — a separate mesh so an opaque bed (opacity 1)
    // routes through the opaque pass and occludes geometry below it, while a
    // translucent bed routes through OIT without affecting the water.
    const bedMaterial = useMemo(
      () => (bedGeometry ? new BedMaterial() : null),
      [bedGeometry],
    );

    // Live wave-height sampler shared with floating children via context, so
    // they can follow the same animated surface that is rendered. Only the
    // library material exposes the spectral wave tables; a custom material does
    // not, so no sampler is provided in that case.
    const sampler = useMemo(
      () =>
        material instanceof WaterMaterial ? createWaterSampler(material) : null,
      [material],
    );

    // Registry of floating children that contribute contact-foam footprints.
    // Children register a source via WaterContactContext (see useWaterContact);
    // their footprints are collected and uploaded to the material each frame.
    const contactRegistry = useMemo(createWaterContactRegistry, []);
    // The camera in the ocean's own frame, where its floating children report their footprints.
    const [viewFrom] = useState(() => new Vector3());
    const [lookFrom] = useState(() => new Vector3());
    // The surface's height in that frame: how high the camera is over it.
    const surfaceY = useMemo(() => {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      return (box.min.y + box.max.y) / 2;
    }, [geometry]);

    // The water under the surface (WaterMaterial.water): how far down its seabed lies, the
    // deepest of its bed's or its body's; none, endless.
    const water = material instanceof WaterMaterial ? material.water : null;
    const floor = bedGeometry ?? bodyGeometry;
    // Layout effects, as the syncs below: R3F may draw a frame between React's commit and its
    // passive effects, which would show the parts unlinked and on their defaults.
    useLayoutEffect(() => {
      if (!water) return;
      if (!floor) {
        water.depth = Infinity;
        return;
      }
      if (!floor.boundingBox) floor.computeBoundingBox();
      water.depth = Math.max(surfaceY - floor.boundingBox!.min.y, 0);
    }, [water, floor, surfaceY]);

    // Where the camera is at this water (the camera site's): over its footprint, how deep,
    // whether in it; and the water synced to it before the frame, so what draws before the
    // surface (its bed and walls, data in it) has this frame's.
    const surfaceMesh = useRef<Mesh>(null);
    const scene = useThree(state => state.scene);
    const waterProbe = useCallback<CameraProbe>(
      (site, camera) => {
        const mesh = surfaceMesh.current;
        if (!(material instanceof WaterMaterial) || !mesh) return;
        mesh.updateWorldMatrix(true, false);
        reportCameraWater(
          site,
          material.syncWater(scene, camera, mesh.geometry, mesh),
        );
      },
      [material, scene],
    );
    const cameraSite = useCameraProbe(waterProbe, CAMERA_PROBE_ORDER.water);

    // The bed under the camera (WaterMaterial.cameraFloor): straight down onto it from over the
    // water, as drawn. Under it, the camera is in the ground, not in the water.
    const bedMesh = useRef<Mesh>(null);
    const [bedRay] = useState(() => ({
      raycaster: new Raycaster(),
      hits: [] as Intersection[],
      from: new Vector3(),
      down: new Vector3(0, -1, 0),
    }));
    useLayoutEffect(() => {
      if (!(material instanceof WaterMaterial)) return;
      material.cameraFloor = eye => {
        const mesh = bedMesh.current;
        if (!mesh) return null;
        mesh.updateWorldMatrix(true, false);
        const { raycaster, hits, from, down } = bedRay;
        raycaster.set(from.set(eye.x, material.water.level + 1, eye.z), down);
        hits.length = 0;
        raycaster.intersectObject(mesh, false, hits);
        return hits.length ? hits[0].point.y : null;
      };
      return () => {
        material.cameraFloor = null;
      };
    }, [material, bedRay]);

    // Sync prop-driven uniforms onto the material.
    useLayoutEffect(() => {
      if (!(material instanceof WaterMaterial)) {
        onMaterialPropertiesChange?.(
          {
            windDirection: seaWindDirection,
            windSpeed: seaWindSpeed,
            amplitude,
            swells: seaSwells,
            directionalSpread,
            steepness,
            displacement,
            deepColor,
            shallowColor,
            waterOpacity,
            tonalVariation,
            tonalScale,
            tonalSharpness,
            tonalColor,
            skyColor,
            horizonColor,
            reflectionIntensity,
            sunDirection,
            sunColor,
            sunShininess,
            foamColor,
            foamAmount,
            fresnelPower,
            detailScale,
            detailStrength,
            opacity,
          },
          material,
        );
        return;
      }

      applyWaterSettings(material, {
        windDirection: seaWindDirection,
        windSpeed: seaWindSpeed,
        gusts: seaGusts,
        amplitude,
        swells: seaSwells,
        waveTuning,
        foamTuning,
        directionalSpread,
        steepness,
        displacement,
        optics,
        bodyFogDensity,
        deepColor,
        shallowColor,
        waterOpacity,
        tonalVariation,
        tonalScale,
        tonalSharpness,
        tonalColor,
        skyColor,
        horizonColor,
        reflectionIntensity,
        sunDirection,
        sunColor,
        sunShininess,
        foamColor,
        foamAmount,
        fresnelPower,
        sparkle,
        crestLight,
        foamLife,
        detailScale,
        detailStrength,
        opacity,
      });
    }, [
      material,
      seaWindDirection,
      seaWindSpeed,
      seaGusts,
      amplitude,
      seaSwells,
      waveTuning,
      foamTuning,
      directionalSpread,
      steepness,
      displacement,
      optics,
      bodyFogDensity,
      deepColor,
      shallowColor,
      waterOpacity,
      tonalVariation,
      tonalScale,
      tonalSharpness,
      tonalColor,
      skyColor,
      horizonColor,
      reflectionIntensity,
      sunDirection,
      sunColor,
      sunShininess,
      foamColor,
      foamAmount,
      fresnelPower,
      sparkle,
      crestLight,
      foamLife,
      detailScale,
      detailStrength,
      opacity,
      onMaterialPropertiesChange,
    ]);

    // Sync prop-driven uniforms onto the grouped (water-body + sea-bed) materials.
    useLayoutEffect(() => {
      for (const volumeMaterial of volumeMaterials ?? []) {
        applyWaterBodyProps(
          volumeMaterial,
          {
            deepColor,
            shallowColor,
            waterOpacity,
            bodyFogDensity,
            bodyMaxOpacity,
            bodyShimmer,
            opacity,
          },
          material instanceof WaterMaterial ? material : null,
        );
      }
      if (bedMaterial) {
        if (material instanceof WaterMaterial) bedMaterial.linkWater(material);
        applyBedProps(bedMaterial, {
          deepColor,
          waterOpacity,
          sunDirection,
          sunColor,
          bedColor: bedColor ?? seaBedColor,
          bedWaterTint: bedWaterTint ?? seaBedWaterTint,
          bedOpacity: bedOpacity ?? seaBedOpacity,
          bedDuneStrength: bedDuneStrength ?? seaBedDuneStrength,
          bedDuneWavelength: bedDuneWavelength ?? seaBedDuneWavelength,
          bedDuneDirection: bedDuneDirection ?? seaBedDuneDirection,
          bedDuneSharpness: bedDuneSharpness ?? seaBedDuneSharpness,
          opacity,
        });
      }
    }, [
      volumeMaterials,
      bedMaterial,
      material,
      deepColor,
      shallowColor,
      bodyFogDensity,
      bodyMaxOpacity,
      bodyShimmer,
      bedColor,
      bedWaterTint,
      bedOpacity,
      bedDuneStrength,
      bedDuneWavelength,
      bedDuneDirection,
      bedDuneSharpness,
      seaBedColor,
      seaBedWaterTint,
      seaBedOpacity,
      seaBedDuneStrength,
      seaBedDuneWavelength,
      seaBedDuneDirection,
      seaBedDuneSharpness,
      waterOpacity,
      steepness,
      displacement,
      sunDirection,
      sunColor,
      opacity,
    ]);

    // Advance the animation clock: the enclosing Weather's pace.
    const step = useWeatherStep();
    useFrame(({ camera, gl }, delta) => {
      const waveStep = step(delta);
      if (material instanceof WaterMaterial) {
        cameraSite.get(camera);
        // Its waves on the weather's clock while it draws the weather's sea.
        material.step(waveStep);
        // The sky it reflects and the sun it glints with: the scene's, its own where given.
        material.updateSky(gl, scene);
        if (bedMaterial) {
          bedMaterial.sunDirection = material.sunDirection;
          bedMaterial.sunColor = material.sunColor;
        }
        const group = ref.current;
        const view = group
          ? group.worldToLocal(viewFrom.copy(camera.position))
          : camera.position;
        // Layers too fine to show from the camera's height are not baked; the whitecaps'
        // life runs about the camera in the surface's wave plane, world X/Z, ahead of it the
        // way it looks.
        const look = camera.getWorldDirection(lookFrom);
        material.renderWaves(
          gl,
          camera,
          view.y - surfaceY,
          { x: camera.position.x, y: camera.position.z },
          { x: look.x, y: look.z },
        );

        // Collect the registered floating-object footprints and upload them as
        // contact foam, the nearest the camera when there are more than it draws.
        // Skipped entirely when nothing is registered, so there is no per-frame
        // cost on an ocean with no floating children.
        contactRegistry.upload(material, { from: view });
      }
      for (const volumeMaterial of volumeMaterials ?? [])
        volumeMaterial.time =
          material instanceof WaterMaterial
            ? material.time
            : volumeMaterial.time + waveStep;
    });

    // Debug: toggle wireframe on every material used by the ocean.
    useEffect(() => {
      const materials = [material, ...(volumeMaterials ?? []), bedMaterial];
      for (const m of materials) {
        if (m && 'wireframe' in m) {
          (m as { wireframe: boolean }).wireframe = wireframe;
        }
      }
    }, [material, volumeMaterials, bedMaterial, wireframe]);

    // Dispose the library-created material on unmount.
    useEffect(() => {
      return () => {
        if (material instanceof WaterMaterial) material.dispose();
      };
    }, [material]);

    // Dispose the library-created grouped materials on unmount.
    useEffect(() => {
      return () => {
        volumeMaterials?.forEach(m => m.dispose());
        bedMaterial?.dispose();
      };
    }, [volumeMaterials, bedMaterial]);

    return (
      <group
        ref={ref}
        name={name}
        userData={userData}
        visible={visible}
        position={position}
      >
        {/*
          Internal draw order, tuned for the default (non-OIT) renderer viewed
          roughly top-down: the parts are transparent, so they must composite
          back-to-front. Looking down, the sea bed is farthest, the side walls
          sit in between, and the water surface is nearest — so draw bed first,
          then body, then surface on top. The caller's `renderOrder` (default 0)
          is the base; the +0/+1/+2 offsets keep the three parts correctly
          ordered relative to each other while still letting the caller push the
          whole water before/after other scene geometry.
        */}
        {bedGeometry && bedMaterial && (
          <mesh
            ref={bedMesh}
            geometry={bedGeometry}
            material={bedMaterial}
            visible={bedVisible}
            castShadow={castShadow}
            receiveShadow={receiveShadow}
            renderOrder={(renderOrder ?? 0) + 0}
            layers={layers}
          />
        )}
        {bodyGeometry && volumeMaterials && (
          <mesh
            geometry={bodyGeometry}
            material={volumeMaterials[0]}
            visible={bodyVisible}
            renderOrder={(renderOrder ?? 0) + 1}
            layers={layers}
          />
        )}
        <mesh
          ref={surfaceMesh}
          geometry={geometry}
          material={material}
          visible={surfaceVisible}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          renderOrder={(renderOrder ?? 0) + 2}
          layers={layers}
        />
        <WaterSamplerContext.Provider value={sampler}>
          <WaterContactContext.Provider value={contactRegistry}>
            {children}
          </WaterContactContext.Provider>
        </WaterSamplerContext.Provider>
      </group>
    );
  },
);
