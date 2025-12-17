import { Clock, PerspectiveCamera, Vector3 } from 'three'

import RBush from 'rbush'
import { PI, Vec2, Vec3, clamp, edgeOfRectangle, mixVec2 } from '../../sdk'
import {
  getLabelQuadrant,
  labelAngles,
  labelAnglesMap,
  occlusionTest,
} from './helpers'
import { AnnotationInstance } from './types'

const viewportX = [-0.99, 0.99]
const viewportY = [-0.99, 0.99]
const collisionMargin = 1
const collisionMargin2 = collisionMargin * 2

const healthChangeRate = 3
const transitionRate = 5

const viewDirection = new Vector3()
const position = new Vector3()

let prevTime = 0
let _transform: string, _opacity: string, _zIndex: string
let x: number, y: number

const nearTree = new RBush() // used for near annotations
const distantTree = new RBush() // used for distant annotations

function calculateLabelPosition(
  instance: AnnotationInstance,
  positionSlot: number,
  size: Vec2
) {
  const scale = instance.state.scaleFactor!
  const positionOptions = labelAnglesMap[instance.state.quadrant!]

  const angle = labelAngles[positionOptions[positionSlot]]

  const labelWidth = instance.state.labelWidht || 0
  const labelHeight = instance.state.labelHeight || 0
  const scaledWidth = labelWidth * scale
  const scaledHeight = labelHeight * scale

  const labelEdge = edgeOfRectangle([scaledWidth, scaledHeight], angle)

  const direction: Vec2 = [Math.cos(angle), -Math.sin(angle)]
  const offset = instance.layer.labelOffset! * scale

  const anchorPosition: Vec2 = [
    (instance.state.screenPosition![0] * 0.5 + 0.5) * size[0] +
      direction[0] * offset,
    (-instance.state.screenPosition![1] * 0.5 + 0.5) * size[1] +
      direction[1] * offset,
  ]

  instance.state.anchorPosition = anchorPosition

  instance.state.scaledOffset = [
    (labelWidth - scaledWidth) / 2,
    (labelHeight - scaledHeight) / 2,
  ]

  instance.state.labelPosition = [
    anchorPosition[0] - scaledWidth / 2 + labelEdge[0],
    anchorPosition[1] - scaledHeight / 2 + labelEdge[1],
  ]
}

function setTransition(
  instance: AnnotationInstance,
  assignedSlot: number,
  prevLabelPosition: Vec2 | null,
  prevAnchorPosition: Vec2 | null
) {
  if (
    instance.state.visible &&
    (instance.state.positionSlot !== assignedSlot ||
      (instance.state.prevQuadrant &&
        instance.state.prevQuadrant !== instance.state.quadrant)) &&
    prevLabelPosition
  ) {
    instance.state.inTransition = true
    instance.state.transitionTime = 0
    instance.state.prevLabelPosition = prevLabelPosition
    if (prevAnchorPosition)
      instance.state.prevAnchorPosition = prevAnchorPosition
  }
}

/**
 * PRE-PROCESS INSTANCES
 */
