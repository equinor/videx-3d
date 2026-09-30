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
import { BufferGeometry, Group } from 'three';
import { CommonComponentProps, CustomMaterialProps } from '../../common/types';
import { OceanBedMaterial } from './ocean-bed-material';
import {
  applyOceanBedProps,
  applyOceanBodyProps,
  applyOceanWaterProps,
  OceanBedProps,
  OceanBodyProps,
  OceanWaterProps,
} from './ocean-material-sync';
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
    /** Number of summed spectral wave components (compile-time). */
    waveCount?: number;
    /** Number of FBM micro-ripple octaves (compile-time). */
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

      applyOceanWaterProps(material, {
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
      });
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
