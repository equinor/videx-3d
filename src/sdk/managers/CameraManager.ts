import { CameraControls } from '@react-three/drei';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  cameraFlyToEventType,
  cameraFocusAtPointEventType,
  cameraLookAtEventType,
  cameraSetPositionEventType,
} from '../../events/camera-events';
import { Vec3 } from '../types/common';

const cameraTarget = new Vector3();
const cameraPosition = new Vector3();
const direction = new Vector3();
const v1 = new Vector3();
const v2 = new Vector3();

/**
 * Closest a fly-to may end up, as a share of the distance asked for. Relative
 * rather than absolute because this runs at anything from metres to tens of km.
 */
const MIN_FOCUS_FRACTION = 0.05;

/**
 * A camera pose written in the terms a view is framed in, all of them optional and
 * resolved against wherever the camera is now.
 *
 * ⭐ `box` is the useful one: give it what must be visible and the distance follows
 * from the camera's own fov, which is the number nobody can pick by hand.
 *
 * @group Managers
 */
export type CameraDestination = {
  /** fit this axis-aligned box; supplies both `target` and `distance` */
  box?: { min: Vec3; max: Vec3 };
  /** what the camera points at. Defaults to the box centre, or the current pivot. */
  target?: Vec3;
  /** degrees from +X toward +Z */
  azimuth?: number;
  /** degrees from straight down (0) through the horizon (90) */
  polar?: number;
  /** metres from the target. Ignored when `box` is given. */
  distance?: number;
  /** slack around a framed `box`. Default 1.1. */
  padding?: number;
};

/**
 * A move that goes AROUND rather than straight there.
 *
 * ⭐⭐ Why the destination may be a function: the whole point of retreating is to
 * do the expensive, disruptive part of a transition while the camera is far away
 * and moving. Whatever is being flown to therefore does not exist yet when the
 * flight starts — so the caller is asked for it once the retreat is done, and may
 * take as long as it needs.
 *
 * @group Managers
 */
export type CameraFlyPlan = {
  /** where to end up, or what to ask once the camera has pulled back */
  destination:
    | CameraDestination
    | (() => CameraDestination | null | Promise<CameraDestination | null>);
  /**
   * Pull back before travelling, and swing across at that distance. Omit for a
   * direct move.
   *
   * ⚠️ The straight line between two close-up views passes THROUGH whatever is
   * being looked at. Retreating is what keeps the camera outside it.
   */
  retreat?: {
    /** absolute metres from the target */
    distance?: number;
    /** multiple of the current distance. The larger of the two wins. */
    factor?: number;
    /**
     * Never pull back further than it takes to frame this box.
     *
     * ⭐⭐ What stops a retreat compounding. A factor alone multiplies wherever the
     * camera HAPPENS to be, so flying from an already-distant view zooms further
     * out, and every subsequent flight zooms out again — the whole field recedes a
     * little more with each click. Bounding it by "far enough to see all of this"
     * makes the staging distance a property of the SCENE, so it converges.
     */
    box?: { min: Vec3; max: Vec3 };
    /** absolute ceiling in metres, alongside `box` */
    max?: number;
    /** degrees to rise to while out there. Defaults to holding the current one. */
    polar?: number;
  };
  /**
   * Seconds for the whole flight, split across its legs. Default
   * {@link DEFAULT_FLY_DURATION}.
   *
   * ⚠️⚠️ A BUDGET, not a hint. `smoothTime` is an easing time CONSTANT, so waiting
   * for the controls to come to rest takes an open-ended multiple of it — three
   * legs of a quarter-second constant is several seconds of real time, which reads
   * as the camera wandering. Each leg therefore also gets a hard cap and hands over
   * on time whether or not it has landed; the next leg simply eases on from
   * wherever it got to.
   */
  duration?: number;
  /**
   * How far the user's own input may move the camera before the flight gives way,
   * as a share of the viewing distance. Default {@link DEFAULT_FLY_INTERRUPT};
   * `false` to fly regardless.
   *
   * ⭐ A share rather than metres because this runs at anything from metres to tens
   * of km, and a nudge is a nudge at either scale.
   */
  interrupt?: number | false;
};

/** Default {@link CameraFlyPlan.duration}, in seconds. @group Managers */
export const DEFAULT_FLY_DURATION = 1.6;

/** Default {@link CameraFlyPlan.interrupt}. @group Managers */
export const DEFAULT_FLY_INTERRUPT = 0.02;

