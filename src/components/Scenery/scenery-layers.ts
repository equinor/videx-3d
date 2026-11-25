import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  CustomBlending,
  DoubleSide,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SrcAlphaFactor,
} from 'three';
import { releaseMaterial } from '../../rendering/precompile';
import { drawsSharedTextures } from '../../common/shared-textures';
import { SURFACE_DETAIL_DEFINES } from '../../sdk/materials/surface-detail';
import layerFragmentShader from './shaders/scenery-layer-fragment.glsl';
import sceneryVertexShader from './shaders/scenery-vertex.glsl';
import { SCENERY_SEA_DEFINES, type SceneryMaterial } from './scenery-material';
import {
  createScenerySurfaceMaterial,
  scenerySeaDefines,
} from './scenery-stage';

/**
 * The layers of a `Scenery`'s background, in the order they are drawn, each blended over
 * those before it: the sky itself (the `SceneryMaterial`'s own program), the void (lid and
 * depths), the sea seen from the air, the view from in the water, and the sea's surface. Each is a program of its own, so each compiles on its own and a switch
 * recompiles only the layers it touches.
 */
export type SceneryBackgroundLayer =
  | 'sky'
  | 'void'
  | 'sea'
  | 'water'
  | 'surface';

/** A layer drawn with a material of its own, over the sky's. */
export type SceneryOverLayer = Exclude<SceneryBackgroundLayer, 'sky'>;

/** Each layer's `renderOrder` after the scenery's. */
export const SCENERY_LAYER_ORDER: Record<SceneryBackgroundLayer, number> = {
  sky: 0,
  void: 0.4,
  sea: 0.6,
  water: 0.8,
  surface: 1,
};

/** The layers a scenery with `sky`'s switches draws, in order. */
export function sceneryLayers(
  scenery: SceneryMaterial,
): SceneryBackgroundLayer[] {
  const layers: SceneryBackgroundLayer[] = ['sky'];
  if (scenery.void) layers.push('void');
  // The view in the water is compiled with the sea, so switching the water on is instant.
  if (scenery.sea) layers.push('sea', 'water', 'surface');
  return layers;
}

/**
 * What `layer` compiles with: those of `sky`'s switches it needs and no more. In the same
 * order wherever it is made, as a program is keyed on the order of its defines.
 */
export function sceneryLayerDefines(
  scenery: SceneryMaterial,
  layer: Exclude<SceneryOverLayer, 'surface'>,
) {
  const defines: Record<string, unknown> = { SCENERY_AT_FAR: '' };
  const switches = scenery.switches;
  if (layer === 'void') {
    defines.SCENERY_LAYER_VOID = '';
    defines.SCENERY_VOID = '';
    // Under a sea, where it leaves the void showing: the sea's code, but not its seabed's detail.
    if (scenery.sea) {
      defines.SCENERY_SEA = '';
      for (const key of SCENERY_SEA_DEFINES)
        if (switches[key] !== undefined) defines[key] = switches[key];
    }
  } else {
    defines[layer === 'sea' ? 'SCENERY_LAYER_SEA' : 'SCENERY_LAYER_WATER'] = '';
    Object.assign(defines, scenerySeaDefines(scenery));
    // With no void of its own under it, the sea fills in its own.
    if (!scenery.void) delete defines.SCENERY_VOID;
    // Under a relief its seabed shows only where none of its tiles is drawn: plain, in the
    // relief's look (SceneryMaterial.seaReliefBed), without the detail.
    if (scenery.seaReliefBed) {
      for (const key of SURFACE_DETAIL_DEFINES) delete defines[key];
      defines.SCENERY_SEABED_LOOK = '';
    }
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
  scenery: SceneryMaterial,
  layer: SceneryOverLayer,
  depthTest = true,
): ShaderMaterial {
  const material =
    layer === 'surface'
      ? createScenerySurfaceMaterial(scenery)
      : drawsSharedTextures(
          new ShaderMaterial({
            vertexShader: sceneryVertexShader,
            fragmentShader: layerFragmentShader,
            uniforms: scenery.uniforms,
            defines: sceneryLayerDefines(scenery, layer),
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
          }),
        );
  material.name = `scenery-${layer}`;
  material.depthTest = depthTest;
  return material;
}

/**
 * A layer's material while `on`, made again only when what it compiles with changes (its
 * defines, read from `sky`'s switches in this render), and disposed once replaced or gone.
 */
export function useSceneryLayerMaterial(
  scenery: SceneryMaterial,
  layer: Exclude<SceneryOverLayer, 'surface'>,
  on: boolean,
) {
  const key = on ? JSON.stringify(sceneryLayerDefines(scenery, layer)) : null;
  const gl = useThree(state => state.gl);
  const material = useMemo(
    () => (key === null ? null : createSceneryLayerMaterial(scenery, layer)),
    [scenery, layer, key],
  );
  // Let go once its program has linked (`releaseMaterial`).
  useEffect(
    () => () => {
      if (material) releaseMaterial(gl, material);
    },
    [gl, material],
  );
  return material;
}

/** Where the camera is, for {@link sceneryLayersShown}. */
export type SceneryLayerView = {
  /** the camera's height along up, as the sky measures it (`SceneryMaterial.heightOf`) */
  height: number;
  /** the sea, if any: its levels, its switches, and whether the camera is in rock under a stage's ground (`SceneryMaterial.seaBuried`) or over it below the sea's seabed (`SceneryMaterial.seaTrench`) */
  sea: {
    level: number;
    depth: number;
    water: boolean;
    buried: boolean;
    trench?: boolean;
  } | null;
  /** the void, if any: its level and how far below it it fades in (without a sea; with one it is the seabed) */
  void: { level: number; transition: number } | null;
  /** how much of the water a cutaway cuts: 0 without one */
  cutawayWater: number;
  /** the void can show from above the seabed (`SceneryMaterial.voidOpenFromAbove`) */
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
  height: cameraHeight,
  sea,
  void: voidBand,
  cutawayWater,
  voidOpen,
}: SceneryLayerView): Record<
  Exclude<SceneryOverLayer, 'surface'> | 'sky',
  boolean
> {
  const m = LEVEL_MARGIN;
  const bed = sea ? sea.level - sea.depth : 0;
  // In a trench, every layer's view starts just above the seabed (sceneryViewOrigin).
  const height = sea?.trench
    ? bed + Math.min(1, 0.5 * sea.depth)
    : cameraHeight;
  // Surely below the seabed, as every layer's view starts from there in rock (sceneryViewOrigin).
  const belowBed = !!sea && (sea.buried || height < bed - m);
  const maybeBelowBed = !!sea && (sea.buried || height < bed + m);
  const inWater =
    !!sea &&
    sea.water &&
    !belowBed &&
    height > bed + m &&
    height < sea.level - m;
  const maybeInWater =
    !!sea && sea.water && !belowBed && height < sea.level + m;
  // Under the void's lid once it has faded in, it hides all of the sky (sceneryVoidUnder).
  const covered =
    !!voidBand &&
    (sea ? belowBed : height < voidBand.level - voidBand.transition - m);
  const underLid =
    !!voidBand && (sea ? maybeBelowBed : height < voidBand.level + m);
  // In the water only up through the cutaway's cut.
  const sky = !covered && !(inWater && cutawayWater <= 0);
  return {
    sky,
    void: underLid || (!!voidBand && !!sea && !belowBed && voidOpen),
    sea: !!sea && !belowBed && !inWater,
    water: maybeInWater,
  };
}
