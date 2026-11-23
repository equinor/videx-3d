import { describe, expect, it } from 'vitest';
import { Vector2, Vector4 } from 'three';
import {
  ZoneMaterial,
  createFenceOverlayUniforms,
  createFenceUniforms,
} from '../src/components/Zones/zone-material';
import { ZonePickingMaterial } from '../src/components/Zones/zone-picking-material';
import { createInferenceMaterial } from '../src/components/Zones/inference-material';
import { getPickingMaterial } from '../src/components/EventEmitter/picking-material';

const cut = () => ({
  sectionPlane: { value: new Vector4(1, 0, 0, -5) },
  fence: createFenceUniforms({ value: new Vector2(1, 1) }),
});

describe('zone picking material', () => {
  it('gives an uncut material no picking twin', () => {
    expect(getPickingMaterial(new ZoneMaterial())).toBeUndefined();
  });

  // ⭐ By IDENTITY: a copied uniform would freeze at its first value, so a moving plane
  // or a fence side swap would leave picking on the old cut while the drawing follows.
  it('binds every cut uniform of the material it stands in for, by identity', () => {
    const { sectionPlane, fence } = cut();
    const material = new ZoneMaterial({ sectionPlane, fence });
    const picking = getPickingMaterial(material);
    expect(picking).toBeInstanceOf(ZonePickingMaterial);

    const twin = picking as ZonePickingMaterial;
    expect(twin.defines).toMatchObject({ ZONE_SECTION: '', ZONE_FENCE: '' });
    const keys = Object.keys(material.uniforms).filter(
      key => key === 'sectionPlane' || key.startsWith('fence'),
    );
    expect(keys).toHaveLength(11);
    const copied = keys.filter(
      key => twin.uniforms[key] !== material.uniforms[key],
    );
    expect(copied, 'uniforms not shared with the drawn material').toEqual([]);
  });

  it('carries only the cut the material has', () => {
    const { fence } = cut();
    const twin = getPickingMaterial(new ZoneMaterial({ fence }))!;
    expect((twin as ZonePickingMaterial).defines).not.toHaveProperty(
      'ZONE_SECTION',
    );
    expect((twin as ZonePickingMaterial).defines).toHaveProperty('ZONE_FENCE');
  });

  it('is disposed and unregistered with its material', () => {
    const material = new ZoneMaterial(cut());
    const twin = getPickingMaterial(material)!;
    let disposed = false;
    twin.addEventListener('dispose', () => {
      disposed = true;
    });
    material.dispose();
    expect(disposed).toBe(true);
    expect(getPickingMaterial(material)).toBeUndefined();
  });

  it('covers the inference overlay drawn over a cut zone', () => {
    const { sectionPlane } = cut();
    const overlay = createInferenceMaterial('hatched', { sectionPlane })!;
    expect(getPickingMaterial(overlay)).toBeInstanceOf(ZonePickingMaterial);
    expect(
      getPickingMaterial(createInferenceMaterial('hatched')!),
    ).toBeUndefined();
  });

  // A face across a gap exists only where the overlay has data, so it is picked only there.
  it('gives an overlay-only face the overlay test, bound by identity', () => {
    const fenceOverlay = createFenceOverlayUniforms();
    const material = new ZoneMaterial({
      fenceOverlay,
      fenceOverlayOnly: true,
    });
    const twin = getPickingMaterial(material) as ZonePickingMaterial;
    expect(twin).toBeInstanceOf(ZonePickingMaterial);
    expect(twin.defines).toHaveProperty('ZONE_FENCE_OVERLAY_ONLY');
    expect(twin.uniforms.overlayRect).toBe(fenceOverlay.rect);
    expect(twin.uniforms.overlayParams).toBe(fenceOverlay.params);
    // An ordinary overlay is drawn over rock that is there anyway.
    expect(
      getPickingMaterial(new ZoneMaterial({ fenceOverlay })),
    ).toBeUndefined();
  });
});
