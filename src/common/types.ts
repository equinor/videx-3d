import { Layers } from '@react-three/fiber';
import { Material } from 'three';
import { Vec3 } from '../sdk';

/**
 * Common props for 3d components
 */
export type CommonComponentProps = {
  /** The `name` of its three.js object. */
  name?: string;
  /** Whether it is drawn (`visible`). */
  visible?: boolean;
  /** The `userData` of its three.js object. */
  userData?: Record<string, any>;
  /** Its position, in its parent's coordinates. */
  position?: Vec3;
  /** Whether it casts shadows (`castShadow`). */
  castShadow?: boolean;
  /** Whether it receives shadows (`receiveShadow`). */
  receiveShadow?: boolean;
  /** The `renderOrder` of its three.js object. */
  renderOrder?: number;
  /** The `layers` of its three.js object. */
  layers?: Layers;
};

/**
 * Common props for 3d components that allow overriding shader materials
 */
export type CustomMaterialProps = {
  /** A material, or one per part, to draw with instead of the component's own. */
  customMaterial?: Material | Material[];
  /** A custom depth material, for shadows. */
  customDepthMaterial?: Material;
  /** A custom distance material, for point-light shadows. */
  customDistanceMaterial?: Material;
  /** Called with the component's look (its colour, opacity …) and its material(s) as they change, in place of its own update: set your uniforms here. */
  onMaterialPropertiesChange?: (
    props: Record<string, any>,
    material: Material | Material[],
  ) => void;
};

/**
 * How a procedural line/marker modulates the underlying colour. Shared by the `Surface`
 * contour lines and the `Trajectory` depth markers so the behaviour is consistent across
 * components.
 */
export enum ContourColorMode {
  /** Darken the colour toward black at the line. */
  darken = 0,
  /** Lighten the colour toward white at the line. */
  lighten = 1,
  /** Blend the colour toward a fixed marker colour at the line. */
  mixed = 2,
}
