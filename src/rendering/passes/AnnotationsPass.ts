import {
  Camera,
  CanvasTexture,
  Clock,
  createCanvasElement,
  Matrix4,
  PerspectiveCamera,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

import { useAnnotationsState } from '../../components/Annotations/annotations-state';
import { AnnotationInstance } from '../../components/Annotations/types';

import {
  annotationsActivity,
  postProcessInstances,
  preprocessInstances,
  updateInstanceDOMElements,
} from '../../components/Annotations/update-annotations';
import {
  ANCHOR_IN_VIEW,
  ANCHOR_OCCLUDED,
  AnchorOcclusion,
} from '../anchor-occlusion';
import { FullscreenRenderer } from '../fullscreen-renderer';
import { Pass } from '../Pass';

const size = new Vector2();
const TAU = Math.PI * 2;
let x1: number, y1: number, x2: number, y2: number;

// Reusable scratch buffers to avoid per-frame heap allocations in the overlay.
const _overlayList: AnnotationInstance[] = [];
const _cursor: [number, number] = [0, 0];

export class AnnotationsPass extends Pass {
  maxVisible: number;
  camera: PerspectiveCamera;
  clock: Clock;
  pointer: Vector2;
  ctx: CanvasRenderingContext2D;
  overlayTexture: CanvasTexture | null = null;
  /** whether the anchors are hidden behind the scene, tested on the GPU (shared with the labels' pass) */
  occlusion: AnchorOcclusion;
  annotationsData: AnnotationInstance[] = [];
  dataTextureNeedsUpdate = false;
  fullscreenRenderer = new FullscreenRenderer();
  unsubscribeListeners: () => void;

  // Settled-state tracking: skip the expensive post-process/overlay work when
  // the camera is static and nothing is animating or changing.
  private prevCameraMatrix = new Matrix4();
  private prevPointerX = NaN;
  private prevPointerY = NaN;
  private prevSizeX = 0;
  private prevSizeY = 0;
  private occlusionChanged = false;

  // Connector-length gate: suppress connector lines that stretch far beyond
  // what a resting connector plus reasonable per-frame motion (at
  // `connectorTargetFrameTime`) would produce. Avoids long, distracting lines
  // during low fps / fast camera moves.
  connectorTargetFrameTime = 0.016;
  connectorStretchSlack = 2;
  // Motion-independent budget floor: the connector may always reach this
  // multiple of its resting length. Without it the budget collapses to ~rest
  // length when the camera is slow/static, dropping connectors during the
  // normal collision-driven label re-slotting (a transitioning label's frozen
  // previous anchor lags the moving anchor, so the line briefly exceeds rest
  // length). Only genuinely runaway connectors are then suppressed.
  connectorRestStretch = 2.5;

  constructor(
    camera: Camera,
    clock: Clock,
    pointer: Vector2,
    maxVisible: number = 100,
  ) {
    super();
    this.camera = camera as PerspectiveCamera;
    this.clock = clock;
    this.pointer = pointer;
    this.maxVisible = maxVisible;

    const ctx = createCanvasElement().getContext('2d');
    if (!ctx) throw Error('Unable to create canvas drawing context!');
    this.ctx = ctx;

    this.occlusion = new AnchorOcclusion(camera);

    const unsubInstanceState = useAnnotationsState.subscribe(
      state => state.instances,
      instances => {
        this.annotationsData = instances;
        this.dataTextureNeedsUpdate = true;
      },
    );

    const onPositionChanged = () => {
      this.dataTextureNeedsUpdate = true;
    };

    addEventListener('annotations-position-changed', onPositionChanged);

    this.unsubscribeListeners = () => {
      unsubInstanceState();
      removeEventListener('annotations-position-changed', onPositionChanged);
    };
  }

  updateAnnotationsData(buffer: Uint8Array) {
    const { annotationsData } = this;

    annotationsData.forEach((instance, i) => {
      if (i < buffer.length) {
        const isOccluded = (buffer[i] & ANCHOR_OCCLUDED) !== 0;
        const isInViewSpace = (buffer[i] & ANCHOR_IN_VIEW) !== 0;

        if (
          instance.state.inViewSpace !== isInViewSpace ||
          instance.state.occluded !== isOccluded
        ) {
          this.occlusionChanged = true;
        }

        instance.state.inViewSpace = isInViewSpace;

        if (!instance.state.occluded && isOccluded) {
          instance.state.kill = true;
        }
        instance.state.occluded = isOccluded;
      }
    });
  }

  updateOverlayTexture(inViewSpace: AnnotationInstance[]) {
    const { ctx, pointer } = this;

    if (
      this.overlayTexture === null ||
      this.overlayTexture.image.width !== size.x ||
      this.overlayTexture.image.height !== size.y
    ) {
      ctx.canvas.width = size.x;
      ctx.canvas.height = size.y;
      this.overlayTexture?.dispose();
      this.overlayTexture = new CanvasTexture(ctx.canvas);
    }

    _cursor[0] = (pointer.x * 0.5 + 0.5) * size.x;
    _cursor[1] = (-pointer.y * 0.5 + 0.5) * size.y;

    ctx.clearRect(0, 0, size.x, size.y);

    // draw overlay to canvas
    _overlayList.length = 0;
    for (let i = 0; i < inViewSpace.length; i++) {
      const d = inViewSpace[i];
      if (!d.state.occluded && !d.state.capped) {
        _overlayList.push(d);
      }
    }
    _overlayList.sort((a, b) => b.state.distance - a.state.distance);

    for (let i = 0; i < _overlayList.length; i++) {
      const instance = _overlayList[i];
      x1 = (instance.state.screenPosition[0] * 0.5 + 0.5) * size.x;
      y1 = (-instance.state.screenPosition[1] * 0.5 + 0.5) * size.y;

      // Per-frame screen motion of the anchor point, used to gate the
      // connector length below. Capture the previous value before updating.
      const connPrevX = instance.state._connPrevX;
      const connPrevY = instance.state._connPrevY;
      instance.state._connPrevX = x1;
      instance.state._connPrevY = y1;

      let radius = instance.layer.anchorSize * instance.state.scaleFactor!;
      let anchorHovered = false;
      // boost instance if not visible and cursor is over anchor point
      if (
        Math.abs(_cursor[0] - x1) <= radius &&
        Math.abs(_cursor[1] - y1) <= radius
      ) {
        if (instance.state.visible) {
          anchorHovered = true;
        } else {
          instance.state.boost = true;
        }
      }

      if (instance.state.labelHovered || anchorHovered) {
        radius *= 1.5;
      }

      if (instance.layer.labelOffset > 0 && instance.state.visible) {
        // connector
        if (instance.state.inTransition && instance.state.prevAnchorPosition) {
          const t = instance.state.transitionTime!;
          const t2 = 1 - t;
          const prevAnchor = instance.state.prevAnchorPosition;
          const anchor = instance.state.anchorPosition!;
          x2 = prevAnchor[0] * t2 + anchor[0] * t;
          y2 = prevAnchor[1] * t2 + anchor[1] * t;
        } else {
          x2 = instance.state.anchorPosition![0];
          y2 = instance.state.anchorPosition![1];
        }

        // Suppress connectors that stretch much further than reasonable
        // per-frame motion would produce. The allowed length is the resting
        // connector length plus the anchor's screen movement normalized to a
        // ~16ms frame: at high fps this barely clips, but at low fps / fast
        // camera motion the actual length far exceeds the budget and the line
        // is skipped (the anchor dot is still drawn).
        let drawConnector = true;
        if (connPrevX !== undefined && connPrevY !== undefined) {
          const cdx = x2 - x1;
          const cdy = y2 - y1;
          const connectorLength = Math.sqrt(cdx * cdx + cdy * cdy);

          const mdx = x1 - connPrevX;
          const mdy = y1 - connPrevY;
          const moveDist = Math.sqrt(mdx * mdx + mdy * mdy);

          const dt = Math.max(annotationsActivity.deltaTime, 1e-4);
          const normalizedMove =
            moveDist * (this.connectorTargetFrameTime / dt);

          const restLength =
            instance.layer.labelOffset * instance.state.scaleFactor!;
          const maxLength =
            restLength * this.connectorRestStretch +
            normalizedMove * this.connectorStretchSlack;

          if (connectorLength > maxLength) {
            drawConnector = false;
          }
        }

        if (drawConnector) {
          let strokeWidth = Math.max(
            0.1,
            instance.layer.connectorWidth * instance.state.scaleFactor!,
          );
          if (instance.state.labelHovered || anchorHovered) {
            strokeWidth *= 2;
          }

          ctx.globalAlpha = instance.state.opacity || 0;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);

          ctx.strokeStyle = instance.layer.connectorColor;
          ctx.lineWidth = strokeWidth;
          ctx.stroke();
        }
      }

      // anchorpoint
      ctx.beginPath();
      ctx.arc(x1, y1, radius, 0, TAU);

      ctx.globalAlpha = instance.state.visible ? 1 : 0.5;
      ctx.fillStyle = instance.layer.anchorColor;

      ctx.fill();

      ctx.globalAlpha = instance.state.opacity || 0;
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }

    this.overlayTexture.needsUpdate = true;
  }

  updateDataTexture() {
    const instances = this.annotationsData;

    if (instances.length) {
      const data = new Float32Array(instances.length * 4);
      for (let i = 0, j = 0; i < instances.length; i++, j += 4) {
        const instance = instances[i];

        data[j] = instance.state.position[0];
        data[j + 1] = instance.state.position[1];
        data[j + 2] = instance.state.position[2];
        data[j + 3] = instance.layer.anchorOcclusionRadius;
      }
      this.occlusion.setAnchors(data, instances.length);
    }

    this.dataTextureNeedsUpdate = false;
  }

  dispose() {
    this.unsubscribeListeners();
    this.occlusion.dispose();
    this.fullscreenRenderer.dispose();
    this.overlayTexture?.dispose();
  }

  render(renderer: WebGLRenderer, buffer: WebGLRenderTarget | null) {
    renderer.getSize(size);

    const { camera, maxVisible, annotationsData: instances } = this;

    if (
      buffer?.depthTexture &&
      this.annotationsData.length &&
      !this.occlusion.busy
    ) {
      if (this.dataTextureNeedsUpdate) {
        this.updateDataTexture();
      }
      this.occlusion
        .test(
          renderer,
          camera,
          buffer.depthTexture,
          buffer.width,
          buffer.height,
        )
        ?.then(read => this.updateAnnotationsData(read));
    }
    const visibleInstances = preprocessInstances(
      instances,
      camera,
      this.clock,
      maxVisible,
    );

    // Determine whether anything changed since last frame. When the scene is
    // settled (camera static, no animations, no occlusion/position changes,
    // pointer/size unchanged) we skip the expensive post-process, DOM and
    // overlay redraw work and simply re-composite the existing overlay.
    const cameraMoved = !this.prevCameraMatrix.equals(camera.matrixWorld);
    const pointerMoved =
      this.pointer.x !== this.prevPointerX ||
      this.pointer.y !== this.prevPointerY;
    const sizeChanged = size.x !== this.prevSizeX || size.y !== this.prevSizeY;

    const dirty =
      cameraMoved ||
      pointerMoved ||
      sizeChanged ||
      this.occlusionChanged ||
      annotationsActivity.animating ||
      annotationsActivity.positionChanged;

    if (dirty) {
      postProcessInstances(visibleInstances, [size.x, size.y]);
      updateInstanceDOMElements(instances);

      this.updateOverlayTexture(visibleInstances);
    }

    this.prevCameraMatrix.copy(camera.matrixWorld);
    this.prevPointerX = this.pointer.x;
    this.prevPointerY = this.pointer.y;
    this.prevSizeX = size.x;
    this.prevSizeY = size.y;
    this.occlusionChanged = false;

    if (this.overlayTexture !== null) {
      this.fullscreenRenderer.renderTexture(
        renderer,
        buffer,
        this.overlayTexture,
      );
    }
  }
}
