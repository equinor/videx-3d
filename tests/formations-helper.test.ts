import {
  getFormationMarkers,
  getWellboreFormations,
  mergeFormationIntervals,
} from '../src/sdk/data/helpers/formations-helpers';
import { TestStore } from './mocks/test-store';

describe('formations-helper', () => {
  const store = new TestStore();

  test('mergeFormationIntervals', async () => {
    const intervals = await getWellboreFormations('x', 'x', store);
    expect(intervals).not.toBeNull();

    const merged = mergeFormationIntervals(intervals);
    expect(merged.length).toBe(9);
    expect(merged[0].name).toBe('A');
    expect(merged[0].mdMslFrom).toBe(100);
    expect(merged[0].mdMslTo).toBe(200);
    expect(merged[1].name).toBe('C');
    expect(merged[1].mdMslFrom).toBe(200);
    expect(merged[1].mdMslTo).toBe(300);
    expect(merged[2].name).toBe('A');
    expect(merged[2].mdMslFrom).toBe(300);
    expect(merged[2].mdMslTo).toBe(500);
    expect(merged[3].name).toBe('D');
    expect(merged[3].mdMslFrom).toBe(500);
    expect(merged[3].mdMslTo).toBe(600);
    expect(merged[4].name).toBe('G');
    expect(merged[4].mdMslFrom).toBe(600);
    expect(merged[4].mdMslTo).toBe(650);
    expect(merged[5].name).toBe('D');
    expect(merged[5].mdMslFrom).toBe(650);
    expect(merged[5].mdMslTo).toBe(700);
    expect(merged[6].name).toBe('H');
    expect(merged[6].mdMslFrom).toBe(700);
    expect(merged[6].mdMslTo).toBe(800);
    expect(merged[7].name).toBe('F');
    expect(merged[7].mdMslFrom).toBe(800);
    expect(merged[7].mdMslTo).toBe(900);
    expect(merged[8].name).toBe('I');
    expect(merged[8].mdMslFrom).toBe(900);
    expect(merged[8].mdMslTo).toBe(1000);
  });

  test('getFormationMarkers', async () => {
    const intervals = await getWellboreFormations('x', 'x', store);
    expect(intervals).not.toBeNull();
    const markers = getFormationMarkers(intervals);

    expect(markers.length).toBe(10);

    expect(markers[0].name).toBe('A');
    expect(markers[0].type).toBe('top');

    expect(markers[1].name).toBe('C');
    expect(markers[1].type).toBe('top');

    expect(markers[2].name).toBe('C');
    expect(markers[2].type).toBe('base');

    expect(markers[3].name).toBe('D');
    expect(markers[3].type).toBe('top');

    expect(markers[4].name).toBe('G');
    expect(markers[4].type).toBe('top');

    expect(markers[5].name).toBe('G');
    expect(markers[5].type).toBe('base');

    expect(markers[6].name).toBe('H');
    expect(markers[6].type).toBe('top');

    expect(markers[7].name).toBe('F');
    expect(markers[7].type).toBe('top');

    expect(markers[8].name).toBe('I');
    expect(markers[8].type).toBe('top');

    expect(markers[9].name).toBe('I');
    expect(markers[9].type).toBe('base');
  });
});
