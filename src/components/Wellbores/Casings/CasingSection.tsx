import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Object3D } from 'three';
import {
  EventEmitterCallback,
  PointerEvents,
  useEventEmitter,
} from '../../../main';
import { clamp } from '../../../sdk';
import { createCasingSectionGeometries } from './casing-geometry';
import { CasingEmitterMaterial } from './CasingEmitterMaterial';
import { CasingEffects, CasingMaterial } from './CasingMaterial';
import { CasingSectionMaterialOptions } from './Casings';
import { CasingSectionType } from './casings-defs';

/** Merge a per-face {@link CasingEffects} override on top of the global default so a
 * section can, e.g., carry the silhouette on its bore only or weather its faces
 * differently. Two levels deep (each sub-effect is a flat object); face values win. */
const mergeEffects = (
  base: CasingEffects,
  override?: CasingEffects,
): CasingEffects => {
  if (!override) return base;
  return {
    silhouette: { ...base.silhouette, ...override.silhouette },
    edgeShading: { ...base.edgeShading, ...override.edgeShading },
    weathering: { ...base.weathering, ...override.weathering },
    sectionVariation: override.sectionVariation ?? base.sectionVariation,
    detailQuality: override.detailQuality ?? base.detailQuality,
    granular: { ...base.granular, ...override.granular },
    brushed: { ...base.brushed, ...override.brushed },
    scratches: { ...base.scratches, ...override.scratches },
  };
};

type CasingSectionProps = {
  materialOptions: CasingSectionMaterialOptions;
  radialSegments?: number;
  sizeMultiplier?: number;
  section: CasingSectionType;
  sliceOffset?: number;
  sliceAngle?: number;
  autoSlicePosition?: boolean;
  opacity?: number;
  renderOrder?: number;
  effects?: CasingEffects;
  wellLength?: number;
  sectionIndex?: number;
  schematic?: boolean;
} & PointerEvents;

