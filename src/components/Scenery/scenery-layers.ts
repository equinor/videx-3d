import { useEffect, useMemo } from 'react';
import {
  CustomBlending,
  DoubleSide,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SrcAlphaFactor,
} from 'three';
import layerFragmentShader from './shaders/sky-layer-fragment.glsl';
import skyVertexShader from './shaders/sky-vertex.glsl';
import type { SceneryMaterial } from './scenery-material';
import {
  createScenerySurfaceMaterial,
  sceneryOceanDefines,
} from './scenery-stage';

/**
 * The layers of a `Scenery`'s background, in the order they are drawn, each blended over
 * those before it: the sky itself (the `SceneryMaterial`'s own program), its clouds, the
 * void (lid, depths and walls), the sea seen from the air, the view from in the water, and
 * the sea's surface. Each is a program of its own, so each compiles on its own and a switch
 * recompiles only the layers it touches.
 */
export type SceneryBackgroundLayer =
  | 'sky'
  | 'clouds'
  | 'abyss'
  | 'sea'
  | 'water'
  | 'surface';

/** A layer drawn with a material of its own, over the sky's. */
export type SceneryOverLayer = Exclude<SceneryBackgroundLayer, 'sky'>;

/** Each layer's `renderOrder` after the scenery's. The walls' mesh draws just before the sky. */
export const SCENERY_LAYER_ORDER: Record<SceneryBackgroundLayer, number> = {
  sky: 0,
  clouds: 0.2,
  abyss: 0.4,
  sea: 0.6,
  water: 0.8,
  surface: 1,
};

/** The layers a scenery with `sky`'s switches draws, in order. */
export function sceneryLayers(sky: SceneryMaterial): SceneryBackgroundLayer[] {
  const layers: SceneryBackgroundLayer[] = ['sky'];
  if (sky.clouds && !sky.voidBackground) layers.push('clouds');
  if (sky.abyss) layers.push('abyss');
  // The view in the water is compiled with the sea, so switching the water on is instant.
  if (sky.ocean) layers.push('sea', 'water', 'surface');
  return layers;
}

/**
 * What `layer` compiles with: those of `sky`'s switches it needs and no more. In the same
 * order wherever it is made, as a program is keyed on the order of its defines.
 */
export function sceneryLayerDefines(
  sky: SceneryMaterial,
  layer: Exclude<SceneryOverLayer, 'surface'>,
) {
  const defines: Record<string, unknown> = { SKY_AT_FAR: '' };
  const switches = sky.switches;
  if (layer === 'clouds') {
    defines.SKY_LAYER_CLOUDS = '';
    defines.SKY_CLOUDS = '';
  } else if (layer === 'abyss') {
    defines.SKY_LAYER_ABYSS = '';
    defines.SKY_ABYSS = '';
    if (sky.abyssWalls) defines.SKY_ABYSS_WALLS = '';
    // Under a sea, where it leaves the void showing: the sea's code, but not its seabed's detail.
    if (sky.ocean) {
      defines.SKY_OCEAN = '';
      for (const key of ['OCEAN_WAVE_COUNT', 'OCEAN_CONTACT_COUNT'])
        if (switches[key] !== undefined) defines[key] = switches[key];
    }
  } else {
    defines[layer === 'sea' ? 'SKY_LAYER_SEA' : 'SKY_LAYER_WATER'] = '';
    Object.assign(defines, sceneryOceanDefines(sky));
    // With no void of its own under it, the sea fills in its own.
    if (!sky.abyss) delete defines.SKY_ABYSS;
  }
  return defines;
}

/**
 * A material for one of a scenery's background layers over its sky (see
 * {@link SceneryBackgroundLayer}), sharing `sky`'s uniform objects. On the far plane, with a
 * depth test unless `depthTest` is false (as the bakes draw it), so it is shaded only where
 * nothing nearer is drawn. Blended with its alpha over the layers before it, without being
 * `transparent`, so it stays in the opaque list, after them.
 */
