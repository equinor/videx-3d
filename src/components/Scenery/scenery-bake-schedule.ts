import type { SceneryZone } from './scenery-model';

/** Where a zone's bakes stand: nothing due, due but waiting on a readback, or due. */
export type SceneryBakeState = 'none' | 'blocked' | 'due';

/** Whose programs are compiled: the sky's own, and the subsurface's. */
export type SceneryBakeReady = { sky: boolean; subsurface: boolean };

/**
 * When the {@link Scenery} bakes, and which zone. The subsurface comes first: its program is
 * small, so it is ready first, and it lights the scene until the others are baked. A zone
 * never baked goes as soon as it can; after that, a change is baked once the sky has been
 * still for `interval`, or `maxWait` after it started changing, so a slider being dragged
 * bakes nothing on the way and a sky that keeps changing is still lit anew. While it keeps
 * changing only the camera's zone is (the others wait for it to be still), and a zone the
 * camera enters is baked at once: in a timelapse the air's bakes alone, not the water's and the
 * subsurface's as well, each prefiltered (since 2026-11-18). One zone a call. Internal to
 * `Scenery`.
 */
export class SceneryBakeSchedule {
  private changedAt = -Infinity;
  private staleSince: number | null = null;
  private round: Set<SceneryZone> | null = null;
  private readonly baked = new Set<SceneryZone>();
  private inView: SceneryZone | null = null;

  /** The sky changed at `now` (milliseconds). */
  change(now: number) {
    this.changedAt = now;
    this.staleSince ??= now;
  }

  /** Whether the sky has changed within `interval` of `now`: it is still changing. */
  changing(now: number, interval: number) {
    return now - this.changedAt < interval;
  }

  /**
   * The zone to bake at `now`, of `zones`, with the camera's `inView`; `null` for none.
   * A returned zone is taken as baked.
   */
  next(
    now: number,
    zones: readonly SceneryZone[],
    inView: SceneryZone,
    state: (zone: SceneryZone) => SceneryBakeState,
    ready: SceneryBakeReady,
    interval: number,
    maxWait: number,
  ): SceneryZone | null {
    const order = (['subsurface', inView, ...zones] as SceneryZone[]).filter(
      (zone, i, all) => zones.includes(zone) && all.indexOf(zone) === i,
    );
    // The sky's bakes prefilter with what the subsurface's compiled.
    const can = (zone: SceneryZone) =>
      state(zone) === 'due' &&
      ready.subsurface &&
      (zone === 'subsurface' || ready.sky);
    const take = (zone: SceneryZone | undefined) => {
      if (!zone) return null;
      this.baked.add(zone);
      // Once a round: changes since are the next round's.
      this.round?.delete(zone);
      return zone;
    };

    const fresh = order.find(zone => !this.baked.has(zone) && can(zone));
    // A zone the camera has just entered, its light out of date: at once.
    const entered = this.inView !== null && inView !== this.inView;
    this.inView = inView;
    if (fresh) return take(fresh);
    if (entered && zones.includes(inView) && can(inView)) return take(inView);

    if (!this.round) {
      const still = now - this.changedAt >= interval;
      if (still && zones.some(zone => state(zone) !== 'none')) {
        this.round = new Set(zones.filter(zone => state(zone) !== 'none'));
        this.staleSince = null;
      } else if (this.staleSince !== null && now - this.staleSince >= maxWait) {
        // Still changing: the zone in view alone.
        this.round = new Set(
          zones.includes(inView) && state(inView) !== 'none' ? [inView] : [],
        );
        this.staleSince = null;
      }
    }
    const round = this.round;
    if (!round) return null;
    for (const zone of round) {
      if (!zones.includes(zone) || state(zone) === 'none') round.delete(zone);
    }
    if (round.size === 0) {
      this.round = null;
      return null;
    }
    return take(order.find(zone => round.has(zone) && can(zone)));
  }
}
