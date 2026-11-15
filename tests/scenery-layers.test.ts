import { describe, expect, it } from 'vitest';
import {
  sceneryLayerDefines,
  sceneryLayers,
  sceneryLayersShown,
  SceneryLayerView,
} from '../src/components/Scenery/scenery-layers';
import { SceneryMaterial } from '../src/components/Scenery/scenery-material';
import { OceanMaterial } from '../src/components/Ocean/ocean-material';

const key = (defines: Record<string, unknown>) => JSON.stringify(defines);

describe('sceneryLayers', () => {
  it('draws the sky alone without features', () => {
    expect(sceneryLayers(new SceneryMaterial())).toEqual(['sky']);
  });

  it('adds each feature as a layer of its own, in order', () => {
    const sky = new SceneryMaterial();
    sky.abyss = true;
    sky.ocean = true;
    expect(sceneryLayers(sky)).toEqual([
      'sky',
      'abyss',
      'sea',
      'water',
      'surface',
    ]);
  });
});

describe('sceneryLayerDefines', () => {
  it('leaves the sky’s own program alone when a feature switches', () => {
    const sky = new SceneryMaterial();
    const before = key(sky.defines);
    const version = sky.switchesVersion;
    sky.ocean = true;
    sky.abyss = true;
    expect(key(sky.defines)).toBe(before);
    expect(sky.switchesVersion).toBeGreaterThan(version);
  });

  it('recompiles the sea, not the void, for the seabed’s detail', () => {
    const sky = new SceneryMaterial();
    sky.ocean = true;
    sky.abyss = true;
    const abyss = key(sceneryLayerDefines(sky, 'abyss'));
    const sea = key(sceneryLayerDefines(sky, 'sea'));
    // The default seabed has a detail of its own: off is a change.
    sky.oceanBedDetail = undefined;
    expect(key(sceneryLayerDefines(sky, 'sea'))).not.toBe(sea);
    expect(key(sceneryLayerDefines(sky, 'abyss'))).toBe(abyss);
  });

  it('gives each layer a define of its own, so each is its own program', () => {
    const sky = new SceneryMaterial();
    sky.ocean = true;
    sky.abyss = true;
    const keys = (['abyss', 'sea', 'water'] as const).map(layer =>
      key(sceneryLayerDefines(sky, layer)),
    );
    expect(new Set(keys).size).toBe(3);
  });

  it('draws the sea with its water’s glitter and Fresnel, as they change', () => {
    const sky = new SceneryMaterial();
    sky.ocean = true;
    const water = new OceanMaterial();
    sky.linkOcean(water);
    const sea = () => sceneryLayerDefines(sky, 'sea');
    // No glitter by default on medium, compiled in once asked for.
    expect(sea()).not.toHaveProperty('OCEAN_SPARKLE');
    water.sparkle = 0.5;
    sky.linkOcean(water);
    expect(sea()).toHaveProperty('OCEAN_SPARKLE');
    water.sparkle = null;
    sky.linkOcean(water);
    expect(sea()).not.toHaveProperty('OCEAN_SPARKLE');
    expect(sea()).not.toHaveProperty('OCEAN_FRESNEL_POWER');
    water.fresnelPower = 4;
    sky.linkOcean(water);
    expect(sea()).toHaveProperty('OCEAN_FRESNEL_POWER');
    water.fresnelPower = null;
    sky.linkOcean(water);
    expect(sea()).not.toHaveProperty('OCEAN_FRESNEL_POWER');
    // On high, by default.
    sky.linkOcean(new OceanMaterial({ quality: 'high' }));
    expect(sea()).toHaveProperty('OCEAN_SPARKLE');
  });
});

describe('sceneryLayersShown', () => {
  const sea = { level: 0, depth: 100, water: true, buried: false };
  const view = (over: Partial<SceneryLayerView>): SceneryLayerView => ({
    height: 40,
    ocean: sea,
    abyss: { level: -100, transition: 200 },
    cutawayWater: 0,
    voidOpen: false,
    ...over,
  });

  it('draws the sky alone without a sea or a void', () => {
    expect(
      sceneryLayersShown(view({ ocean: null, abyss: null, height: 500 })),
    ).toEqual({
      sky: true,
      abyss: false,
      sea: false,
      water: false,
    });
  });

  it('draws the sky and the sea from the air, the void only once it can show', () => {
    expect(sceneryLayersShown(view({}))).toEqual({
      sky: true,
      abyss: false,
      sea: true,
      water: false,
    });
    expect(sceneryLayersShown(view({ voidOpen: true })).abyss).toBe(true);
  });

  it('draws the view in the water alone, and the sky up through a cutaway', () => {
    expect(sceneryLayersShown(view({ height: -30 }))).toEqual({
      sky: false,
      abyss: false,
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
      abyss: true,
      sea: false,
      water: false,
    };
    expect(sceneryLayersShown(view({ height: -500 }))).toEqual(only);
    expect(
      sceneryLayersShown(view({ ocean: { ...sea, buried: true } })),
    ).toEqual(only);
  });

  it('draws the view in the water in a trench below the seabed, over a stage’s ground', () => {
    const trench = view({ height: -500, ocean: { ...sea, trench: true } });
    expect(sceneryLayersShown(trench)).toEqual({
      sky: false,
      abyss: false,
      sea: false,
      water: true,
    });
  });

  it('fades the void in over the sky without a sea', () => {
    const fading = sceneryLayersShown(view({ ocean: null, height: -200 }));
    expect(fading.sky && fading.abyss).toBe(true);
    const under = sceneryLayersShown(view({ ocean: null, height: -400 }));
    expect(under.sky).toBe(false);
    expect(under.abyss).toBe(true);
    expect(sceneryLayersShown(view({ ocean: null, height: 50 })).abyss).toBe(
      false,
    );
  });
});
