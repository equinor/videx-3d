/**
 * How an altitude control works: a slim vertical control whose knob is pulled up or down and
 * springs back to the middle when let go. The knob sets the climb speed directly, in metres a
 * second, the same at any height: nothing within a small dead zone, then growing with the
 * square of how far it is from the middle, to `maxSpeed` at the end of its travel. Held at the
 * end it then accelerates.
 *
 * @group Components
 */
export type AltitudeControlOptions = {
  /** the lowest height it moves to, in metres from the sea (negative below it). Default -5000 */
  min?: number;
  /** the highest. Default 50000 */
  max?: number;
  /** metres a second with the knob at the end of its travel, before it accelerates. Default 100 */
  maxSpeed?: number;
  /**
   * how many times `maxSpeed` it can accelerate to, held at the end of the travel: it doubles
   * every `boostTime` seconds up to this. Pulling the knob back from the end goes back to the
   * direct speed at once. `1` for no acceleration. Default 200
   */
  boost?: number;
  /** seconds the speed takes to double, held at the end of the travel. Default 1 */
  boostTime?: number;
  /** pixels the knob travels each way from the middle, at most: a view shorter than six times it shortens it to a sixth of its height. Default 100 */
  dragRange?: number;
  /** the control's colour. Default white */
  color?: string;
};

/** {@link AltitudeControlOptions} with the defaults in. */
export type ResolvedAltitudeControl = Required<AltitudeControlOptions>;

/** An altitude control's options over their defaults. */
export function resolveAltitudeControl(
  options: AltitudeControlOptions = {},
): ResolvedAltitudeControl {
  const min = options.min ?? -5000;
  return {
    min,
    max: Math.max(options.max ?? 50000, min + 1),
    maxSpeed: Math.max(options.maxSpeed ?? 100, 0),
    boost: Math.max(options.boost ?? 200, 1),
    boostTime: Math.max(options.boostTime ?? 1, 0.05),
    dragRange: Math.max(options.dragRange ?? 100, 10),
    color: options.color ?? '#ffffff',
  };
}

// The share of the view's height an altitude control's knob may travel each way: the whole
// `dragRange` (100 by default) in a view 600 pixels tall, and in proportion in a shorter one.
const ALTITUDE_CONTROL_SHARE = 1 / 6;

/**
 * How far an altitude control's knob can travel each way in a view `viewHeight` pixels tall:
 * its `dragRange` at most, and a sixth of the view's height in a view too short for that, so
 * the control keeps its proportion to it; never less than 12 pixels.
 *
 * @group Components
 */
export function altitudeControlTravel(
  dragRange: number,
  viewHeight: number,
): number {
  return Math.max(Math.min(dragRange, viewHeight * ALTITUDE_CONTROL_SHARE), 12);
}
