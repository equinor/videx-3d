import { Clock, PerspectiveCamera, Vector3 } from 'three';

import RBush from 'rbush';
import { PI, Vec2, Vec3, clamp, edgeOfRectangle } from '../../sdk';
import { getLabelQuadrant, labelAngles, labelAnglesMap } from './helpers';
import { getAnnotationPosition } from './index';
import { AnnotationInstance } from './types';

const collisionMargin = 1;
const collisionMargin2 = collisionMargin * 2;

const healthChangeRate = 3;
const transitionRate = 5;

const position = new Vector3();

let prevTime = 0;
let _transform: string, _opacity: string, _zIndex: string;
let x: number, y: number;

// Reusable scratch buffers to avoid per-frame heap allocations in the hot path.
const _rect: Vec2 = [0, 0];
const _labelEdge: Vec2 = [0, 0];
const _posScratch: Vec3 = [0, 0, 0];
const _prevLabel: Vec2 = [0, 0];
const _prevAnchor: Vec2 = [0, 0];

const nearTree = new RBush(); // used for near annotations
const distantTree = new RBush(); // used for distant annotations

/**
 * Activity flags updated by preprocessInstances each frame. Used by
 * AnnotationsPass to skip the expensive post-process/overlay work when the
 * scene is settled (camera static and no animations in progress).
 */
export const annotationsActivity = {
  animating: false,
  positionChanged: false,
  deltaTime: 0,
};

function calculateLabelPosition(
  instance: AnnotationInstance,
  positionSlot: number,
  size: Vec2,
) {
  if (!instance || !size) return;
  const scale = instance.state.scaleFactor!;
  const positionOptions = labelAnglesMap[instance.state.quadrant!];

  const angle = labelAngles[positionOptions[positionSlot || 0]];

  const labelWidth = instance.state.labelWidht || 0;
  const labelHeight = instance.state.labelHeight || 0;
  const scaledWidth = labelWidth * scale;
  const scaledHeight = labelHeight * scale;

  _rect[0] = scaledWidth;
  _rect[1] = scaledHeight;
  edgeOfRectangle(_rect, angle, _labelEdge);

  const dirX = Math.cos(angle);
  const dirY = -Math.sin(angle);
  const offset = instance.layer.labelOffset! * scale;

  const anchorX =
    (instance.state.screenPosition![0] * 0.5 + 0.5) * size[0] + dirX * offset;
  const anchorY =
    (-instance.state.screenPosition![1] * 0.5 + 0.5) * size[1] + dirY * offset;

  const anchorPosition =
    instance.state.anchorPosition ?? (instance.state.anchorPosition = [0, 0]);
  anchorPosition[0] = anchorX;
  anchorPosition[1] = anchorY;

  const scaledOffset =
    instance.state.scaledOffset ?? (instance.state.scaledOffset = [0, 0]);
  scaledOffset[0] = (labelWidth - scaledWidth) / 2;
  scaledOffset[1] = (labelHeight - scaledHeight) / 2;

  const labelPosition =
    instance.state.labelPosition ?? (instance.state.labelPosition = [0, 0]);
  labelPosition[0] = anchorX - scaledWidth / 2 + _labelEdge[0];
  labelPosition[1] = anchorY - scaledHeight / 2 + _labelEdge[1];
}

function setTransition(
  instance: AnnotationInstance,
  assignedSlot: number,
  hasPrevLabel: boolean,
  hasPrevAnchor: boolean,
) {
  if (
    instance.state.visible &&
    (instance.state.positionSlot !== assignedSlot ||
      (instance.state.prevQuadrant &&
        instance.state.prevQuadrant !== instance.state.quadrant)) &&
    hasPrevLabel
  ) {
    instance.state.inTransition = true;
    instance.state.transitionTime = 0;
    // Allocate stable snapshot arrays only when a transition actually starts.
    instance.state.prevLabelPosition = [_prevLabel[0], _prevLabel[1]];
    if (hasPrevAnchor)
      instance.state.prevAnchorPosition = [_prevAnchor[0], _prevAnchor[1]];
  }
}

/**
 * PRE-PROCESS INSTANCES
 */
