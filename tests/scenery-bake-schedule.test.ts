import { describe, expect, it } from 'vitest';
import {
  SceneryBakeSchedule,
  SceneryBakeState,
} from '../src/components/Scenery/scenery-bake-schedule';
import type { SceneryZone } from '../src/components/Scenery/scenery-model';

const ZONES: SceneryZone[] = ['air', 'water', 'subsurface'];
const READY = { sky: true, subsurface: true };
const INTERVAL = 250;
const MAX_WAIT = 1000;

// A sky whose zones are all due; `bake` takes what the schedule returns.
function sky(zones: readonly SceneryZone[] = ZONES) {
  const states = new Map<SceneryZone, SceneryBakeState>(
    zones.map(z => [z, 'due']),
  );
  const schedule = new SceneryBakeSchedule();
  const bake = (
    now: number,
    ready = READY,
    inView: SceneryZone = 'air',
    within: readonly SceneryZone[] = zones,
  ) => {
    const zone = schedule.next(
      now,
      within,
      inView,
      z => states.get(z) ?? 'none',
      ready,
      INTERVAL,
      MAX_WAIT,
    );
    if (zone) states.set(zone, 'none');
    return zone;
  };
  const change = (now: number) => {
    schedule.change(now);
    for (const z of zones) states.set(z, 'due');
  };
  return { states, bake, change };
}

describe('SceneryBakeSchedule', () => {
  it('bakes the subsurface first, then the zone in view, then the rest', () => {
    const { bake } = sky();
    expect([bake(0, READY, 'water'), bake(1, READY, 'water'), bake(2)]).toEqual(
      ['subsurface', 'water', 'air'],
    );
    expect(bake(3)).toBeNull();
  });

  it('bakes the subsurface before the sky has compiled, and nothing before its own', () => {
    const { bake } = sky();
    expect(bake(0, { sky: true, subsurface: false })).toBeNull();
    expect(bake(1, { sky: false, subsurface: true })).toBe('subsurface');
    expect(bake(2, { sky: false, subsurface: true })).toBeNull();
    expect(bake(3)).toBe('air');
  });

  it('waits for the sky to be still before baking a change', () => {
    const { bake, change } = sky(['air', 'subsurface']);
    bake(0);
    bake(1);
    change(1000);
    expect(bake(1000 + INTERVAL - 10)).toBeNull();
    expect(bake(1000 + INTERVAL)).toBe('subsurface');
    expect(bake(1000 + INTERVAL + 1)).toBe('air');
  });

  it('bakes a sky that keeps changing every maxWait', () => {
    const { bake, change } = sky(['air', 'subsurface']);
    bake(0);
    bake(1);
    const baked: number[] = [];
    for (let t = 100; t <= 2500; t += 50) {
      change(t);
      if (bake(t)) baked.push(t);
    }
    // A round bakes its zones on consecutive calls; the next waits maxWait from the first
    // change after it began.
    expect(baked).toEqual([1100, 1150, 2150, 2200]);
  });

  it('keeps a zone whose readback is busy in its round', () => {
    const { states, bake, change } = sky(['air', 'subsurface']);
    bake(0);
    bake(1);
    change(1000);
    states.set('subsurface', 'none');
    states.set('air', 'blocked');
    expect(bake(1300)).toBeNull();
    states.set('air', 'due');
    expect(bake(1310)).toBe('air');
  });

  it('does not stall on a zone that is no longer there', () => {
    const { states, bake, change } = sky();
    bake(0);
    bake(1);
    bake(2);
    change(1000);
    expect(bake(1300)).toBe('subsurface');
    // The water goes before its turn; the round ends without it.
    states.set('air', 'none');
    expect(bake(1301, READY, 'air', ['air', 'subsurface'])).toBeNull();
    change(2000);
    expect(bake(2300, READY, 'air', ['air', 'subsurface'])).toBe('subsurface');
  });
});
