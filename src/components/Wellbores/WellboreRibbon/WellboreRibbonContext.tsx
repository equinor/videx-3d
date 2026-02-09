import { createContext } from 'react';
import { InstancedBufferGeometry } from 'three';
import { Trajectory, Vec3 } from '../../../sdk';

/**
 * WellboreRibbonContext props
 * @expand
 */
export type WellboreRibbonContextProps = {
  trajectory: Trajectory;
  geometry: InstancedBufferGeometry;
  direction: Vec3;
};

/**
 * WellboreRibbon context
 * @group Contexts
 */
export const WellboreRibbonContext =
  createContext<WellboreRibbonContextProps | null>(null);
