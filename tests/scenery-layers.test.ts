import { describe, expect, it } from 'vitest';
import {
  sceneryGroundShown,
  sceneryLayerDefines,
  sceneryLayers,
  sceneryLayersShown,
  SceneryLayerView,
} from '../src/components/Scenery/scenery-layers';
import { SceneryMaterial } from '../src/components/Scenery/scenery-material';
import {
  WATER_QUALITY_DEFINES,
  WaterMaterial,
} from '../src/components/Water/water-material';

const key = (defines: Record<string, unknown>) => JSON.stringify(defines);

describe('sceneryLayers', () => {
  it('draws the sky alone without features', () => {
    expect(sceneryLayers(new SceneryMaterial())).toEqual(['sky']);
  });

  it('adds each feature as a layer of its own, in order', () => {
    const scenery = new SceneryMaterial();
    scenery.void = true;
    scenery.sea = true;
    expect(sceneryLayers(scenery)).toEqual([
      'sky',
      'void',
      'sea',
      'water',
      'surface',
    ]);
  });
});

describe('sceneryLayerDefines', () => {
  it('leaves the sky’s own program alone when a feature switches', () => {
    const scenery = new SceneryMaterial();
    const before = key(scenery.defines);
    const version = scenery.switchesVersion;
    scenery.sea = true;
    scenery.void = true;
    expect(key(scenery.defines)).toBe(before);
    expect(scenery.switchesVersion).toBeGreaterThan(version);
  });

  it('recompiles the sea, not the void, for the seabed’s detail', () => {
    const scenery = new SceneryMaterial();
    scenery.sea = true;
    scenery.void = true;
    const voidKey = key(sceneryLayerDefines(scenery, 'void'));
    const sea = key(sceneryLayerDefines(scenery, 'sea'));
    // The default seabed has a detail of its own: off is a change.
    scenery.seabedDetail = undefined;
    expect(key(sceneryLayerDefines(scenery, 'sea'))).not.toBe(sea);
    expect(key(sceneryLayerDefines(scenery, 'void'))).toBe(voidKey);
  });

  it('gives each layer a define of its own, so each is its own program', () => {
    const scenery = new SceneryMaterial();
    scenery.sea = true;
    scenery.void = true;
    const keys = (['void', 'sea', 'water'] as const).map(layer =>
      key(sceneryLayerDefines(scenery, layer)),
    );
    expect(new Set(keys).size).toBe(3);
  });

  it('draws the sea with its water’s glitter and Fresnel, as they change', () => {
    const scenery = new SceneryMaterial();
    scenery.sea = true;
    const water = new WaterMaterial();
    scenery.linkWater(water);
    const sea = () => sceneryLayerDefines(scenery, 'sea');
    // No glitter by default on medium, compiled in once asked for.
    expect(sea()).not.toHaveProperty('WATER_SPARKLE');
    water.sparkle = 0.5;
    scenery.linkWater(water);
    expect(sea()).toHaveProperty('WATER_SPARKLE');
    water.sparkle = null;
    scenery.linkWater(water);
    expect(sea()).not.toHaveProperty('WATER_SPARKLE');
    expect(sea()).not.toHaveProperty('WATER_FRESNEL_POWER');
    water.fresnelPower = 4;
    scenery.linkWater(water);
    expect(sea()).toHaveProperty('WATER_FRESNEL_POWER');
    water.fresnelPower = null;
    scenery.linkWater(water);
    expect(sea()).not.toHaveProperty('WATER_FRESNEL_POWER');
    // On high, by default.
    scenery.linkWater(new WaterMaterial({ quality: 'high' }));
    expect(sea()).toHaveProperty('WATER_SPARKLE');
  });

  it('draws a low sea, and the void under it, without what low leaves out', () => {
    const scenery = new SceneryMaterial();
    scenery.sea = true;
    scenery.void = true;
    scenery.linkWater(new WaterMaterial({ quality: 'low' }));
    for (const layer of ['sea', 'water', 'void'] as const)
      for (const name of WATER_QUALITY_DEFINES.low)
        expect(sceneryLayerDefines(scenery, layer)).toHaveProperty(name);
    scenery.linkWater(new WaterMaterial({ quality: 'medium' }));
    for (const name of WATER_QUALITY_DEFINES.low)
      expect(sceneryLayerDefines(scenery, 'sea')).not.toHaveProperty(name);
  });
});

