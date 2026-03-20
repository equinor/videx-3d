import { Vec2 } from '../../types/common';
import { ProjectedTrajectory } from '../../utils/trajectory';

export type VerticalSlice = {
  trajectory: ProjectedTrajectory;
  depthRange: Vec2;
  samples: Vec2;
  values: Float32Array;
  valueRange: Vec2;
};
