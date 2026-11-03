import { describe, expect, it } from 'vitest';
import {
  GRATICULE_DEFAULTS,
  graticuleLatLonLabels,
  graticuleStyles,
  graticuleZoneLabelsOf,
} from '../src/components/Layers/graticule-options';

describe('graticuleStyles', () => {
  it('draws latitude and longitude alone by default, in the defaults’ look', () => {
    const styles = graticuleStyles({});
    expect(styles.latLon).toEqual({
      ...GRATICULE_DEFAULTS.lines,
      interval: undefined,
      minSpacing: GRATICULE_DEFAULTS.minSpacing,
    });
    expect(styles.utm).toBeNull();
    expect(styles.timeZones).toBeNull();
  });

  it('takes each kind on, off or in its own look, the rest from the defaults', () => {
    const styles = graticuleStyles({
      latLon: false,
      utm: true,
      timeZones: { color: '#7fd6ff', thickness: 3 },
    });
    expect(styles.latLon).toBeNull();
    expect(styles.utm?.color).toBe(GRATICULE_DEFAULTS.lines.color);
    expect(styles.timeZones).toMatchObject({
      color: '#7fd6ff',
      thickness: 3,
      opacity: GRATICULE_DEFAULTS.lines.opacity,
    });
  });

  it('passes latitude and longitude’s interval and spacing on', () => {
    const styles = graticuleStyles({ latLon: { interval: 2, minSpacing: 80 } });
    expect(styles.latLon).toMatchObject({ interval: 2, minSpacing: 80 });
  });
});

describe('graticule labels', () => {
  it('are off unless asked for', () => {
    expect(graticuleLatLonLabels({})).toBeNull();
    expect(graticuleLatLonLabels({ labels: false })).toBeNull();
    expect(graticuleLatLonLabels({ labels: { utm: true } })).toBeNull();
    expect(graticuleZoneLabelsOf({ utm: true }, 'utm')).toBeNull();
  });

  it('name every kind drawn with `true`, and only those', () => {
    const options = { utm: true, labels: true };
    expect(graticuleLatLonLabels(options)).not.toBeNull();
    expect(graticuleZoneLabelsOf(options, 'utm')).not.toBeNull();
    expect(graticuleZoneLabelsOf(options, 'timeZones')).toBeNull();
  });

  it('are off for a kind not drawn, even when asked for', () => {
    expect(
      graticuleLatLonLabels({ latLon: false, labels: { latLon: true } }),
    ).toBeNull();
    expect(
      graticuleZoneLabelsOf({ labels: { timeZones: true } }, 'timeZones'),
    ).toBeNull();
  });

  it('take their lines’ colour unless given their own', () => {
    expect(
      graticuleLatLonLabels({ latLon: { color: '#ff0000' }, labels: true })
        ?.color,
    ).toBe('#ff0000');
    expect(
      graticuleZoneLabelsOf(
        {
          timeZones: true,
          labels: { timeZones: { color: '#00ff00', size: 0.3 } },
        },
        'timeZones',
      ),
    ).toEqual({ color: '#00ff00', size: 0.3 });
    expect(
      graticuleZoneLabelsOf({ utm: true, labels: { utm: true } }, 'utm')?.color,
    ).toBe(GRATICULE_DEFAULTS.lines.color);
  });

  it('keep each kind’s own options', () => {
    expect(
      graticuleLatLonLabels({
        labels: { latLon: { density: 0.5, sizing: 'smooth' } },
      }),
    ).toMatchObject({ density: 0.5, sizing: 'smooth' });
  });
});
