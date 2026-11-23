import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { layerShownAt } from '../src/components/Layers/layer-globe';
import type { CameraSite } from '../src/sdk/utils/camera-site';
import { Globe } from '../src/sdk/projection/globe';

// A flat globe, its sea at 0 and its seabed 100 m down. A camera site at height `y`, with the
// void's lid over it while it is in the ground (null: not in the ground), as the sky works
// it out (`sceneryLidOverCamera`); `seaLevel` null without a sea.
const globe = new Globe();
globe.enabled = false;
const site = (
  y: number,
  lid: number | null = null,
  seaLevel: number | null = 0,
) =>
  ({
    position: new Vector3(0, y, 0),
    altitude: y,
    seaLevel,
    lid,
  }) as CameraSite;

describe('layerShownAt', () => {
  it('shows a layer within its heights, as layerVisibilityAt does', () => {
    expect(layerShownAt(site(500), globe, {}, 'ground')).toBe(1);
    expect(layerShownAt(site(500), globe, { maxHeight: 100, fade: 0 }, 0)).toBe(
      0,
    );
    expect(layerShownAt(site(500), globe, { visible: false }, 0)).toBe(0);
  });

  it('hides what lies above the lid while the camera is in the ground', () => {
    // Over the seabed, in the water: all shows.
    expect(layerShownAt(site(-50), globe, {}, 'ground')).toBe(1);
    // Under the sea's seabed, its lid: on the ground, at the sea or at the seabed, hidden.
    expect(layerShownAt(site(-400, -100), globe, {}, 'ground')).toBe(0);
    expect(layerShownAt(site(-400, -100), globe, {}, 0)).toBe(0);
    expect(layerShownAt(site(-400, -100), globe, {}, -100)).toBe(0);
    // Laid deeper than the ground: seen from the void.
    expect(layerShownAt(site(-400, -100), globe, {}, -2000)).toBe(1);
  });

  it("takes a stage's ground over the camera for the lid", () => {
    // Inside a hill on the seabed, its top at -20: a layer at -50 lies under it.
    expect(layerShownAt(site(-60, -20), globe, {}, -50)).toBe(1);
    expect(layerShownAt(site(-60, -20), globe, {}, 'ground')).toBe(0);
    // In a trench over its floor: in the water, all shows.
    expect(layerShownAt(site(-280), globe, {}, 'ground')).toBe(1);
  });

  it('hides nothing without a sea', () => {
    expect(layerShownAt(site(-400, -100, null), globe, {}, 'ground')).toBe(1);
  });
});
