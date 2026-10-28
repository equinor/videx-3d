import { describe, expect, it } from 'vitest';
import {
  altitudeControlTravel,
  resolveMinimapAltitudeControl,
  resolveMinimapLayout,
} from '../src/components/Html/Minimap/minimap-layout';

const ALL = [
  'compass',
  'altitude',
  'altitudeControl',
  'controls',
  'extent',
  'distance',
] as const;

describe('resolveMinimapLayout', () => {
  it('puts each item at its default anchor: the readout top centre, the altitude control on the left edge', () => {
    const groups = resolveMinimapLayout(ALL);
    expect(groups.get('top-left')?.map(g => g.item)).toEqual(['compass']);
    expect(groups.get('top-center')?.map(g => g.item)).toEqual(['altitude']);
    expect(groups.get('left-center')?.map(g => g.item)).toEqual([
      'altitudeControl',
    ]);
    expect(groups.get('top-right')?.map(g => g.item)).toEqual(['controls']);
    expect(groups.get('bottom-left')?.map(g => g.item)).toEqual(['extent']);
    expect(groups.get('bottom-right')?.map(g => g.item)).toEqual(['distance']);
  });

  it('leaves out what is not shown', () => {
    const groups = resolveMinimapLayout(['extent', 'controls']);
    expect(groups.has('top-left')).toBe(false);
    expect(groups.has('left-center')).toBe(false);
    expect([...groups.keys()].sort()).toEqual(['bottom-left', 'top-right']);
  });

  it('moves the altitude control to the right edge', () => {
    const groups = resolveMinimapLayout(ALL, {
      altitudeControl: { anchor: 'right-center' },
    });
    expect(groups.has('left-center')).toBe(false);
    expect(groups.get('right-center')?.map(g => g.item)).toEqual([
      'altitudeControl',
    ]);
  });

  it('moves an item to another anchor and flows it as asked', () => {
    const groups = resolveMinimapLayout(ALL, {
      controls: { anchor: 'bottom-right', direction: 'row' },
    });
    expect(groups.has('top-right')).toBe(false);
    expect(groups.get('bottom-right')).toEqual([
      { item: 'controls', direction: 'row' },
      { item: 'distance', direction: 'column' },
    ]);
  });

  it('stacks the items of one anchor by their order, nearest the edge first', () => {
    const groups = resolveMinimapLayout(ALL, {
      altitude: { anchor: 'top-left', order: -1 },
    });
    expect(groups.get('top-left')?.map(g => g.item)).toEqual([
      'altitude',
      'compass',
    ]);
    expect(groups.has('top-center')).toBe(false);
  });

  it('keeps the given order for equal orders', () => {
    const groups = resolveMinimapLayout(['extent', 'compass'], {
      extent: { anchor: 'top-left', order: 0 },
    });
    expect(groups.get('top-left')?.map(g => g.item)).toEqual([
      'extent',
      'compass',
    ]);
  });
});

describe('resolveMinimapAltitudeControl', () => {
  it('has defaults: the sea’s 5 km below to 50 km above, 100 m/s, doubling every second up to 200 times', () => {
    expect(resolveMinimapAltitudeControl()).toEqual({
      min: -5000,
      max: 50000,
      maxSpeed: 100,
      boost: 200,
      boostTime: 1,
      dragRange: 100,
      color: '#ffffff',
    });
  });

  it('takes what it is given, and keeps the range, the boost and the travel usable', () => {
    const t = resolveMinimapAltitudeControl({
      min: 0,
      max: -10,
      dragRange: 2,
      boost: 0.2,
      boostTime: 0,
      maxSpeed: 30,
    });
    expect(t.max).toBeGreaterThan(t.min);
    expect(t.dragRange).toBeGreaterThanOrEqual(10);
    expect(t.boost).toBe(1);
    expect(t.boostTime).toBeGreaterThan(0);
    expect(t.maxSpeed).toBe(30);
  });
});

describe('altitudeControlTravel', () => {
  it('is the drag range on a map tall enough for it', () => {
    expect(altitudeControlTravel(100, 300)).toBe(100);
    expect(altitudeControlTravel(60, 600)).toBe(60);
  });

  it('is shortened to fit a short map, but never to nothing', () => {
    expect(altitudeControlTravel(100, 220)).toBe(75);
    expect(altitudeControlTravel(100, 100)).toBe(15);
    expect(altitudeControlTravel(100, 20)).toBe(12);
  });
});
