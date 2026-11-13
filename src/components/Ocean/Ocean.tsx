import { useFrame } from '@react-three/fiber';
import {
  ForwardedRef,
  forwardRef,
  ReactNode,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BufferGeometry, Group, Vector3 } from 'three';
import { CommonComponentProps, CustomMaterialProps } from '../../common/types';
import type { SeaQuality } from '../../sdk/weather/sea-state';
import { useWeatherOceanWind } from '../Weather/useWeatherOceanWind';
import { useWeatherStep } from '../Weather/useWeatherStep';
import { OceanBedMaterial } from './ocean-bed-material';
import { OceanDeepMaterial } from './ocean-deep-material';
import {
  applyOceanBedProps,
  applyOceanBodyProps,
  applyOceanWaterProps,
  OceanBedProps,
  OceanBodyProps,
  OceanWaterProps,
} from './ocean-material-sync';
import {
  createOceanContactRegistry,
  OceanContactContext,
} from './ocean-contact';
import { OceanMaterial } from './ocean-material';
import { createOceanSampler, OceanSamplerContext } from './ocean-sampler';
import { OceanVolumeMaterial } from './ocean-volume-material';

/**
 * Ocean props
 * @expand
 */
export type OceanProps = CommonComponentProps &
  CustomMaterialProps &
  OceanWaterProps &
  OceanBodyProps &
  OceanBedProps & {
    /**
     * Geometry to render as the ocean surface. Typically a large plane lying in
     * the world X/Z plane at sea level (e.g. `createOceanBox(...).surface`). All
     * wave/foam animation is evaluated in world coordinates, so tiled/patched
     * geometry aligns seamlessly.
     */
    geometry: BufferGeometry;
    /**
     * Optional water-body (side walls) geometry, e.g.
     * `createOceanBox(...).body`. When provided, it is rendered as a separate,
     * double-sided, transparent-blue volume mesh so the water reads as a body.
     */
    bodyGeometry?: BufferGeometry;
    /**
     * Optional sea-bed geometry, e.g. `createOceanBox(...).bed`. When provided,
     * it is rendered as a separate sun-shaded mesh below the surface.
     */
    bedGeometry?: BufferGeometry;
    /**
     * How much of the sea's waves it draws: `low`, `medium` (the default, sized for a
     * mid-range laptop), `high` (a fourth, finest layer for close up) or `ultra`.
     * ⚠️ Compile-time: another quality is another material.
     */
    quality?: SeaQuality;
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
     * receive an {@link OceanSampler} via context (see `useOceanSampler` /
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
 * <Ocean geometry={planeGeometry} windDirection={[1, 0.3]} windSpeed={10} />
 *
 * @group Components
 */
export const Ocean = forwardRef(
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
      detailScale,
      detailStrength,
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
    }: OceanProps,
    fref: ForwardedRef<Group>,
  ) => {
    const ref = useRef<Group>(null);

    useImperativeHandle(fref, () => ref.current!);

    // Its own wind where given, the enclosing Weather's for what it leaves out.
    const wind = useWeatherOceanWind(windSpeed, windDirection, gusts);
    const seaWindSpeed = wind.windSpeed;
    const seaWindDirection = wind.windDirection;
    const seaGusts = wind.gusts;

    const material = useMemo(() => {
      if (customMaterial) return customMaterial;
      return new OceanMaterial({ quality, detailOctaves });
    }, [customMaterial, quality, detailOctaves]);

    // Optional water-body (side walls) materials — separate meshes so they route
    // through OIT independently of the surface and sea bed. Two parts (OceanVolumeMaterial's
    // `wall`): the water on the inner faces, and the glass's light play on the outer faces,
    // drawn last. Drawn both sides at once without depth writes, a far wall's inner face
    // would paint over the near glass wherever it is drawn later.
    const volumeMaterials = useMemo(
      () =>
        bodyGeometry
          ? [
              new OceanVolumeMaterial({ wall: 'water' }),
              new OceanVolumeMaterial({ wall: 'glass' }),
            ]
          : null,
      [bodyGeometry],
    );

    // Optional sea-bed material — a separate mesh so an opaque bed (opacity 1)
    // routes through the opaque pass and occludes geometry below it, while a
    // translucent bed routes through OIT without affecting the water.
    const seaBedMaterial = useMemo(
      () => (bedGeometry ? new OceanBedMaterial() : null),
      [bedGeometry],
    );

    // Live wave-height sampler shared with floating children via context, so
    // they can follow the same animated surface that is rendered. Only the
    // library material exposes the spectral wave tables; a custom material does
    // not, so no sampler is provided in that case.
    const sampler = useMemo(
      () =>
        material instanceof OceanMaterial ? createOceanSampler(material) : null,
      [material],
    );

    // Registry of floating children that contribute contact-foam footprints.
    // Children register a source via OceanContactContext (see useOceanContact);
    // their footprints are collected and uploaded to the material each frame.
    const contactRegistry = useMemo(createOceanContactRegistry, []);
    // The camera in the ocean's own frame, where its floating children report their footprints.
    const [viewFrom] = useState(() => new Vector3());
    // The surface's height in that frame: how high the camera is over it.
    const surfaceY = useMemo(() => {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      return (box.min.y + box.max.y) / 2;
    }, [geometry]);

    // The water under the surface (OceanMaterial.water): how far down its seabed lies, the
    // deepest of its bed's or its body's; none, endless.
    const water = material instanceof OceanMaterial ? material.water : null;
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
    // The deep water where nothing else lies under the surface: on the far plane, under all.
    const deepMaterial = useMemo(
      () => (water ? new OceanDeepMaterial(water) : null),
      [water],
    );
    useEffect(() => () => deepMaterial?.dispose(), [deepMaterial]);

    // Sync prop-driven uniforms onto the material.
    useLayoutEffect(() => {
      if (!(material instanceof OceanMaterial)) {
        onMaterialPropertiesChange?.(
          {
            windDirection: seaWindDirection,
            windSpeed: seaWindSpeed,
            amplitude,
            swells,
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

      applyOceanWaterProps(material, {
        windDirection: seaWindDirection,
        windSpeed: seaWindSpeed,
        gusts: seaGusts,
        amplitude,
        swells,
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
      swells,
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
      detailScale,
      detailStrength,
      opacity,
      onMaterialPropertiesChange,
    ]);

    // Sync prop-driven uniforms onto the grouped (water-body + sea-bed) materials.
    useLayoutEffect(() => {
      for (const volumeMaterial of volumeMaterials ?? []) {
        applyOceanBodyProps(
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
          material instanceof OceanMaterial ? material : null,
        );
      }
      if (seaBedMaterial) {
        if (material instanceof OceanMaterial)
          seaBedMaterial.linkWater(material);
        applyOceanBedProps(seaBedMaterial, {
          deepColor,
          waterOpacity,
          sunDirection,
          sunColor,
          seaBedColor,
          seaBedWaterTint,
          seaBedOpacity,
          seaBedDuneStrength,
          seaBedDuneWavelength,
          seaBedDuneDirection,
          seaBedDuneSharpness,
          opacity,
        });
      }
    }, [
      volumeMaterials,
      seaBedMaterial,
      material,
      deepColor,
      shallowColor,
      bodyFogDensity,
      bodyMaxOpacity,
      bodyShimmer,
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
      if (material instanceof OceanMaterial) {
        material.time += waveStep;
        const group = ref.current;
        const view = group
          ? group.worldToLocal(viewFrom.copy(camera.position))
          : camera.position;
        // Layers too fine to show from the camera's height are not baked.
        material.renderWaves(gl, camera, view.y - surfaceY);

        // Collect the registered floating-object footprints and upload them as
        // contact foam, the nearest the camera when there are more than it draws.
        // Skipped entirely when nothing is registered, so there is no per-frame
        // cost on an ocean with no floating children.
        contactRegistry.upload(material, { from: view });
      }
      for (const volumeMaterial of volumeMaterials ?? [])
        volumeMaterial.time += waveStep;
    });

    // Debug: toggle wireframe on every material used by the ocean.
    useEffect(() => {
      const materials = [material, ...(volumeMaterials ?? []), seaBedMaterial];
      for (const m of materials) {
        if (m && 'wireframe' in m) {
          (m as { wireframe: boolean }).wireframe = wireframe;
        }
      }
    }, [material, volumeMaterials, seaBedMaterial, wireframe]);

    // Dispose the library-created material on unmount.
    useEffect(() => {
      return () => {
        if (material instanceof OceanMaterial) material.dispose();
      };
    }, [material]);

    // Dispose the library-created grouped materials on unmount.
    useEffect(() => {
      return () => {
        volumeMaterials?.forEach(m => m.dispose());
        seaBedMaterial?.dispose();
      };
    }, [volumeMaterials, seaBedMaterial]);

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
          whole ocean before/after other scene geometry.
        */}
        {bedGeometry && seaBedMaterial && (
          <mesh
            geometry={bedGeometry}
            material={seaBedMaterial}
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
        {deepMaterial && (
          <mesh
            geometry={geometry}
            material={deepMaterial}
            // Opaque: drawn only while the Ocean is whole, so a faded one shows what is behind.
            visible={surfaceVisible && (opacity ?? 1) >= 1}
            renderOrder={(renderOrder ?? 0) - 1}
            layers={layers}
          />
        )}
        <mesh
          geometry={geometry}
          material={material}
          visible={surfaceVisible}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          renderOrder={(renderOrder ?? 0) + 2}
          layers={layers}
        />
        {bodyGeometry && volumeMaterials && (
          // The glass's light play, over all that shows through it.
          <mesh
            geometry={bodyGeometry}
            material={volumeMaterials[1]}
            // Unset, the material keeps its own (on).
            visible={
              bodyVisible && (bodyShimmer === undefined || bodyShimmer > 0)
            }
            renderOrder={(renderOrder ?? 0) + 3}
            layers={layers}
          />
        )}
        <OceanSamplerContext.Provider value={sampler}>
          <OceanContactContext.Provider value={contactRegistry}>
            {children}
          </OceanContactContext.Provider>
        </OceanSamplerContext.Provider>
      </group>
    );
  },
);
