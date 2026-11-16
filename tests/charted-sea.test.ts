import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { chartedSeaHeights } from '../src/components/Ocean/ocean-sampler';
import { getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import type { GeoFrame } from '../src/sdk/projection/geo-frame';
import { Globe } from '../src/sdk/projection/globe';
import {
  OCEAN_FIELD_CHART_REACH,
  OceanCharts,
} from '../src/sdk/projection/ocean-charts';
import { SEA_QUALITY, SeaState } from '../src/sdk/weather/sea-state';

// The demo field's frame (UTM 31N), the stage's disc 16 km across about its origin.
const FRAME: GeoFrame = {
  projection: getProjectionDefFromUtmZone('31N'),
  origin: [434500, 6478000],
};
const DEPTH = 1000;

const sea = () => {
  const globe = new Globe();
  globe.setDisc([-8000, -8000, 8000, 8000]);
  globe.setFrame(FRAME);
  const charts = new OceanCharts(globe);
  // The wave plane's X and Z the world's: east and south at the field.
  charts.setPlane(new Vector3(1, 0, 0), new Vector3(0, 0, 1));
  const spec = SEA_QUALITY.medium;
  const state = new SeaState(
    { windSpeed: 12, windDirection: [1, 0.3] },
    { layers: spec.layers, detail: spec.detail },
  );
  const heightAt = (x: number, z: number, depth: number) =>
    state.heightAtDepth(x, z, depth, 1.3);
  const heights = chartedSeaHeights({
    globe,
    charts,
    heightAt,
    depthAt: () => DEPTH,
  });
  return { globe, charts, heightAt, heights };
};

describe('chartedSeaHeights', () => {
  it('gives over the disc the heights of the waves in its plane', () => {
    const { globe, heightAt, heights } = sea();
    let worst = 0;
    let where = '';
    // Past the disc the drawn sea's chart parts from the plane by metres (11 m 108 km out):
    // the world's heights are the drawn ones there, which the plane's were not.
    for (const [x, z] of [
      [0, 0],
      [3000, -2000],
      [-7000, 6500],
      [7900, 0],
    ]) {
      const point = globe.place(x, z, 0, new Vector3());
      const error = Math.abs(
        heights.heightAtWorld(point) - heightAt(x, z, DEPTH),
      );
      if (error > worst) {
        worst = error;
        where = `${x}, ${z}`;
      }
    }
    expect(worst, where).toBeLessThan(0.005);
  });

  it('reads the sea under a point whatever its height over it', () => {
    const { globe, heights } = sea();
    // Over the field, and 600 km and 3000 km off (a fixed chart).
    for (const [lat, lon] of [
      [58.45, 1.9],
      [53.2, -3.5],
      [33.5, -12.0],
    ]) {
      const on = globe.geodetic(lat, lon, 0, new Vector3());
      const over = globe.geodetic(lat, lon, 40, new Vector3());
      expect(heights.heightAtWorld(over)).toBeCloseTo(
        heights.heightAtWorld(on),
        6,
      );
      const still = heights.stillSeaAt(over, new Vector3());
      expect(globe.altitude(still)).toBeCloseTo(0, 3);
    }
  });

  it('is calm where the field’s chart meets the fixed ones', () => {
    const { globe, charts, heights } = sea();
    // Due south of the field, across the field chart's reach.
    const degrees = OCEAN_FIELD_CHART_REACH / 111200;
    let calmest = Infinity;
    let height = NaN;
    for (let d = degrees - 0.2; d < degrees + 0.2; d += 0.001) {
      const point = globe.geodetic(58.45 - d, 1.9, 0, new Vector3());
      const { keep } = charts.chartAt(point);
      if (keep < calmest) {
        calmest = keep;
        height = heights.heightAtWorld(point);
      }
    }
    expect(calmest).toBeLessThan(1e-3);
    expect(Math.abs(height)).toBeLessThan(0.01);
  });
});
