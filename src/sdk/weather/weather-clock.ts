/**
 * Options for a {@link WeatherClock}.
 *
 * @group Weather
 */
export type WeatherClockOptions = {
  /** where it starts, in seconds (any origin: 0, or seconds since an epoch). Default 0 */
  time?: number;
  /** weather seconds a second: 3600 runs an hour a second. Default 1 */
  timeScale?: number;
  /** held where it is. Default false */
  paused?: boolean;
};

/**
 * The longest a single read lets the clock run, in wall seconds: past it, a stall (a hidden
 * tab, a breakpoint) counts as this long, so a timelapse does not leap hours when it resumes.
 */
export const WEATHER_CLOCK_STALL = 0.1;

/**
 * The weather's time, in seconds: what moves the clouds and the waves. It runs on its own from
 * wall time at {@link timeScale} (read {@link time} each frame), or is set by the host
 * ({@link setTime}); it may be {@link paused}. A set time is a jump ({@link jumps} counts them),
 * which what accumulates its own time from the clock's steps (the waves) does not follow.
 *
 * @group Weather
 */
export class WeatherClock {
  /** weather seconds a second */
  timeScale: number;
  /** held where it is */
  paused: boolean;
  /** counts the times it was set: a jump, not a step */
  jumps = 0;
  private current: number;
  private last: number;
  private readonly now: () => number;

  /**
   * @param now wall time in milliseconds (default `performance.now`)
   */
  constructor(options: WeatherClockOptions = {}, now?: () => number) {
    this.now = now ?? (() => performance.now());
    this.current = options.time ?? 0;
    this.timeScale = options.timeScale ?? 1;
    this.paused = options.paused ?? false;
    this.last = this.now();
  }

  /** the time now, in seconds: it runs on by the wall time since the last read */
  get time(): number {
    const now = this.now();
    const wall = Math.min(
      Math.max((now - this.last) / 1000, 0),
      WEATHER_CLOCK_STALL,
    );
    this.last = now;
    if (!this.paused) this.current += wall * this.timeScale;
    return this.current;
  }

  /** Set the time (seconds): a jump. */
  setTime(time: number) {
    this.last = this.now();
    this.current = time;
    this.jumps++;
  }
}

/**
 * Steps of a {@link WeatherClock} for what keeps its own time (the waves, whose shaders read it
 * in single precision): each read adds the seconds the clock has run since the last, but not
 * its jumps, so the speed and pauses follow the clock while the time stays small.
 *
 * @group Weather
 */
export class WeatherClockSteps {
  private time: number | null = null;
  private jumps = -1;
  private clock: WeatherClock | null = null;

  /**
   * The seconds `clock` has run since the last call: 0 the first time, after a jump, and for
   * another clock.
   */
  step(clock: WeatherClock): number {
    const time = clock.time;
    const step =
      this.time === null || clock !== this.clock || clock.jumps !== this.jumps
        ? 0
        : time - this.time;
    this.time = time;
    this.jumps = clock.jumps;
    this.clock = clock;
    return step;
  }
}
