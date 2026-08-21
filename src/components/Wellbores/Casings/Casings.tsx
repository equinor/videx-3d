import {
  ForwardedRef,
  forwardRef,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Group, Object3D } from 'three';
import { CommonComponentProps } from '../../../common/types';
import { useGenerator } from '../../../hooks/useGenerator';
import { useWellboreContext } from '../../../hooks/useWellboreContext';
import { PointerEvents } from '../../../main';
import { CasingEffects, CasingMaterialParameters } from './CasingMaterial';
import {
  casings,
  CasingSectionType,
  CasingsGeneratorResponse,
  defaultCasingEffects,
  defaultMaterialOptions,
} from './casings-defs';
import { CasingSection } from './CasingSection';

/**
 * CasingSectionMaterialOptions
 * @expand
 */
export type CasingSectionMaterialOptions = {
  primary: CasingMaterialParameters;
  inner?: CasingMaterialParameters;
  slice?: CasingMaterialParameters;
};

/**
 * MaterialOptions
 * @expand
 */
export type MaterialOptions = (
  section: CasingSectionType,
) => CasingSectionMaterialOptions;

/**
 * Casing props
 * @expand
 */
export type CasingProps = PointerEvents &
  CommonComponentProps & {
    fallback?: () => ReactElement<Object3D>;
    radialSegments?: number;
    sliceAngle?: number;
    sliceOffset?: number;
    autoSlicePosition?: boolean;
    sizeMultiplier?: number;
    shoeFactor?: number;
    overrideSegmentsPerMeter?: number;
    overrideSimplificationThreshold?: number;
    /** Schematic (diagram) mode: an unlit, flat-shaded look for a clean "cutaway
     * schematic" rather than realism. Locks the slice to a half-cut that always faces
     * the camera (`sliceAngle = PI`, `autoSlicePosition = true`, `sliceOffset = 0` -
     * those props are ignored), renders each face with only its flat `color` (all
     * lighting/env, textures and realism detail are ignored) plus the `silhouette`
     * outline for contrast. Dropping the specular lighting also removes the dominant
     * source of casing aliasing; note that geometric silhouette-edge anti-aliasing still
     * relies on the host render pipeline (MSAA/FXAA/SMAA). Default false. */
    schematic?: boolean;
    /** Maps each section to its material parameters. Keep this a STABLE reference
     * (module-level function or `useCallback`) - a new function identity each render
     * rebuilds every section's materials and forces a shader recompile per frame,
     * which is the main cause of sluggish casing updates. Defaults to a stable
     * module-level function. */
    materialOptions?: MaterialOptions;
    opacity?: number;
    priority?: number;
    /** Grouped casing stylization effects (silhouette outline, section edge shading,
     * procedural weathering, per-section variation and micro-normal surface detail).
     * Applied as the global default for every section; a section's per-face
     * `materialOptions.*.effects` override individual sub-effects on top of this.
     * Defaults to {@link defaultCasingEffects}. */
    effects?: CasingEffects;
  };

/**
 * Generic render of casings based on depths, diameters and type. Must be a child of the `Wellbore` component.
 *
 * The casing may be "sliced" at an angle using the sliceAngle prop. The sliceOffset prop determines the offset
 * from the z axis to the center of the slice. Setting autoSlicePosition to true will always show the center of the
 * slice facing the camera. With this option set to true, the sliceOffset should be set to 0.
 *
 * An alternative to using the slice feature is to set opacity < 1 if you want to see the internals.
 *
 * @example
 * <Wellbore id={wellbore.id}>
 *  <Casings sizeMultiplier={5} />
 * </Wellbore>
 *
 * @remarks
 * The `fallback` prop may be used to render a different component if there is no completion tool data available for the wellbore.
 *
 * @see {@link Wellbore}
 *
 * @group Components
 */
