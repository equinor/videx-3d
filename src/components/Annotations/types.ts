import { RefObject } from 'react';
import { Matrix4 } from 'three';
import { Vec2, Vec3 } from '../../sdk';

export type AnnotationProps = {
  id: string;
  name: string;
  position: Vec3;
  matrixWorld?: Matrix4;
  scope?: string;
  data?: any;
  priority?: number;
  direction?: Vec3;
};

export type AnnotationComponentProps = AnnotationProps & {
  instanceId: string;
};

export type AnnotationLayer = {
  id: string;
  name: string;
  visible: boolean;
  priority: number;
  distanceFactor: number;
  minDistance: number;
  maxDistance: number;
  labelOffset: number;
  anchorOcclusionRadius: number;
  anchorSize: number;
  anchorColor: string;
  connectorWidth: number;
  connectorColor: string;
  onClick?: (annotation: AnnotationComponentProps) => void;
  labelComponent?: (props: AnnotationComponentProps) => React.JSX.Element;
  //annotations: AnnotationProps[],
};

export type AnnotationInstanceState = {
  visible: boolean;
  health: number;
  distance: number;
  position: Vec3;
  inViewSpace?: boolean;
  occluded?: boolean;
  inTransition?: boolean;
  transitionTime?: number;
  quadrant?: number;
  positionSlot?: number;
  screenPosition: Vec2;
  labelPosition?: Vec2;
  scaledOffset?: Vec2;
  anchorPosition?: Vec2;
  prevAnchorPosition?: Vec2;
  prevLabelPosition?: Vec2;
  prevQuadrant?: number;
  scaleFactor?: number;
  labelHovered?: boolean;
  boost?: boolean;
  kill?: boolean;
  cooldown?: number;
  opacity?: number;
  labelWidht: number;
  labelHeight: number;
  labelX?: number;
  labelY?: number;
  anchorX?: number;
  anchorY?: number;
  zIndex: number;
  capped?: boolean;
  _visibility?: string;
  _opacity?: string;
  _zIndex?: string;
  _transform?: string;
  _needsUpdate?: boolean;
};

export type AnnotationInstance = {
  id: string;
  ref: RefObject<HTMLDivElement | null> | null;
  layer: AnnotationLayer;
  annotation: AnnotationProps;
  priority: number;
  rank: number;
  state: AnnotationInstanceState;
};