/** Share of the whole budget each leg gets: pull back, swing across, come in. */
const FLY_LEGS = { retreat: 0.3, swing: 0.4, approach: 0.3 };

/**
 * Easing constant as a share of a leg's budget.
 *
 * ⭐ A third, so a leg is ~95% of the way there when its time runs out — close
 * enough that the hand-over to the next leg is invisible.
 */
const FLY_SMOOTHING = 1 / 3;

/** Ignore a retreat that would not meaningfully move the camera. */
const RETREAT_EPSILON = 0.02;

function delay(seconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * Take the shortest way round to the camera's new heading.
 *
 * ⭐ It has to run AFTER whatever set the destination. `normalizeRotations` wraps
 * the DESTINATION angle into (-π, π] and then shifts the CURRENT one by whole
 * turns to land within π of it — so calling it first normalizes the angle that is
 * about to be overwritten, and achieves nothing. Meanwhile the current azimuth
 * accumulates as the user orbits (two turns of dragging is ~12.6 rad), so without
 * this the camera unwinds those turns on its way to the target.
 *
 * Shifting the current angle by whole turns is visually identical, so it is safe
 * to do while a transition is already running.
 */
function normalizeRotations(controls: CameraControls) {
  controls.normalizeRotations();
}

async function focusAtPoint(
  point: Vec3,
  distance: number,
  controls: CameraControls,
) {
  cameraTarget.set(...point);
  controls.getPosition(cameraPosition);
  direction.subVectors(cameraTarget, cameraPosition);
  // Never pull back farther than we already are, than was asked for, or than the
  // distance to the point itself — flying to something nearby should not zoom out.
  const pullBack = Math.min(
    controls.distance,
    distance,
    direction.length() * 1.5,
  );
  // ⚠️ ... but clicking what the camera is already looking at makes that distance
  // zero, which would put it inside the geometry.
  const useDistance = Math.max(
    pullBack,
    controls.minDistance,
    distance * MIN_FOCUS_FRACTION,
  );
  direction.normalize();
  cameraPosition.copy(cameraTarget).addScaledVector(direction, -useDistance);

  const transition = controls.setLookAt(
    cameraPosition.x,
    cameraPosition.y,
    cameraPosition.z,
    cameraTarget.x,
    cameraTarget.y,
    cameraTarget.z,
    true,
  );
  normalizeRotations(controls);
  return transition;
}

function setPosition(point: Vec3, controls: CameraControls) {
  v1.set(...point);

  controls.getTarget(cameraTarget);

  v2.subVectors(cameraTarget, v1);

  controls.getPosition(cameraPosition);
  cameraPosition.sub(v2);
  controls.setPosition(cameraPosition.x, cameraPosition.y, cameraPosition.z);
  controls.setTarget(v1.x, v1.y, v1.z);
  normalizeRotations(controls);
}

export class CameraManager {
  controls: CameraControls | null = null;
  removeEventlisteners: (() => void) | null = null;
  /**
   * Bumped by anything that supersedes a move in flight.
   *
   * ⭐ A multi-leg flight is a sequence of awaits, and `camera-controls` resolves
   * an interrupted transition rather than rejecting it — so without a token the
   * abandoned flight would wake up between legs and fight the new one for the
   * camera.
   */
  private flight = 0;
  /** How much of the user's input a flight in progress will tolerate. */
  private interrupt: number | false = DEFAULT_FLY_INTERRUPT;
  /** Whether a multi-leg flight is currently issuing legs. */
  private flying = false;
  /** The last pose a move ASKED for, which the user's own input then departs from. */
  private commandedPosition = new Vector3();
  private commandedTarget = new Vector3();
  private stopWatchingInput: (() => void) | null = null;

  constructor() {
    this.setControls = this.setControls.bind(this);
  }

  /**
   * Give way when the user takes hold of the camera.
   *
   * ⭐⭐ Compares the transition's END pose rather than where the camera IS. During
   * a flight the camera is travelling fast under its own power, so any measurement
   * of actual movement is dominated by the flight itself — a single wheel tick
   * would read as a huge gesture. The end pose only changes when something SETS it,
   * and between legs that something is the user.
   */
  private watchInput(controls: CameraControls) {
    const onControl = () => {
      if (this.interrupt === false || !this.flying) return;
      controls.getPosition(v1);
      controls.getTarget(v2);
      const slack = this.interrupt * Math.max(controls.distance, 1);
      if (
        v1.distanceTo(this.commandedPosition) > slack ||
        v2.distanceTo(this.commandedTarget) > slack
      ) {
        // ⚠️ Abandon WITHOUT `stop()`: the user is mid-gesture and stopping the
        // controls would discard the very input that interrupted us.
        this.flying = false;
        this.flight++;
      }
    };
    controls.addEventListener('control', onControl);
    this.stopWatchingInput = () =>
      controls.removeEventListener('control', onControl);
  }

  private addEventListeners() {
    const onSetPosition = (event: any) => {
      if (this.controls) {
        this.flight++;
        setPosition(event.detail as Vec3, this.controls);
      }
    };

    const onFocusPoint = (event: any) => {
      if (this.controls) {
        this.flight++;
        const callback = event.detail.callback;
        focusAtPoint(
          event.detail.point as Vec3,
          event.detail.distance || 200,
          this.controls,
        ).then(() => {
          if (callback) callback();
        });
      }
    };

    const onLookAt = (event: any) => {
      const detail = event.detail;
      this.flight++;
      this.lookAt(detail).then(() => {
        if (detail.callback) detail.callback();
      });
    };

    const onFlyTo = (event: any) => {
      const detail = event.detail;
      this.flyTo(detail).then(() => {
        if (detail.callback) detail.callback();
      });
    };

    addEventListener(cameraSetPositionEventType, onSetPosition);
    addEventListener(cameraFocusAtPointEventType, onFocusPoint);
    addEventListener(cameraLookAtEventType, onLookAt);
    addEventListener(cameraFlyToEventType, onFlyTo);

    this.removeEventlisteners = () => {
      removeEventListener(cameraSetPositionEventType, onSetPosition);
      removeEventListener(cameraFocusAtPointEventType, onFocusPoint);
      removeEventListener(cameraLookAtEventType, onLookAt);
      removeEventListener(cameraFlyToEventType, onFlyTo);
    };
  }

  /**
   * Put the camera at `position` looking at `target`.
   *
   * @returns a promise that resolves when the move is done — immediately when
   *   `transition` is false
   */
  async lookAt(options: {
    position: Vec3;
    target: Vec3;
    transition?: boolean;
    /** seconds of easing for this move only; the controls' own value is restored */
    smoothTime?: number;
    /** seconds to wait for it to land before returning anyway */
    settle?: number;
  }): Promise<void> {
    const controls = this.controls;
    if (!controls) return;
    const [px, py, pz] = options.position;
    const [tx, ty, tz] = options.target;
    const restore = controls.smoothTime;
    if (options.smoothTime !== undefined)
      controls.smoothTime = options.smoothTime;
    const transition = controls.setLookAt(
      px,
      py,
      pz,
      tx,
      ty,
      tz,
      options.transition !== false,
    );
    normalizeRotations(controls);
    // What the flight asked for, so user input can be told apart from its own
    // motion: the controls report the transition's END, which only the two of them
    // ever write.
    controls.getPosition(this.commandedPosition);
    controls.getTarget(this.commandedTarget);
    try {
      await (options.settle !== undefined
        ? Promise.race([transition, delay(options.settle)])
        : transition);
    } finally {
      controls.smoothTime = restore;
    }
  }

  /**
   * Place the camera in SPHERICAL terms around a target.
   *
   * ⭐ Degrees and metres, because that is the form a pose can be written down in
   * and reproduced — a position vector cannot be reasoned about at a glance, which
   * is what makes framing a view by hand a matter of trial and error.
   *
   * `azimuth` is measured from +X toward +Z, `polar` from straight down (0) to the
   * horizon (90) and on to straight up (180). Each term left out holds what the
   * camera has now, so a pure dolly is `orbit({ distance })`.
   */
  async orbit(options: {
    azimuth?: number;
    polar?: number;
    distance?: number;
    target?: Vec3;
    transition?: boolean;
    smoothTime?: number;
    settle?: number;
  }): Promise<void> {
    const controls = this.controls;
    if (!controls) return;
    const current = this.pose();
    if (options.target) cameraTarget.set(...options.target);
    else controls.getTarget(cameraTarget);

    const azimuth =
      ((options.azimuth ?? current?.azimuth ?? 0) * Math.PI) / 180;
    const polar = ((options.polar ?? current?.polar ?? 60) * Math.PI) / 180;
    const range = options.distance ?? current?.distance ?? controls.distance;
    const sinPolar = Math.sin(polar);
    const position: Vec3 = [
      cameraTarget.x + range * sinPolar * Math.cos(azimuth),
      cameraTarget.y + range * Math.cos(polar),
      cameraTarget.z + range * sinPolar * Math.sin(azimuth),
    ];
    return this.lookAt({
      position,
      target: [cameraTarget.x, cameraTarget.y, cameraTarget.z],
      transition: options.transition,
      smoothTime: options.smoothTime,
      settle: options.settle,
    });
  }

  /**
   * Fit an axis-aligned box to the view.
   *
   * The distance is derived from the box's bounding sphere against the camera's
   * own vertical fov and aspect, so the whole box is inside the frustum whichever
   * way it is being looked at.
   */
  async frame(
    box: { min: Vec3; max: Vec3 },
    options: {
      azimuth?: number;
      polar?: number;
      padding?: number;
      transition?: boolean;
      smoothTime?: number;
      settle?: number;
    } = {},
  ): Promise<void> {
    const controls = this.controls;
    if (!controls) return;
    const distance = this.frameDistance(box, options.padding);
    if (distance === null) return;
    const target: Vec3 = [
      (box.min[0] + box.max[0]) * 0.5,
      (box.min[1] + box.max[1]) * 0.5,
      (box.min[2] + box.max[2]) * 0.5,
    ];
    const current = this.pose();
    return this.orbit({
      azimuth: options.azimuth ?? current?.azimuth ?? 225,
      polar: options.polar ?? current?.polar ?? 60,
      distance,
      target,
      transition: options.transition,
      smoothTime: options.smoothTime,
      settle: options.settle,
    });
  }

  /**
   * How far back a box has to be seen from to fit the frustum.
   *
   * ⭐ From the box's bounding SPHERE, so the answer holds whichever way the box is
   * being looked at — which is what makes it usable before the heading is known.
   *
   * @returns metres, or null without controls to read a fov from
   */
  frameDistance(box: { min: Vec3; max: Vec3 }, padding = 1.1): number | null {
    const controls = this.controls;
    if (!controls) return null;
    const radius =
      0.5 *
      Math.hypot(
        box.max[0] - box.min[0],
        box.max[1] - box.min[1],
        box.max[2] - box.min[2],
      );
    const camera = controls.camera as PerspectiveCamera;
    const fov = ((camera.fov ?? 60) * Math.PI) / 180;
    // The horizontal half-angle is the binding one on a narrow window.
    const halfAngle = Math.min(
      fov * 0.5,
      Math.atan(Math.tan(fov * 0.5) * (camera.aspect ?? 1)),
    );
    return (radius / Math.sin(halfAngle)) * padding;
  }

  /**
   * Travel to a new view the long way: pull back, swing across at that distance,
   * then come in.
   *
   * ⭐⭐ Why not go straight there. The shortest path between two close-up views
   * runs THROUGH what is being looked at — inside the block, inside the well — and
   * whatever is being rebuilt on the way is rebuilt right in front of the lens.
   * Retreating first puts the change at arm's length and gives it the length of the
   * pull-back to happen in.
   *
   * A second call supersedes the first: the abandoned flight stops at its next leg
   * rather than fighting for the camera.
   *
   * @returns a promise that resolves when the approach lands, or when the flight
   *   was superseded or the destination came back null
   */
  async flyTo(plan: CameraFlyPlan): Promise<void> {
    const controls = this.controls;
    if (!controls) return;
    const id = ++this.flight;
    const start = this.pose();
    if (!start) return;

    const total = plan.duration ?? DEFAULT_FLY_DURATION;
    this.interrupt = plan.interrupt ?? DEFAULT_FLY_INTERRUPT;
    this.flying = true;
    const restore = controls.smoothTime;
    // Each leg's easing is set here rather than passed down, so the constant is not
    // restored to the controls' own value in the middle of a flight.
    const leg = async (
      seconds: number,
      options: Parameters<CameraManager['orbit']>[0],
    ) => {
      controls.smoothTime = Math.max(seconds * FLY_SMOOTHING, 1e-3);
      await this.orbit({ ...options, settle: seconds });
    };

    try {
      let staging = start.distance;
      if (plan.retreat) {
        const ceiling = Math.min(
          plan.retreat.max ?? Infinity,
          (plan.retreat.box ? this.frameDistance(plan.retreat.box, 1) : null) ??
            Infinity,
          controls.maxDistance,
        );
        const wanted = Math.max(
          plan.retreat.distance ?? 0,
          start.distance * (plan.retreat.factor ?? 1),
          controls.minDistance,
        );
        // ⭐ Never past the ceiling, and never CLOSER than we already are — pulling
        // back from an already-distant view is not a retreat, it is a detour.
        staging = Math.max(start.distance, Math.min(wanted, ceiling));
        if (staging > start.distance * (1 + RETREAT_EPSILON)) {
          await leg(total * FLY_LEGS.retreat, {
            distance: staging,
            polar: plan.retreat.polar,
          });
          if (id !== this.flight) return;
        }
      }

      const destination =
        typeof plan.destination === 'function'
          ? await plan.destination()
          : plan.destination;
      if (id !== this.flight || !destination) return;

      const box = destination.box;
      const target: Vec3 | undefined = destination.target
        ? destination.target
        : box
          ? [
              (box.min[0] + box.max[0]) * 0.5,
              (box.min[1] + box.max[1]) * 0.5,
              (box.min[2] + box.max[2]) * 0.5,
            ]
          : undefined;
      const arrival =
        (box ? this.frameDistance(box, destination.padding) : null) ??
        destination.distance ??
        start.distance;

      // Travelling happens at whichever is further out, so a destination that wants
      // to be seen from further away than the retreat still never passes through
      // what is between the two.
      const across = Math.max(staging, arrival);
      const heading = {
        target,
        azimuth: destination.azimuth,
        polar: destination.polar,
      };
      if (across > arrival * (1 + RETREAT_EPSILON)) {
        await leg(total * FLY_LEGS.swing, { ...heading, distance: across });
        if (id !== this.flight) return;
        await leg(total * FLY_LEGS.approach, {
          ...heading,
          distance: arrival,
        });
        return;
      }
      // Already at or inside the arrival distance: one move, not a swing and a
      // dolly that would land in the same place.
      await leg(total * (FLY_LEGS.swing + FLY_LEGS.approach), {
        ...heading,
        distance: arrival,
      });
    } finally {
      if (id === this.flight) this.flying = false;
      controls.smoothTime = restore;
    }
  }

  /** Abandon a flight in progress and leave the camera where it is. */
  cancel() {
    this.flying = false;
    this.flight++;
    this.controls?.stop();
  }

  /**
   * Where the camera is now, in the form {@link CameraManager.orbit} takes.
   *
   * ⭐ Degrees, so a view worth keeping can be read off and pasted straight back
   * into a story's `parameters` or into another `orbit` call.
   *
   * ⚠⚠ The LIVE pose, not the pose it is heading for. `camera-controls` hands out
   * the transition's end value by default, which would make this report a view the
   * camera has not reached — so a second fly-to, asked mid-flight how far out it
   * currently is, would answer with the first one's destination and stage itself
   * from a place it has never been.
   */
  pose(): {
    position: Vec3;
    target: Vec3;
    azimuth: number;
    polar: number;
    distance: number;
  } | null {
    const controls = this.controls;
    if (!controls) return null;
    controls.getPosition(cameraPosition, false);
    controls.getTarget(cameraTarget, false);
    direction.subVectors(cameraPosition, cameraTarget);
    const distance = direction.length();
    return {
      position: [cameraPosition.x, cameraPosition.y, cameraPosition.z],
      target: [cameraTarget.x, cameraTarget.y, cameraTarget.z],
      azimuth: (Math.atan2(direction.z, direction.x) * 180) / Math.PI,
      polar:
        distance > 0 ? (Math.acos(direction.y / distance) * 180) / Math.PI : 0,
      distance,
    };
  }

  /** Resolves once the controls have come to rest. */
  settled(): Promise<void> {
    const controls = this.controls;
    if (!controls) return Promise.resolve();
    return new Promise(resolve => {
      const check = () => {
        if (!controls.active) {
          resolve();
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
  }

  async setTarget(target: Vec3) {
    const controls = this.controls;
    if (controls) {
      cameraTarget.set(...target);
      controls.getPosition(cameraPosition);
      direction.subVectors(cameraTarget, cameraPosition);
      direction.normalize();
      const transition = controls.setLookAt(
        cameraPosition.x,
        cameraPosition.y,
        cameraPosition.z,
        cameraTarget.x,
        cameraTarget.y,
        cameraTarget.z,
        true,
      );
      normalizeRotations(controls);
      return transition;
    }
    return null;
  }

  setControls(controls: CameraControls) {
    this.controls = controls;
    if (this.removeEventlisteners) {
      this.removeEventlisteners();
    }
    this.stopWatchingInput?.();
    this.addEventListeners();
    this.watchInput(controls);
  }

  dispose() {
    this.controls = null;
    this.flying = false;
    this.stopWatchingInput?.();
    this.stopWatchingInput = null;
    if (this.removeEventlisteners) {
      this.removeEventlisteners();
    }
  }
}