export const Casings = forwardRef(
  (
    {
      name,
      userData,
      renderOrder,
      layers,
      position,
      visible,
      radialSegments = 16,
      sizeMultiplier = 1,
      shoeFactor = 1,
      sliceAngle = 0,
      sliceOffset = 0,
      autoSlicePosition = false,
      overrideSegmentsPerMeter,
      overrideSimplificationThreshold,
      materialOptions = defaultMaterialOptions,
      fallback,
      opacity = 1,
      priority = 0,
      effects = defaultCasingEffects,
      schematic = false,
      onPointerClick,
      onPointerEnter,
      onPointerLeave,
      onPointerMove,
    }: CasingProps,
    ref: ForwardedRef<Group>,
  ) => {
    const {
      id,
      fromMsl,
      segmentsPerMeter: defaultSegmentsPerMeter,
      simplificationThreshold: defaultSimplificationThreshold,
    } = useWellboreContext();
    const generator = useGenerator<CasingsGeneratorResponse>(casings, priority);
    const [sections, setSections] = useState<CasingSectionType[] | null>(null);
    const [useFallback, setUseFallback] = useState(false);

    const { segmentsPerMeter, simplificationThreshold } = useMemo(() => {
      return {
        segmentsPerMeter:
          overrideSegmentsPerMeter !== undefined
            ? overrideSegmentsPerMeter
            : defaultSegmentsPerMeter || 0.1,
        simplificationThreshold:
          overrideSimplificationThreshold !== undefined
            ? overrideSimplificationThreshold
            : defaultSimplificationThreshold || 0,
      };
    }, [
      defaultSegmentsPerMeter,
      defaultSimplificationThreshold,
      overrideSegmentsPerMeter,
      overrideSimplificationThreshold,
    ]);

    useEffect(() => {
      if (generator && id) {
        generator(
          id,
          fromMsl,
          shoeFactor,
          segmentsPerMeter,
          simplificationThreshold,
        ).then(response => {
          setSections(response);
          if (!response) setUseFallback(true);
        });
      }
    }, [
      generator,
      id,
      fromMsl,
      radialSegments,
      shoeFactor,
      segmentsPerMeter,
      simplificationThreshold,
    ]);

    const sectionMaterialOptions = useMemo(() => {
      return sections?.map(materialOptions) || null;
    }, [sections, materialOptions]);

    // Real-world length (metres) of the whole trajectory, recovered from each
    // section's (real length / normalized span) ratio. Every unclamped section
    // yields the exact same value (they share one well-spanning normalization);
    // a section whose top was clamped by `fromMsl` keeps its full length over a
    // shortened span, which only ever inflates the ratio - so the minimum across
    // sections is the true trajectory length. Used to convert the 0-1 curve
    // parameter into real metres for the contact-AO falloff and weathering scale.
    const wellLength = useMemo(() => {
      if (!sections || sections.length === 0) return 1;
      return sections.reduce((min, s) => {
        const len = s.length / Math.max(s.bottom - s.top, 1e-6);
        return Math.min(min, len);
      }, Infinity);
    }, [sections]);

    return (
      <group
        ref={ref}
        name={name}
        userData={userData}
        visible={visible}
        position={position}
        renderOrder={renderOrder}
        layers={layers}
      >
        {sections &&
          sectionMaterialOptions &&
          sections.map((section, i) => (
            <CasingSection
              key={i}
              materialOptions={sectionMaterialOptions[i]}
              opacity={opacity}
              sliceAngle={sliceAngle}
              sliceOffset={sliceOffset}
              autoSlicePosition={autoSlicePosition}
              section={section}
              radialSegments={radialSegments}
              sizeMultiplier={sizeMultiplier}
              renderOrder={i}
              effects={effects}
              wellLength={wellLength}
              sectionIndex={i}
              schematic={schematic}
              onPointerClick={onPointerClick}
              onPointerEnter={onPointerEnter}
              onPointerLeave={onPointerLeave}
              onPointerMove={onPointerMove}
            />
          ))}
        {useFallback && fallback && fallback()}
      </group>
    );
  },
);
