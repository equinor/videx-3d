import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { layerShownAt } from '../src/components/Layers/layer-globe';
import type { SceneryOceanState } from '../src/components/Scenery/scenery-context';
import { Globe } from '../src/sdk/projection/globe';

// A flat globe, its sea at 0; a sea 100 m deep, and the ground under the camera as a stage
// draws it (null: the sea's own seabed).
const globe = new Globe();
globe.enabled = false;
const ocean = (oceanGround: number | null = null) =>
  ({
    material: { ocean: true, oceanLevel: 0, oceanDepth: 100, oceanGround },
  }) as unknown as SceneryOceanState;
const at = (y: number) => new Vector3(0, y, 0);

describe('layerShownAt', () => {
  it('shows a layer within its heights, as layerVisibilityAt does', () => {
    expect(layerShownAt(at(500), globe, null, {}, 'ground')).toBe(1);
    expect(
      layerShownAt(at(500), globe, null, { maxHeight: 100, fade: 0 }, 0),
    ).toBe(0);
    expect(layerShownAt(at(500), globe, null, { visible: false }, 0)).toBe(0);
  });

  it('hides what lies above the ground while the camera is in it', () => {
    // Over the seabed, in the water: all shows.
    expect(layerShownAt(at(-50), globe, ocean(), {}, 'ground')).toBe(1);
    // Under the sea's seabed: on the ground, at the sea or at the seabed, hidden.
    expect(layerShownAt(at(-400), globe, ocean(), {}, 'ground')).toBe(0);
    expect(layerShownAt(at(-400), globe, ocean(), {}, 0)).toBe(0);
    expect(layerShownAt(at(-400), globe, ocean(), {}, -100)).toBe(0);
    // Laid deeper than the ground: seen from the void.
    expect(layerShownAt(at(-400), globe, ocean(), {}, -2000)).toBe(1);
  });

  it("takes a stage's ground under the camera for the lid", () => {
    // Inside a hill on the seabed, its top at -20: a layer at -50 lies under it.
    expect(layerShownAt(at(-60), globe, ocean(-20), {}, -50)).toBe(1);
    expect(layerShownAt(at(-60), globe, ocean(-20), {}, 'ground')).toBe(0);
    // In a trench over its floor: in the water, all shows.
    expect(layerShownAt(at(-280), globe, ocean(-300), {}, 'ground')).toBe(1);
  });

  it('hides nothing without a sea', () => {
    const dry = {
      material: { ocean: false, oceanLevel: 0, oceanDepth: 100 },
    } as unknown as SceneryOceanState;
    expect(layerShownAt(at(-400), globe, dry, {}, 'ground')).toBe(1);
  });
});