export function preprocessInstances(
  instances: AnnotationInstance[],
  camera: PerspectiveCamera,
  clock: Clock,
  maxVisible: number,
) {
  const deltaTime = clock.elapsedTime - prevTime;
  const halfFovRad = (camera.fov * PI) / 360;

  let nInViewSpace = 0;
  const inViewspace: AnnotationInstance[] = [];
  let positionChanged = false;
  let animating = false;
  instances.forEach(instance => {
    const prevPosition = instance.state.position;
    const worldPosition = getAnnotationPosition(
      instance.annotation,
      _posScratch,
    );
    if (
      worldPosition[0] !== prevPosition[0] ||
      worldPosition[1] !== prevPosition[1] ||
      worldPosition[2] !== prevPosition[2]
    ) {
      positionChanged = true;
      // When no matrixWorld is set, getAnnotationPosition returns the
      // annotation.position array directly; otherwise it writes into the
      // shared scratch buffer, so copy into a stable per-instance array.
      instance.state.position =
        worldPosition === instance.annotation.position
          ? worldPosition
          : [worldPosition[0], worldPosition[1], worldPosition[2]];
    }

    instance.state.capped = false;
    instance.state._needsUpdate = false;
    if (!instance.state.visible) {
      instance.state.health = 0;
      instance.state.prevAnchorPosition = undefined;
      instance.state.prevLabelPosition = undefined;
    }

    if (instance.state.kill) {
      if (instance.state.health === 0) {
        instance.state.kill = false;
        instance.state.visible = false;
      } else if (instance.state.health > 0) {
        instance.state.health = Math.max(
          0,
          instance.state.health - deltaTime * healthChangeRate,
        );
      }
    } else if (instance.state.health < 1) {
      instance.state.health = Math.min(
        1,
        Math.max(0, instance.state.health + deltaTime * healthChangeRate),
      );
    }

    if (instance.state.inTransition) {
      instance.state.transitionTime! += deltaTime * transitionRate;
      if (instance.state.transitionTime! >= 1) {
        instance.state.inTransition = false;
        instance.state.transitionTime = 0;
        instance.state.prevAnchorPosition = undefined;
        instance.state.prevLabelPosition = undefined;
      }
    }

    if (instance.state.inViewSpace) {
      position.set(...instance.state.position);
      instance.state.distance = position.distanceTo(camera.position);
      instance.state.scaleFactor = Math.max(
        0.25,
        Math.min(
          1,
          (1 / (2 * Math.tan(halfFovRad) * instance.state.distance)) *
            instance.layer.distanceFactor,
        ),
      );

      position.project(camera);
      instance.state.screenPosition = [position.x, position.y];

      const withinLimits =
        (!instance.layer.minDistance ||
          instance.state.distance >= instance.layer.minDistance) &&
        (!instance.layer.maxDistance ||
          instance.state.distance <= instance.layer.maxDistance);

      if (withinLimits && nInViewSpace < maxVisible) {
        nInViewSpace++;

        // calculate heuristics
        const hPositionPenalty = clamp(
          (instance.state.screenPosition[0] ** 2 +
            instance.state.screenPosition[1] ** 2) /
            2,
          0,
          1,
        );
        const hDistancePenalty = Math.min(instance.state.distance, 1000);
        instance.rank = 1000;
        instance.rank +=
          instance.priority * 1000 -
          (hPositionPenalty * 100 + hDistancePenalty);

        if (instance.state.visible) {
          instance.rank += 100;
        } else {
          instance.rank -= 100;
        }

        if (instance.state.boost) {
          instance.state.kill = false;
          instance.state.cooldown = 0;
          instance.state.visible = true;
          instance.rank += 100000;
          instance.state.positionSlot = 0;
          instance.state.boost = false;
        }

        instance.state.prevQuadrant = instance.state.quadrant;
        instance.state.quadrant = instance.annotation.direction
          ? getLabelQuadrant(
              instance.state.screenPosition,
              instance.state.position,
              instance.annotation.direction,
              camera,
            )
          : 0;
      } else {
        instance.state.capped = true;
      }

      if (!instance.state.capped) {
        inViewspace.push(instance);
      }
    } else {
      instance.state.quadrant = 0;
      instance.state.visible = false;
    }

    if (instance.state.cooldown && instance.state.visible === false) {
      instance.state.cooldown = Math.max(
        0,
        instance.state.cooldown - deltaTime,
      );
      instance.rank = 0;
    }

    if (
      instance.state._visibility !== 'hidden' &&
      (!instance.state.inViewSpace || instance.state.capped)
    ) {
      instance.state.visible = false;
      instance.state._visibility = 'hidden';
      instance.state._needsUpdate = true;
    }

    // Track whether any instance is mid-animation so the pass can keep
    // updating until everything settles.
    if (
      instance.state.inTransition ||
      instance.state.boost ||
      instance.state.kill ||
      instance.state._needsUpdate ||
      (instance.state.cooldown ?? 0) > 0 ||
      (instance.state.health > 0 && instance.state.health < 1)
    ) {
      animating = true;
    }
  });

  prevTime = clock.elapsedTime;

  inViewspace.sort((a, b) => b.rank - a.rank);

  annotationsActivity.animating = animating;
  annotationsActivity.positionChanged = positionChanged;
  annotationsActivity.deltaTime = deltaTime;

  if (positionChanged) {
    dispatchEvent(new CustomEvent('annotations-position-changed'));
  }
  return inViewspace;
}

/**
 * POST PROCESS INSTANCES
 */
