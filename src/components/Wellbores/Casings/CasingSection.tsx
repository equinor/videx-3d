import { useEffect, useMemo } from 'react';
import { clamp } from '../../../sdk';
import { createCasingSectionGeometries } from './casing-geometry';
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
};

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
}: CasingSectionProps) => {
  // const uvMap = useTexture('uv_grid.jpg');
  // const normalMap = useTexture('normal_map.jpg');

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

  return (
    <>
      <mesh
        renderOrder={renderOrder}
        geometry={tubeGeometry}
        material={materials}
      />
      <mesh
        renderOrder={renderOrder}
        geometry={capsGeometry}
        material={materials[0]}
      />
    </>
  );
};