describe('sceneryLayersShown', () => {
  const sea = { level: 0, depth: 100, water: true, buried: false };
  const view = (over: Partial<SceneryLayerView>): SceneryLayerView => ({
    height: 40,
    sea: sea,
    void: { level: -100, transition: 200 },
    cutawayWater: 0,
    voidOpen: false,
    ...over,
  });

  it('draws the sky alone without a sea or a void', () => {
    expect(
      sceneryLayersShown(view({ sea: null, void: null, height: 500 })),
    ).toEqual({
      sky: true,
      void: false,
      sea: false,
      water: false,
    });
  });

  it('draws the sky and the sea from the air, the void only once it can show', () => {
    expect(sceneryLayersShown(view({}))).toEqual({
      sky: true,
      void: false,
      sea: true,
      water: false,
    });
    expect(sceneryLayersShown(view({ voidOpen: true })).void).toBe(true);
  });

  it('draws the view in the water alone, and the sky up through a cutaway', () => {
    expect(sceneryLayersShown(view({ height: -30 }))).toEqual({
      sky: false,
      void: false,
      sea: false,
      water: true,
    });
    const cut = sceneryLayersShown(view({ height: -30, cutawayWater: 1 }));
    expect(cut.sky && cut.water).toBe(true);
  });

  it('draws both sides near the surface: each shader picks its own', () => {
    const shown = sceneryLayersShown(view({ height: 0.001 }));
    expect(shown.sea && shown.water).toBe(true);
  });

  it('draws the void alone below the seabed, and in rock under a stage’s ground', () => {
    const only = {
      sky: false,
      void: true,
      sea: false,
      water: false,
    };
    expect(sceneryLayersShown(view({ height: -500 }))).toEqual(only);
    expect(sceneryLayersShown(view({ sea: { ...sea, buried: true } }))).toEqual(
      only,
    );
  });

  it('draws the view in the water in a trench below the seabed, over a stage’s ground', () => {
    const trench = view({ height: -500, sea: { ...sea, trench: true } });
    expect(sceneryLayersShown(trench)).toEqual({
      sky: false,
      void: false,
      sea: false,
      water: true,
    });
  });

  it('fades the void in over the sky without a sea', () => {
    const fading = sceneryLayersShown(view({ sea: null, height: -200 }));
    expect(fading.sky && fading.void).toBe(true);
    const under = sceneryLayersShown(view({ sea: null, height: -400 }));
    expect(under.sky).toBe(false);
    expect(under.void).toBe(true);
    expect(sceneryLayersShown(view({ sea: null, height: 50 })).void).toBe(
      false,
    );
  });
});

describe('sceneryGroundShown', () => {
  const sea = { level: 0, depth: 100, water: true, buried: false };
  const view = (over: Partial<SceneryLayerView>): SceneryLayerView => ({
    height: 40,
    sea,
    void: { level: -100, transition: 200 },
    cutawayWater: 0,
    voidOpen: false,
    ...over,
  });

  it('hides what lies below the closed ground from above, and above it from below', () => {
    expect(sceneryGroundShown(view({}), true)).toEqual({
      below: false,
      above: true,
    });
    expect(sceneryGroundShown(view({ height: -500 }), true)).toEqual({
      below: true,
      above: false,
    });
    // In rock under a stage's ground, below it whatever the height.
    expect(
      sceneryGroundShown(view({ sea: { ...sea, buried: true } }), true),
    ).toEqual({ below: true, above: false });
  });

  it('shows both sides near the seabed, and in a trench above it', () => {
    expect(sceneryGroundShown(view({ height: -100 }), true)).toEqual({
      below: true,
      above: true,
    });
    expect(
      sceneryGroundShown(
        view({ height: -150, sea: { ...sea, trench: true } }),
        true,
      ),
    ).toEqual({ below: false, above: true });
  });

  it('shows both sides while the ground is open, or without a sea', () => {
    const both = { below: true, above: true };
    expect(sceneryGroundShown(view({}), false)).toEqual(both);
    expect(sceneryGroundShown(view({ voidOpen: true }), true)).toEqual(both);
    expect(sceneryGroundShown(view({ sea: null }), true)).toEqual(both);
  });
});
