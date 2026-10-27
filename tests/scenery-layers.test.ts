import { describe, expect, it } from 'vitest';
import {
  sceneryLayerDefines,
  sceneryLayers,
  sceneryLayersShown,
  SceneryLayerView,
} from '../src/components/Scenery/scenery-layers';
import { SceneryMaterial } from '../src/components/Scenery/scenery-material';

const key = (defines: Record<string, unknown>) => JSON.stringify(defines);

describe('sceneryLayers', () => {
  it('draws the sky alone without features', () => {
    expect(sceneryLayers(new SceneryMaterial())).toEqual(['sky']);
  });

  it('adds each feature as a layer of its own, in order', () => {
    const sky = new SceneryMaterial();
    sky.clouds = true;
    sky.abyss = true;
    sky.ocean = true;
    expect(sceneryLayers(sky)).toEqual([
      'sky',
      'clouds',
      'abyss',
      'sea',
      'water',
      'surface',
    ]);
  });

  it('draws no clouds with the void in the sky’s place', () => {
    const sky = new SceneryMaterial();
    sky.clouds = true;
    sky.voidBackground = true;
    expect(sceneryLayers(sky)).toEqual(['sky']);
  });
});

describe('sceneryLayerDefines', () => {
  it('leaves the sky’s own program alone when a feature switches', () => {
    const sky = new SceneryMaterial();
    const before = key(sky.defines);
    const version = sky.switchesVersion;
    sky.clouds = true;
    sky.ocean = true;
    sky.abyss = true;
    sky.abyssWalls = true;
    expect(key(sky.defines)).toBe(before);
    expect(sky.switchesVersion).toBeGreaterThan(version);
  });

  it('keeps the clouds’ program through the sea’s and the void’s switches', () => {
    const sky = new SceneryMaterial();
    sky.clouds = true;
    const clouds = key(sceneryLayerDefines(sky, 'clouds'));
    sky.ocean = true;
    sky.abyss = true;
    sky.abyssWalls = true;
    // The default seabed has a detail of its own: off is a change.
    sky.oceanBedDetail = undefined;
    expect(key(sceneryLayerDefines(sky, 'clouds'))).toBe(clouds);
  });

  it('recompiles the void, not the sea, for its walls', () => {
    const sky = new SceneryMaterial();
    sky.ocean = true;
    sky.abyss = true;
    const abyss = key(sceneryLayerDefines(sky, 'abyss'));
    const sea = key(sceneryLayerDefines(sky, 'sea'));
    sky.abyssWalls = true;
    expect(key(sceneryLayerDefines(sky, 'abyss'))).not.toBe(abyss);
    expect(key(sceneryLayerDefines(sky, 'sea'))).toBe(sea);
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
    sky.clouds = true;
    const keys = (['clouds', 'abyss', 'sea', 'water'] as const).map(layer =>
      key(sceneryLayerDefines(sky, layer)),
    );
    expect(new Set(keys).size).toBe(4);
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
      clouds: true,
      abyss: false,
      sea: false,
      water: false,
    });
  });

  it('draws the sky and the sea from the air, the void only once it can show', () => {
    expect(sceneryLayersShown(view({}))).toEqual({
      sky: true,
      clouds: true,
      abyss: false,
      sea: true,
      water: false,
    });
    expect(sceneryLayersShown(view({ voidOpen: true })).abyss).toBe(true);
  });

  it('draws the view in the water alone, and the sky up through a cutaway', () => {
    expect(sceneryLayersShown(view({ height: -30 }))).toEqual({
      sky: false,
      clouds: false,
      abyss: false,
      sea: false,
      water: true,
    });
    const cut = sceneryLayersShown(view({ height: -30, cutawayWater: 1 }));
    expect(cut.sky && cut.clouds && cut.water).toBe(true);
  });

  it('draws both sides near the surface: each shader picks its own', () => {
    const shown = sceneryLayersShown(view({ height: 0.001 }));
    expect(shown.sea && shown.water).toBe(true);
  });

  it('draws the void alone below the seabed, and in rock under a stage’s ground', () => {
    const only = {
      sky: false,
      clouds: false,
      abyss: true,
      sea: false,
      water: false,
    };
    expect(sceneryLayersShown(view({ height: -500 }))).toEqual(only);
    expect(
      sceneryLayersShown(view({ ocean: { ...sea, buried: true } })),
    ).toEqual(only);
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
