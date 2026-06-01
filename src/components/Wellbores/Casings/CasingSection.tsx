import { useEffect, useMemo, useRef } from 'react';
import { Object3D } from 'three';
import {
  EventEmitterCallback,
  PointerEvents,
  useEventEmitter,
} from '../../../main';
import { clamp } from '../../../sdk';
import { createCasingSectionGeometries } from './casing-geometry';
import { CasingEmitterMaterial } from './CasingEmitterMaterial';
import { CasingMaterial } from './CasingMaterial';
import { CasingSectionMaterialOptions } from './Casings';
import { CasingSectionType } from './casings-defs';

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
  onPointerClick,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
}: CasingSectionProps) => {
  // const uvMap = useTexture('uv_grid.jpg');
  // const normalMap = useTexture('normal_map.jpg');

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
      tubeGeometry.setDrawRange(
        0,
        sliceAngle ? Infinity : radialSegments * 2 * 6,
      );
    }
  }, [sliceAngle, tubeGeometry, radialSegments]);

  materials.forEach(material => {
    material.sizeMultiplier = sizeMultiplier;
    material.radius = section.radius;
    material.innerRadius = section.innerRadius;
    material.sliceOffset = sliceOffset;
    material.sliceAngle = clamp(sliceAngle, 0, Math.PI);
    material.autoSlicePosition = !!autoSlicePosition;
  });

  if (emitterMaterial) {
    emitterMaterial.sizeMultiplier = sizeMultiplier;
    emitterMaterial.radius = section.radius;
    emitterMaterial.innerRadius = section.innerRadius;
    emitterMaterial.sliceOffset = sliceOffset;
    emitterMaterial.sliceAngle = clamp(sliceAngle, 0, Math.PI);
    emitterMaterial.autoSlicePosition = !!autoSlicePosition;
  }

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