export const CasingSection = ({
  section,
  materialOptions,
  radialSegments = 16,
  sizeMultiplier = 1,
  sliceAngle = Math.PI,
  sliceOffset = 0,
  autoSlicePosition = false,
  opacity = 1,
  renderOrder,
  effects = {},
  wellLength = 1,
  sectionIndex = -1,
  schematic = false,
  onPointerClick,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
}: CasingSectionProps) => {
  const sectionRef = useRef<Object3D>(null!);
  const { tubeGeometry, capsGeometry } = useMemo(
    () => createCasingSectionGeometries(section, radialSegments),
    [section, radialSegments],
  );

  const materials = useMemo(() => {
    const primaryMaterial = new CasingMaterial(materialOptions.primary);
    return [
      primaryMaterial,
      materialOptions.inner
        ? new CasingMaterial(materialOptions.inner)
        : primaryMaterial,
      materialOptions.slice
        ? new CasingMaterial(materialOptions.slice)
        : primaryMaterial,
    ];
  }, [materialOptions]);

  const emitterMaterial = useMemo(() => {
    if (onPointerClick || onPointerEnter || onPointerLeave || onPointerMove) {
      return new CasingEmitterMaterial();
    }
    return null;
  }, [onPointerClick, onPointerEnter, onPointerLeave, onPointerMove]);

  useEffect(() => {
    return () => {
      emitterMaterial?.dispose();
    };
  }, [emitterMaterial]);

  // Dispose the library-created geometries when they change or on unmount.
  useEffect(() => {
    return () => {
      tubeGeometry?.dispose();
      capsGeometry?.dispose();
    };
  }, [tubeGeometry, capsGeometry]);

  // Dispose the library-created materials when they change or on unmount.
  // The materials array may reuse primaryMaterial, so dedupe before disposing.
  useEffect(() => {
    return () => {
      new Set(materials).forEach(m => m.dispose());
    };
  }, [materials]);

  useEffect(() => {
    if (materials) {
      materials.forEach(m => {
        if (opacity !== m.opacity) {
          m.opacity = opacity;
          if (opacity < 1 && !m.transparent) {
            m.transparent = true;
            m.needsUpdate = true;
          } else if (opacity === 1 && m.transparent) {
            m.transparent = false;
            m.needsUpdate = true;
          }
        }
      });
    }
  }, [opacity, materials]);

  useEffect(() => {
    if (tubeGeometry) {
      // Schematic mode forces a half-cut (see the slice lock in the layout effect below),
      // so the slice/side faces must be drawn even when the incoming sliceAngle is 0 -
      // otherwise the draw range would clip them away and the cutaway shows no wall edges.
      tubeGeometry.setDrawRange(
        0,
        schematic || sliceAngle ? Infinity : radialSegments * 2 * 6,
      );
    }
  }, [schematic, sliceAngle, tubeGeometry, radialSegments]);

  // Sync prop-driven uniforms imperatively (three.js materials are external mutable
  // objects, so mutating them belongs in an effect, not the render body). Every dep is
  // a primitive or a stable reference, so this only runs when a value actually changes -
  // strictly less work than syncing on every render, and lint-clean. useLayoutEffect (not
  // useEffect) applies the write before the next paint / R3F frame, avoiding a 1-frame lag.
  useLayoutEffect(() => {
    // Schematic mode LOCKS the slice: a half-cut (PI) that always faces the camera
    // (autoSlice) with no offset, regardless of the incoming slice props.
    const clampedSlice = schematic ? Math.PI : clamp(sliceAngle, 0, Math.PI);
    const effSliceOffset = schematic ? 0 : sliceOffset;
    const effAutoSlice = schematic ? true : !!autoSlicePosition;
    materials.forEach(material => {
      material.sizeMultiplier = sizeMultiplier;
      material.radius = section.radius;
      material.innerRadius = section.innerRadius;
      material.sliceOffset = effSliceOffset;
      material.sliceAngle = clampedSlice;
      material.autoSlicePosition = effAutoSlice;
      material.wellLength = wellLength;
      material.sectionIndex = sectionIndex;
      material.schematic = schematic;
    });

    // Effects: the global `effects` prop is the default; each face's own
    // `materialOptions.*.effects` overrides individual sub-effects on top. Apply per
    // DISTINCT material with the options object that created it (a reused primary is
    // only listed once, so it keeps its own merged effects instead of being clobbered).
    materials[0].effects = mergeEffects(
      effects,
      materialOptions.primary?.effects,
    );
    if (materialOptions.inner) {
      materials[1].effects = mergeEffects(
        effects,
        materialOptions.inner.effects,
      );
    }
    if (materialOptions.slice) {
      materials[2].effects = mergeEffects(
        effects,
        materialOptions.slice.effects,
      );
    }

    if (emitterMaterial) {
      emitterMaterial.sizeMultiplier = sizeMultiplier;
      emitterMaterial.radius = section.radius;
      emitterMaterial.innerRadius = section.innerRadius;
      emitterMaterial.sliceOffset = effSliceOffset;
      emitterMaterial.sliceAngle = clampedSlice;
      emitterMaterial.autoSlicePosition = effAutoSlice;
    }
  }, [
    materials,
    materialOptions,
    emitterMaterial,
    sizeMultiplier,
    section,
    sliceOffset,
    sliceAngle,
    autoSlicePosition,
    effects,
    wellLength,
    sectionIndex,
    schematic,
  ]);

  const eventHandler = useEventEmitter();

  // register event handlers
  useEffect(() => {
    let unregister: (() => void) | null = null;
    if (eventHandler) {
      const handlers: Record<string, EventEmitterCallback> = {};

      if (onPointerClick) handlers.click = onPointerClick;
      if (onPointerEnter) handlers.enter = onPointerEnter;
      if (onPointerLeave) handlers.leave = onPointerLeave;
      if (onPointerMove) handlers.move = onPointerMove;

      if (Object.keys(handlers).length && emitterMaterial) {
        unregister = eventHandler.register({
          object: sectionRef.current,
          handlers,
          ref: section,
          customMaterial: emitterMaterial,
        });
      }
    }

    return () => {
      if (unregister) unregister();
    };
  }, [
    eventHandler,
    onPointerClick,
    onPointerEnter,
    onPointerLeave,
    onPointerMove,
    section,
    emitterMaterial,
  ]);

  return (
    <group ref={sectionRef} renderOrder={renderOrder}>
      <mesh geometry={tubeGeometry} material={materials} />
      <mesh geometry={capsGeometry} material={materials[0]} />
    </group>
  );
};