export function preprocessInstances(
  instances: AnnotationInstance[],
  camera: PerspectiveCamera,
  clock: Clock,
  maxVisible: number
) {
  const deltaTime = clock.elapsedTime - prevTime
  const fov = camera.fov
  const fovRad = (fov * PI) / 180

  camera.getWorldDirection(viewDirection)
  let nInViewSpace = 0
  const inViewspace: AnnotationInstance[] = []

  instances.forEach((instance, i) => {
    instance.state.capped = false
    instance.state._needsUpdate = false
    if (!instance.state.visible) {
      instance.state.health = 0
      instance.state.prevAnchorPosition = undefined
      instance.state.prevLabelPosition = undefined
    }

    if (instance.state.kill) {
      if (instance.state.health === 0) {
        instance.state.kill = false
        instance.state.visible = false
      } else if (instance.state.health > 0) {
        instance.state.health = Math.max(
          0,
          instance.state.health - deltaTime * healthChangeRate
        )
      }
    } else if (instance.state.health < 1) {
      instance.state.health = Math.min(
        1,
        Math.max(0, instance.state.health + deltaTime * healthChangeRate)
      )
    }

    if (instance.state.inTransition) {
      instance.state.transitionTime! += deltaTime * transitionRate
      if (instance.state.transitionTime! >= 1) {
        instance.state.inTransition = false
        instance.state.transitionTime = 0
        instance.state.prevAnchorPosition = undefined
        instance.state.prevLabelPosition = undefined
      }
    }

    position.set(...instance.annotation.position)
    const distance = position.distanceTo(camera.position)
    const scaleFactor = Math.max(
      0.25,
      Math.min(
        1,
        (1 / (2 * Math.tan(fovRad / 2) * distance)) *
          instance.layer.distanceFactor
      )
    )

    position.project(camera)
    const screenPosition: Vec3 = [position.x, position.y, position.z]

    const isInViewSpace =
      screenPosition[2] >= 0 &&
      screenPosition[2] <= 1 &&
      screenPosition[0] >= viewportX[0] &&
      screenPosition[0] <= viewportX[1] &&
      screenPosition[1] >= viewportY[0] &&
      screenPosition[1] <= viewportY[1] &&
      (!instance.layer.minDistance || distance >= instance.layer.minDistance) &&
      (!instance.layer.maxDistance || distance <= instance.layer.maxDistance)

    instance.state.screenPosition = screenPosition
    instance.state.distance = distance
    instance.state.scaleFactor = scaleFactor
    instance.state.inViewSpace = isInViewSpace

    if (instance.state.cooldown && instance.state.visible === false) {
      instance.state.cooldown = Math.max(0, instance.state.cooldown - deltaTime)
      instance.rank = 0
    } else {
      // calculate heuristics
      const hPositionPenalty = clamp(
        (screenPosition[0] ** 2 + screenPosition[1] ** 2) / 2,
        0,
        1
      )
      const hDistancePenalty = Math.min(distance, 1000)
      instance.rank = 1000
      instance.rank +=
        instance.priority * 1000 - (hPositionPenalty * 100 + hDistancePenalty)

      if (instance.state.visible) {
        instance.rank += 100
      } else {
        instance.rank -= 100
      }

      if (isInViewSpace && nInViewSpace < maxVisible) {
        nInViewSpace++
        instance.state.prevQuadrant = instance.state.quadrant
        instance.state.quadrant = instance.annotation.direction
          ? getLabelQuadrant(
              screenPosition,
              instance.annotation.position,
              instance.annotation.direction,
              camera
            )
          : 0
      } else {
        instance.state.quadrant = 0
        instance.state.visible = false
        if (i >= maxVisible) {
          instance.state.capped = true
        }
      }
    }

    if (instance.state.boost) {
      instance.state.kill = false
      instance.state.cooldown = 0
      instance.state.visible = true
      instance.rank += 100000
      instance.state.positionSlot = 0
      instance.state.boost = false
    }

    if (instance.state.inViewSpace && !instance.state.capped) {
      inViewspace.push(instance)
    } else {
      if (instance.state._visibility !== 'hidden') {
        instance.state.visible = false
        instance.state._visibility = 'hidden'
        instance.state._needsUpdate = true
      }
    }
  })

  prevTime = clock.elapsedTime

  inViewspace.sort((a, b) => b.rank - a.rank)

  return inViewspace
}

/**
 * OCCLUSION TEST
 */
export async function occlustionTestIntstances(
  candidates: { instance: AnnotationInstance; position: Vec3 }[],
  depthBuffer: Uint8Array,
  depthBufferWidth: number,
  depthBufferHeight: number
) {
  candidates.forEach((candidate) => {
    const isOccluded = occlusionTest(
      candidate.position,
      depthBufferWidth,
      depthBufferHeight,
      depthBuffer
    )

    if (!candidate.instance.state.occluded && isOccluded) {
      candidate.instance.state.kill = true
    }
    candidate.instance.state.occluded = isOccluded
  })
}

/**
 * POST PROCESS INSTANCES
 */