export function createSceneryLayerMaterial(
  sky: SceneryMaterial,
  layer: SceneryOverLayer,
  depthTest = true,
): ShaderMaterial {
  const material =
    layer === 'surface'
      ? createScenerySurfaceMaterial(sky)
      : new ShaderMaterial({
          vertexShader: skyVertexShader,
          fragmentShader: layerFragmentShader,
          uniforms: sky.uniforms,
          defines: sceneryLayerDefines(sky, layer),
          side: DoubleSide,
          depthWrite: false,
          fog: true,
          dithering: true,
          // The seabed is lit by the scene's lights.
          lights: layer === 'sea' || layer === 'water',
          // ⚠️ Alpha as three's normal blending does, or the canvas turns see-through here.
          blending: CustomBlending,
          blendSrc: SrcAlphaFactor,
          blendDst: OneMinusSrcAlphaFactor,
          blendSrcAlpha: OneFactor,
          blendDstAlpha: OneMinusSrcAlphaFactor,
        });
  material.name = `scenery-${layer}`;
  material.depthTest = depthTest;
  return material;
}

/**
 * A layer's material while `on`, made again only when what it compiles with changes (its
 * defines, read from `sky`'s switches in this render), and disposed once replaced or gone.
 */
export function useSceneryLayerMaterial(
  sky: SceneryMaterial,
  layer: Exclude<SceneryOverLayer, 'surface'>,
  on: boolean,
) {
  const key = on ? JSON.stringify(sceneryLayerDefines(sky, layer)) : null;
  const material = useMemo(
    () => (key === null ? null : createSceneryLayerMaterial(sky, layer)),
    [sky, layer, key],
  );
  useEffect(() => () => material?.dispose(), [material]);
  return material;
}

/** Where the camera is, for {@link sceneryLayersShown}. */
export type SceneryLayerView = {
  /** the camera's height along up, as the sky measures it (`SceneryMaterial.heightOf`) */
  height: number;
  /** the sea, if any: its levels, its switches, and whether the camera is in rock under a stage's ground (`SceneryMaterial.oceanBuried`) */
  ocean: {
    level: number;
    depth: number;
    water: boolean;
    buried: boolean;
  } | null;
  /** the void, if any: its level and how far below it it fades in (without a sea; with one it is the seabed) */
  abyss: { level: number; transition: number } | null;
  /** how much of the water a cutaway cuts: 0 without one */
  cutawayWater: number;
  /** the void can show from above the seabed (`SceneryMaterial.abyssOpenFromAbove`) */
  voidOpen: boolean;
};

// How far past a level the camera must be for a layer to be left out: each layer's shader
// draws nothing on the wrong side of it itself, so only near it is anything drawn twice.
const LEVEL_MARGIN = 0.01;

/**
 * Which of the layers before the sea's surface can show from where the camera is: the rest
 * draw nothing there, and are left out to spare their cost. Each shader finds where it
 * shows itself, so near a level both sides are drawn.
 */
export function sceneryLayersShown({
  height,
  ocean,
  abyss,
  cutawayWater,
  voidOpen,
}: SceneryLayerView): Record<
  Exclude<SceneryOverLayer, 'surface'> | 'sky',
  boolean
> {
  const m = LEVEL_MARGIN;
  const bed = ocean ? ocean.level - ocean.depth : 0;
  // Surely below the seabed, as every layer's view starts from there in rock (skyViewOrigin).
  const belowBed = !!ocean && (ocean.buried || height < bed - m);
  const maybeBelowBed = !!ocean && (ocean.buried || height < bed + m);
  const inWater =
    !!ocean &&
    ocean.water &&
    !belowBed &&
    height > bed + m &&
    height < ocean.level - m;
  const maybeInWater =
    !!ocean && ocean.water && !belowBed && height < ocean.level + m;
  // Under the void's lid once it has faded in, it hides all of the sky (skyAbyssUnder).
  const covered =
    !!abyss && (ocean ? belowBed : height < abyss.level - abyss.transition - m);
  const underLid =
    !!abyss && (ocean ? maybeBelowBed : height < abyss.level + m);
  // In the water only up through the cutaway's cut.
  const sky = !covered && !(inWater && cutawayWater <= 0);
  return {
    sky,
    clouds: sky,
    abyss: underLid || (!!abyss && !!ocean && !belowBed && voidOpen),
    sea: !!ocean && !belowBed && !inWater,
    water: maybeInWater,
  };
}
