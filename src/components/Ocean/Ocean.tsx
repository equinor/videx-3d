import { useFrame } from '@react-three/fiber';
import {
  ForwardedRef,
  forwardRef,
  ReactNode,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { BufferGeometry, Group, Vector2, Vector3 } from 'three';
import { CommonComponentProps, CustomMaterialProps } from '../../common/types';
import { Vec2, Vec3 } from '../../sdk/types/common';
import { OceanBedMaterial } from './ocean-bed-material';
import {
  OceanContactContext,
  OceanContactRegistry,
  OceanContactSource,
} from './ocean-contact';
import { OceanContact, OceanMaterial } from './ocean-material';
import { createOceanSampler, OceanSamplerContext } from './ocean-sampler';
import { OceanVolumeMaterial } from './ocean-volume-material';

/**
 * Ocean props
 * @expand
 */
export type OceanProps = CommonComponentProps &
  CustomMaterialProps & {
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
    /** Wind direction in world X/Z (drives wave + foam direction). */
    windDirection?: Vec2;
    /**
     * Wind speed in m/s (U10). Primary driver of the sea state: wave height,
     * wavelength and foam all follow North-Sea JONSWAP/Pierson-Moskowitz
     * relations (e.g. ~10 m/s ⇒ Hs ~ 2.1 m, peak wavelength ~ 88 m).
     */
    windSpeed?: number;
    /** Wave height multiplier on top of the spectrum's physical Hs. */
    amplitude?: number;
    /** Angular spread (radians) of the wave directions around the wind. */
    directionalSpread?: number;
    /** Apparent surface choppiness (normal exaggeration / Gerstner sharpness). */
    steepness?: number;
    /**
     * Enables vertex displacement (`false` = off / flat, per-pixel normals
     * only). Off by default; at oilfield scale real displacement is
     * imperceptible except very close to the surface, where only the longest
     * swells displace. Mainly useful to let floating objects follow the surface
     * height.
     */
    displacement?: boolean;
    /** Number of summed spectral wave components (compile-time). */
    waveCount?: number;
    /** Number of FBM micro-ripple octaves (compile-time). */
    detailOctaves?: number;
    /** Deep water colour (seen looking straight down). */
    deepColor?: string;
    /** Shallow/scatter water colour (seen at grazing angles). */
    shallowColor?: string;
    /** Base body opacity looking straight down (0 = clear, 1 = opaque). */
    waterOpacity?: number;
    /** Strength of the large-scale tonal variation (currents / slicks), 0 = off. */
    tonalVariation?: number;
    /** Approximate size of the tonal variation patches, in kilometers. */
    tonalScale?: number;
    /** Crispness of the tonal variation patch edges (0 = soft, 1 = hard). */
    tonalSharpness?: number;
    /** Colour the water drifts toward in the tonal variation (current / algae / pollution tint). */
    tonalColor?: string;
    /** Zenith sky colour used for the procedural reflection. */
    skyColor?: string;
    /** Horizon sky colour used for the procedural reflection. */
    horizonColor?: string;
    /** Reflection intensity multiplier. */
    reflectionIntensity?: number;
    /** Sun direction in world space (specular highlight + reflected glow). */
    sunDirection?: Vec3;
    /** Sun colour. */
    sunColor?: string;
    /** Sun specular shininess exponent. */
    sunShininess?: number;
    /** Foam colour. */
    foamColor?: string;
    /** Foam amount, 0 = none. */
    foamAmount?: number;
    /** Fresnel exponent (higher = reflections concentrated near the horizon). */
    fresnelPower?: number;
    /** Micro-ripple frequency (waves per world unit) for close-up detail. */
    detailScale?: number;
    /** Micro-ripple normal strength. */
    detailStrength?: number;
    /**
     * Sea-bed base (sandy/yellowish) colour. Only used when `bedGeometry` is
     * provided. Default `#b8a06a`.
     */
    seaBedColor?: string;
    /**
     * Strength of the water-colour tint applied to the water-facing (top) side
     * of the sea bed (0..1). Only used when `bedGeometry` is provided.
     */
    seaBedWaterTint?: number;
    /**
     * Sea-bed opacity (0..1). Only used when `bedGeometry` is provided. The sea
     * bed is OIT-routed, so values below 1 let the subsurface geometry below it
     * show through; 1 (default) makes it a solid occluder.
     */
    seaBedOpacity?: number;
    /**
     * Sea-bed sand-dune relief strength (0 = off). Only used when `bedGeometry`
     * is provided. Perturbs the bed's shading normal by a procedural,
     * footprint-anti-aliased dune height field, adding a subtle sense of depth
     * and scale that resolves up close and fades to flat far out. Default 0.15.
     */
    seaBedDuneStrength?: number;
    /**
     * Base sand-dune crest spacing in meters. Only used when `bedGeometry` is
     * provided. Default 180.
     */
    seaBedDuneWavelength?: number;
    /**
     * Sand-dune ridge direction in world X/Z. Only used when `bedGeometry` is
     * provided. Default `[1, 0.6]`.
     */
    seaBedDuneDirection?: Vec2;
    /**
     * Extra sand-dune crest/trough albedo banding (0 = off). Only used when
     * `bedGeometry` is provided. Lightens the dune crests and darkens the
     * troughs on top of the relief shading for a stronger depth cue; fades out
     * far away like the rest of the dune detail. Default 0.
     */
    seaBedDuneSharpness?: number;
    /**
     * Per-meter tint build-up of the water body. Only used when `bodyGeometry`
     * is provided.
     */
    bodyFogDensity?: number;
    /** Densest water-body tint reached far through the water (0..1). */
    bodyMaxOpacity?: number;
    /** Animated shimmer amount of the water body, 0 = off. */
    bodyShimmer?: number;
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
 * water surface. The wave field is sampled from a North-Sea JONSWAP spectrum
 * driven by the wind speed (m/s); the visible waves are reconstructed per-pixel
 * as surface normals (plus a fine micro-ripple layer up close), all evaluated
 * in world X/Z space so the pattern is continuous across tiled patches with no
 * repeating texture assets. Level-of-detail uses per-wave footprint
 * anti-aliasing, so there is no visible LOD ring. Transparency is Fresnel-driven
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
      amplitude,
      directionalSpread,
      steepness,
      displacement,
      waveCount = 16,
      detailOctaves = 4,
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

    const material = useMemo(() => {
      if (customMaterial) return customMaterial;
      return new OceanMaterial({ waveCount, detailOctaves });
    }, [customMaterial, waveCount, detailOctaves]);

    // Optional water-body (side walls) material — a separate mesh so it routes
    // through OIT independently of the surface and sea bed.
    const volumeMaterial = useMemo(
      () => (bodyGeometry ? new OceanVolumeMaterial({ waveCount }) : null),
      [bodyGeometry, waveCount],
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
    const contactSources = useRef<Set<OceanContactSource>>(new Set());
    const contactScratch = useRef<OceanContact[]>([]);
    const contactRegistry = useMemo<OceanContactRegistry>(
      () => ({
        register(source) {
          contactSources.current.add(source);
          return () => {
            contactSources.current.delete(source);
          };
        },
      }),
      [],
    );

    // Sync prop-driven uniforms onto the material.
    useEffect(() => {
      if (!(material instanceof OceanMaterial)) {
        onMaterialPropertiesChange?.(
          {
            windDirection,
            windSpeed,
            amplitude,
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

      if (windDirection)
        material.windDirection = new Vector2(
          windDirection[0],
          windDirection[1],
        );
      if (windSpeed !== undefined) material.windSpeed = windSpeed;
      if (amplitude !== undefined) material.amplitude = amplitude;
      if (directionalSpread !== undefined)
        material.directionalSpread = directionalSpread;
      if (steepness !== undefined) material.steepness = steepness;
      if (displacement !== undefined)
        material.displacement = displacement ? 1 : 0;
      if (deepColor) material.deepColor = deepColor;
      if (shallowColor) material.shallowColor = shallowColor;
      if (waterOpacity !== undefined) material.waterOpacity = waterOpacity;
      if (tonalVariation !== undefined)
        material.tonalVariation = tonalVariation;
      if (tonalScale !== undefined) material.tonalScale = tonalScale;
      if (tonalSharpness !== undefined)
        material.tonalSharpness = tonalSharpness;
      if (tonalColor) material.tonalColor = tonalColor;
      if (skyColor) material.skyColor = skyColor;
      if (horizonColor) material.horizonColor = horizonColor;
      if (reflectionIntensity !== undefined)
        material.reflectionIntensity = reflectionIntensity;
      if (sunDirection)
        material.sunDirection = new Vector3(
          sunDirection[0],
          sunDirection[1],
          sunDirection[2],
        );
      if (sunColor) material.sunColor = sunColor;
      if (sunShininess !== undefined) material.sunShininess = sunShininess;
      if (foamColor) material.foamColor = foamColor;
      if (foamAmount !== undefined) material.foamAmount = foamAmount;
      if (fresnelPower !== undefined) material.fresnelPower = fresnelPower;
      if (detailScale !== undefined) material.detailScale = detailScale;
      if (detailStrength !== undefined)
        material.detailStrength = detailStrength;

      material.uniforms.uMasterOpacity.value = opacity;
      // Drive OIT opacity-aware routing via material.opacity (the pass reads the
      // ShaderMaterial's `uniforms.opacity` first, then falls back to this). The
      // ocean has no `opacity` uniform, so this value is what classifies it as
      // transparent and keeps it in the OIT passes (so subsurface geometry shows
      // through it instead of being depth-rejected by an opaque-pass draw).
      material.opacity = Math.min(
        opacity * (waterOpacity ?? material.waterOpacity),
        0.999,
      );
    }, [
      material,
      windDirection,
      windSpeed,
      amplitude,
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
      onMaterialPropertiesChange,
    ]);

    // Sync prop-driven uniforms onto the grouped (water-body + sea-bed) materials.
    useEffect(() => {
      if (volumeMaterial) {
        if (deepColor) volumeMaterial.deepColor = deepColor;
        if (shallowColor) volumeMaterial.shallowColor = shallowColor;
        if (bodyFogDensity !== undefined)
          volumeMaterial.fogDensity = bodyFogDensity;
        // Densest tint the water body reaches: follows the surface water
        // opacity so the body reads "denser" blue as the water gets more
        // opaque. An explicit bodyMaxOpacity overrides this coupling.
        volumeMaterial.maxOpacity =
          bodyMaxOpacity ?? waterOpacity ?? volumeMaterial.maxOpacity;
        if (bodyShimmer !== undefined) volumeMaterial.shimmer = bodyShimmer;
        volumeMaterial.masterOpacity = opacity;
        volumeMaterial.opacity = Math.min(opacity, 0.999);

        // Make the wall top ring follow the same wave displacement as the
        // surface so the rim stays sealed. Share the surface's wave tables by
        // reference (the surface mutates them in place on sea-state changes) and
        // mirror the displacement/steepness inputs.
        if (material instanceof OceanMaterial) {
          volumeMaterial.setWaveTables(
            material.uniforms.uWaveA.value,
            material.uniforms.uWaveB.value,
          );
          volumeMaterial.steepness = material.steepness;
          volumeMaterial.displacement = material.displacement;
        }
      }
      if (seaBedMaterial) {
        if (seaBedColor) seaBedMaterial.color = seaBedColor;
        // Match the bed's water tint to the surface's deep colour.
        if (deepColor) seaBedMaterial.waterColor = deepColor;
        // Strength of the blue water tint over the bed: follows the surface
        // water opacity so the bed reads "denser" blue as the water gets more
        // opaque. An explicit seaBedWaterTint overrides this coupling.
        seaBedMaterial.waterTint =
          seaBedWaterTint ?? waterOpacity ?? seaBedMaterial.waterTint;
        if (sunDirection)
          seaBedMaterial.sunDirection = new Vector3(
            sunDirection[0],
            sunDirection[1],
            sunDirection[2],
          );
        if (sunColor) seaBedMaterial.sunColor = sunColor;

        if (seaBedDuneStrength !== undefined)
          seaBedMaterial.duneStrength = seaBedDuneStrength;
        if (seaBedDuneWavelength !== undefined)
          seaBedMaterial.duneWavelength = seaBedDuneWavelength;
        if (seaBedDuneDirection)
          seaBedMaterial.duneDirection = new Vector2(
            seaBedDuneDirection[0],
            seaBedDuneDirection[1],
          );
        if (seaBedDuneSharpness !== undefined)
          seaBedMaterial.duneSharpness = seaBedDuneSharpness;

        const bedAlpha = seaBedOpacity ?? 1;
        seaBedMaterial.bedOpacity = bedAlpha;
        seaBedMaterial.masterOpacity = opacity;
        // Drive OIT opacity-aware routing via material.opacity (>= 1 makes the
        // bed an opaque occluder; < 1 keeps it in the transparency passes so the
        // subsurface geometry below it still shows through).
        seaBedMaterial.opacity = Math.min(bedAlpha * opacity, 1);
      }
    }, [
      volumeMaterial,
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

    // Advance the animation clock.
    useFrame((_, delta) => {
      if (material instanceof OceanMaterial) {
        material.time += delta;

        // Collect the registered floating-object footprints and upload them as
        // contact foam. Skipped entirely when nothing is registered, so there is
        // no per-frame cost on an ocean with no floating children.
        const sources = contactSources.current;
        if (sources.size > 0) {
          const scratch = contactScratch.current;
          scratch.length = 0;
          for (const source of sources) {
            const contact = source();
            if (contact) scratch.push(contact);
          }
          material.setContacts(scratch);
        } else if ((material.uniforms.uContactCount.value as number) > 0) {
          material.clearContacts();
        }
      }
      if (volumeMaterial) {
        volumeMaterial.time += delta;
      }
    });

    // Debug: toggle wireframe on every material used by the ocean.
    useEffect(() => {
      const materials = [material, volumeMaterial, seaBedMaterial];
      for (const m of materials) {
        if (m && 'wireframe' in m) {
          (m as { wireframe: boolean }).wireframe = wireframe;
        }
      }
    }, [material, volumeMaterial, seaBedMaterial, wireframe]);

    // Dispose the library-created material on unmount.
    useEffect(() => {
      return () => {
        if (material instanceof OceanMaterial) material.dispose();
      };
    }, [material]);

    // Dispose the library-created grouped materials on unmount.
    useEffect(() => {
      return () => {
        volumeMaterial?.dispose();
        seaBedMaterial?.dispose();
      };
    }, [volumeMaterial, seaBedMaterial]);

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
        {bodyGeometry && volumeMaterial && (
          <mesh
            geometry={bodyGeometry}
            material={volumeMaterial}
            visible={bodyVisible}
            renderOrder={(renderOrder ?? 0) + 1}
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
        <OceanSamplerContext.Provider value={sampler}>
          <OceanContactContext.Provider value={contactRegistry}>
            {children}
          </OceanContactContext.Provider>
        </OceanSamplerContext.Provider>
      </group>
    );
  },
);
