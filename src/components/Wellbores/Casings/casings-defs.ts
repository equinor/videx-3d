import { Color } from 'three';
import { Vec3 } from '../../../sdk';
import { CasingEffects } from './CasingMaterial';

export const casings = 'casings';

export type CasingSectionType = {
  type: string;
  radius: number;
  innerRadius: number;
  top: number;
  bottom: number;
  length: number;
  attributesBuffer: Float32Array;
  segments: number;
  boundingSphere: {
    center: Vec3;
    radius: number;
  };
};

export type CasingsGeneratorResponse = CasingSectionType[];

/**
 * The component-level default {@link CasingEffects} applied globally to every section
 * (a section's per-face `materialOptions.*.effects` can override individual sub-effects
 * on top of this). Tuned to help adjacent/nested strings read apart.
 */
export const defaultCasingEffects: CasingEffects = {
  silhouette: { strength: 0.35, power: 3 },
  edgeShading: { strength: 0.5, width: 0.2 },
  weathering: { strength: 0.3, scale: 1.5 },
  sectionVariation: 0.35,
  detailQuality: 0.6,
};

/**
 * A custom function may be passed to the component, but this is not well documented at this time
 * as this behavior is subject to change.
 */
export const defaultMaterialOptions = (section: CasingSectionType) => {
  const isShoe = section.type.toLowerCase().includes('shoe');

  // Casing exterior is coated, so it's less reflective/brushed/worn than the bare
  // metal of the bore (inner) and freshly cut faces (slice).
  const defaultParams = {
    color: '#4c5160',
    roughness: 0.8,
    metalness: 0.75,
    effects: { weathering: { resistance: 0.6 } },
  };
  // Shoes: a matte, dark (but not pure-black, so it's still lit by ambient on a dark
  // background) casing element that mostly resists the procedural wear.
  const shoeParams = {
    color: '#33343b',
    roughness: 1,
    metalness: 0,
    effects: { weathering: { resistance: 0.25 } },
  };

  const primary = isShoe ? shoeParams : defaultParams;

  const sliceColor = new Color(primary.color).multiplyScalar(0.5);
  const slice = isShoe
    ? {
        color: sliceColor,
        roughness: 1,
        metalness: 0,
        effects: { weathering: { resistance: 0.25 } },
      }
    : { color: sliceColor, roughness: 0.9, metalness: 0.8 };

  return {
    primary,
    inner: { color: '#bed0e4', roughness: 0.5, metalness: 0.75 },
    slice,
  };
};
