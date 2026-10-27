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
 * bakes nothing on the way and a sky that keeps changing is still lit anew. One zone a
 * call. Internal to `Scenery`.
 */
export class SceneryBakeSchedule {
  private changedAt = -Infinity;
  private staleSince: number | null = null;
  private round: Set<SceneryZone> | null = null;
  private readonly baked = new Set<SceneryZone>();

  /** The sky changed at `now` (milliseconds). */
  change(now: number) {
    this.changedAt = now;
    this.staleSince ??= now;
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
    if (fresh) return take(fresh);

    const settled =
      now - this.changedAt >= interval ||
      (this.staleSince !== null && now - this.staleSince >= maxWait);
    if (!this.round && this.staleSince !== null && settled) {
      this.round = new Set(zones.filter(zone => state(zone) !== 'none'));
      this.staleSince = null;
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