export function postProcessInstances(
  instances: AnnotationInstance[],
  size: Vec2
) {
  nearTree.clear()
  distantTree.clear()

  instances.forEach((instance) => {
    const prevLabelPosition: Vec2 | null = instance.state.labelPosition
      ? [...instance.state.labelPosition]
      : null
    const prevAnchorPosition: Vec2 | null = instance.state.anchorPosition
      ? [...instance.state.anchorPosition]
      : null

    const currentSlot = instance.state.positionSlot || 0
    const element = instance.ref?.current

    if (element) {
      instance.state.labelWidht = element.clientWidth
      instance.state.labelHeight = element.clientHeight
    }

    if (instance.state.kill || instance.state.occluded) {
      calculateLabelPosition(instance, currentSlot, size)
      setTransition(
        instance,
        currentSlot,
        prevLabelPosition,
        prevAnchorPosition
      )
    } else if (!instance.state.cooldown) {
      let positionFound = false

      const slots = currentSlot === 0 ? [0, 1] : [1, 0]

      // calculate label size
      const labelWidth = instance.state.labelWidht
      const labelHeight = instance.state.labelHeight

      const scaledWidth = labelWidth * instance.state.scaleFactor!
      const scaledHeight = labelHeight * instance.state.scaleFactor!

      for (let i = 0; i < slots.length; i++) {
        calculateLabelPosition(instance, slots[i], size)

        // test for overlaps
        const rect = {
          minX: instance.state.labelPosition![0] - collisionMargin,
          minY: instance.state.labelPosition![1] - collisionMargin,
          maxX:
            instance.state.labelPosition![0] + scaledWidth + collisionMargin2,
          maxY:
            instance.state.labelPosition![1] + scaledHeight + collisionMargin2,
        }

        const collisionTree =
          instance.state.scaleFactor! >= 0.5 ? nearTree : distantTree

        if (!collisionTree.collides(rect)) {
          collisionTree.insert(rect)
          positionFound = true
          setTransition(
            instance,
            slots[i],
            prevLabelPosition,
            prevAnchorPosition
          )
          instance.state.positionSlot = slots[i]
          break
        }
      }

      if (!positionFound) {
        instance.state.kill = true
        instance.state.cooldown = 2.5
      } else {
        instance.state.visible = true
      }
    } else {
      instance.state.visible = false
    }

    if (instance.state.visible) {
      instance.state.zIndex = instance.state.labelHovered
        ? 1000000
        : instance.state.kill
        ? 0
        : Math.round((1 / instance.state.distance!) * 100000)
      instance.state.opacity =
        Math.max(0.75, instance.state.scaleFactor!) * instance.state.health

      if (instance.state.inTransition && instance.state.prevLabelPosition) {
        ;[x, y] = mixVec2(
          instance.state.prevLabelPosition,
          instance.state.labelPosition!,
          instance.state.transitionTime
        )
      } else {
        ;[x, y] = instance.state.labelPosition!
      }

      instance.state.labelX = x - instance.state.scaledOffset![0]
      instance.state.labelY = y - instance.state.scaledOffset![1]

      if (element) {
        _transform = `translate(${instance.state.labelX}px,${
          instance.state.labelY
        }px) scale(${instance.state.scaleFactor!})`
        if (_transform !== instance.state._transform) {
          instance.state._transform = _transform
          instance.state._needsUpdate = true
        }
        _opacity = `${instance.state.opacity!}`
        if (_opacity !== instance.state._opacity) {
          instance.state._opacity = _opacity
          instance.state._needsUpdate = true
        }
        _zIndex = `${instance.state.zIndex!}`
        if (_zIndex !== instance.state._zIndex) {
          instance.state._zIndex = _zIndex
          instance.state._needsUpdate = true
        }
        if (instance.state._visibility !== 'visible') {
          instance.state._visibility = 'visible'
          instance.state._needsUpdate = true
        }
      }
    } else if (instance.state._visibility !== 'hidden') {
      instance.state._visibility = 'hidden'
      instance.state._needsUpdate = true
    }
  })
}

export function updateInstanceDOMElements(instances: AnnotationInstance[]) {
  instances
    .filter((d) => d.state._needsUpdate)
    .forEach((instance) => {
      const element = instance.ref?.current
      if (element) {
        if (instance.state._transform)
          element.style.transform = instance.state._transform
        if (instance.state._opacity)
          element.style.opacity = instance.state._opacity
        if (instance.state._zIndex)
          element.style.zIndex = instance.state._zIndex
        if (instance.state._visibility)
          element.style.visibility = instance.state._visibility
      }
    })
}