export function postProcessInstances(
  instances: AnnotationInstance[],
  size: Vec2,
) {
  nearTree.clear();
  distantTree.clear();

  instances.forEach(instance => {
    // Capture the previous label/anchor positions into scratch buffers before
    // calculateLabelPosition overwrites them in-place. setTransition allocates
    // stable snapshots from these only when a transition actually starts.
    const hasPrevLabel = !!instance.state.labelPosition;
    if (hasPrevLabel) {
      _prevLabel[0] = instance.state.labelPosition![0];
      _prevLabel[1] = instance.state.labelPosition![1];
    }
    const hasPrevAnchor = !!instance.state.anchorPosition;
    if (hasPrevAnchor) {
      _prevAnchor[0] = instance.state.anchorPosition![0];
      _prevAnchor[1] = instance.state.anchorPosition![1];
    }

    const currentSlot = instance.state.positionSlot || 0;
    const element = instance.ref?.current;

    if (instance.state.kill || instance.state.occluded) {
      calculateLabelPosition(instance, currentSlot, size);
      setTransition(instance, currentSlot, hasPrevLabel, hasPrevAnchor);
    } else if (!instance.state.cooldown) {
      let positionFound = false;

      const slots = currentSlot === 0 ? [0, 1] : [1, 0];

      // calculate label size
      const labelWidth = instance.state.labelWidht;
      const labelHeight = instance.state.labelHeight;

      const scaledWidth = labelWidth * instance.state.scaleFactor!;
      const scaledHeight = labelHeight * instance.state.scaleFactor!;

      for (let i = 0; i < slots.length; i++) {
        calculateLabelPosition(instance, slots[i], size);

        // test for overlaps
        const rect = {
          minX: instance.state.labelPosition![0] - collisionMargin,
          minY: instance.state.labelPosition![1] - collisionMargin,
          maxX:
            instance.state.labelPosition![0] + scaledWidth + collisionMargin2,
          maxY:
            instance.state.labelPosition![1] + scaledHeight + collisionMargin2,
        };

        const collisionTree =
          instance.state.scaleFactor! >= 0.5 ? nearTree : distantTree;

        if (!collisionTree.collides(rect)) {
          collisionTree.insert(rect);
          positionFound = true;
          setTransition(instance, slots[i], hasPrevLabel, hasPrevAnchor);
          instance.state.positionSlot = slots[i];
          break;
        }
      }

      if (!positionFound) {
        instance.state.kill = true;
        instance.state.cooldown = 2.5;
      } else {
        instance.state.visible = true;
      }
    } else {
      instance.state.visible = false;
    }

    if (instance.state.visible) {
      instance.state.zIndex = instance.state.labelHovered
        ? 1000000
        : instance.state.kill
          ? 0
          : Math.round((1 / instance.state.distance!) * 100000);
      instance.state.opacity =
        Math.max(0.75, instance.state.scaleFactor!) * instance.state.health;

      if (instance.state.inTransition && instance.state.prevLabelPosition) {
        const t = instance.state.transitionTime!;
        const t2 = 1 - t;
        const prev = instance.state.prevLabelPosition;
        const curr = instance.state.labelPosition!;
        x = prev[0] * t2 + curr[0] * t;
        y = prev[1] * t2 + curr[1] * t;
      } else {
        x = instance.state.labelPosition![0];
        y = instance.state.labelPosition![1];
      }

      instance.state.labelX = x - instance.state.scaledOffset![0];
      instance.state.labelY = y - instance.state.scaledOffset![1];

      if (element) {
        _transform = `translate(${instance.state.labelX}px,${
          instance.state.labelY
        }px) scale(${instance.state.scaleFactor!})`;
        if (_transform !== instance.state._transform) {
          instance.state._transform = _transform;
          instance.state._needsUpdate = true;
        }
        _opacity = `${instance.state.opacity!}`;
        if (_opacity !== instance.state._opacity) {
          instance.state._opacity = _opacity;
          instance.state._needsUpdate = true;
        }
        _zIndex = `${instance.state.zIndex!}`;
        if (_zIndex !== instance.state._zIndex) {
          instance.state._zIndex = _zIndex;
          instance.state._needsUpdate = true;
        }
        if (instance.state._visibility !== 'visible') {
          instance.state._visibility = 'visible';
          instance.state._needsUpdate = true;
        }
      }
    } else if (instance.state._visibility !== 'hidden') {
      instance.state._visibility = 'hidden';
      instance.state._needsUpdate = true;
    }
  });
}

export function updateInstanceDOMElements(instances: AnnotationInstance[]) {
  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i];
    if (!instance.state._needsUpdate) continue;
    const element = instance.ref?.current;
    if (element) {
      if (instance.state._transform)
        element.style.transform = instance.state._transform;
      if (instance.state._opacity)
        element.style.opacity = instance.state._opacity;
      if (instance.state._zIndex) element.style.zIndex = instance.state._zIndex;
      if (instance.state._visibility)
        element.style.visibility = instance.state._visibility;
    }
  }
}
