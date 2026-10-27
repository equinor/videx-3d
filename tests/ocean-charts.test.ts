import { Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import type { GeoFrame } from '../src/sdk/projection/geo-frame';
import { Globe } from '../src/sdk/projection/globe';
import {
  OCEAN_CHART_CALM,
  OCEAN_FIELD_CHART_REACH,
  OceanCharts,
} from '../src/sdk/projection/ocean-charts';

// The demo field's frame (UTM 31N), the stage's disc 16 km across about its origin.
const FRAME: GeoFrame = {
  projection: getProjectionDefFromUtmZone('31N'),
  origin: [434500, 6478000],
};

const earth = () => {
  const globe = new Globe();
  globe.setDisc([-8000, -8000, 8000, 8000]);
  globe.setFrame(FRAME);
  return { globe, charts: new OceanCharts(globe) };
};

const sea = (globe: Globe, lat: number, lon: number) =>
  globe.geodetic(lat, lon, 0, new Vector3());

// The chart `point` takes.
const main = (charts: OceanCharts, point: Vector3) =>
  charts.chartAt(point).chart;

// The shader's coordinates (ocean-charts.glsl, oceanChartCoords) of the point `delta` from
// the camera in uniform slot `slot`, each operation rounded to a 32-bit float.
function shaderCoords(charts: OceanCharts, slot: number, delta: Vector3) {
  const f = Math.fround;
  const u = charts.uniforms;
  const v = (w: Vector3) => [f(w.x), f(w.y), f(w.z)];
  const dot = (a: number[], b: number[]) =>
    f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
  const R = f(u.uOceanCharts.value.x);
  const o = v(u.uOceanChartOrigin.value);
  const X = v(u.uOceanChartX.value[slot]);
  const Z = v(u.uOceanChartZ.value[slot]);
  const c = v(u.uOceanChartCentre.value[slot]);
  const d = v(delta);
  const B = f(R + dot(o, c));
  const Dc = dot(d, c);
  const k = f(f(2 * R) / f(B * f(B + Dc)));
  const cam = u.uOceanChartCamera.value[slot];
  return new Vector2(
    f(f(cam.x) + f(k * f(f(B * dot(d, X)) - f(dot(o, X) * Dc)))),
    f(f(cam.y) + f(k * f(f(B * dot(d, Z)) - f(dot(o, Z) * Dc)))),
  );
}

describe('OceanCharts', () => {
  it('has 162 fixed charts, each with a right-handed frame', () => {
    const { charts } = earth();
    expect(charts.count).toBe(163);
    const centre = new Vector3();
    const x = new Vector3();
    const z = new Vector3();
    for (let i = 1; i < charts.count; i++) {
      charts.axes(i, centre, x, z);
      expect(centre.length()).toBeCloseTo(1, 12);
      expect(x.length()).toBeCloseTo(1, 12);
      expect(x.dot(centre)).toBeCloseTo(0, 12);
      expect(z.distanceTo(new Vector3().crossVectors(x, centre))).toBeLessThan(
        1e-12,
      );
    }
  });

  it('is the wave plane over the field', () => {
    const { globe, charts } = earth();
    const at = new Vector2();
    for (const [x, z] of [
      [0, 0],
      [5000, -3000],
      [-7000, 4000],
    ]) {
      const point = globe.place(x, z, 0, new Vector3());
      charts.coords(0, point, at);
      expect(at.x).toBeCloseTo(x, 1);
      expect(at.y).toBeCloseTo(z, 1);
      expect(charts.chartAt(point)).toEqual({ chart: 0, keep: 1 });
    }
  });

  it('keeps the waves square and their size, within 1%, anywhere', () => {
    const { globe, charts } = earth();
    const a = new Vector2();
    const b = new Vector2();
    const c = new Vector2();
    let worst = 0;
    for (let lat = -85; lat <= 85; lat += 17) {
      for (let lon = -180; lon < 180; lon += 23) {
        const point = sea(globe, lat, lon);
        const chart = main(charts, point);
        // 100 m north and east of it, on the sea.
        const north = sea(globe, lat + 100 / 111000, lon);
        const east = sea(
          globe,
          lat,
          lon + 100 / (111000 * Math.cos(lat * (Math.PI / 180))),
        );
        charts.coords(chart, point, a);
        charts.coords(chart, north, b).sub(a);
        charts.coords(chart, east, c).sub(a);
        const kn = b.length() / north.distanceTo(point);
        const ke = c.length() / east.distanceTo(point);
        worst = Math.max(worst, Math.abs(kn - 1), Math.abs(ke - 1));
        // Conformal: north and east stay square, and the same size.
        expect(Math.abs(b.dot(c)) / (b.length() * c.length())).toBeLessThan(
          1e-4,
        );
        expect(kn / ke).toBeCloseTo(1, 4);
      }
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('keeps the wind’s compass bearing in every chart', () => {
    const { globe, charts } = earth();
    // The wave plane's X (world +X) against true north at the field.
    const fieldNorth = globe.north;
    const fieldEast = new Vector3().crossVectors(fieldNorth, globe.up);
    const bearing = Math.atan2(
      new Vector3(1, 0, 0).dot(fieldNorth),
      new Vector3(1, 0, 0).dot(fieldEast),
    );
    const centre = new Vector3();
    const x = new Vector3();
    const z = new Vector3();
    const geo = { latitude: 0, longitude: 0 };
    for (let i = 1; i < charts.count; i++) {
      charts.axes(i, centre, x, z);
      const point = globe.centre.clone().addScaledVector(centre, globe.radius);
      globe.geographic(point, geo);
      if (Math.abs(geo.latitude) > 80) continue;
      const here = sea(globe, geo.latitude, geo.longitude);
      const north = sea(globe, geo.latitude + 0.001, geo.longitude)
        .sub(here)
        .normalize();
      const east = new Vector3().crossVectors(north, centre).normalize();
      expect(Math.atan2(x.dot(north), x.dot(east))).toBeCloseTo(bearing, 4);
    }
  });

  it('switches charts only where the waves are calm', () => {
    const { globe, charts } = earth();
    // Across the field's reach, due east, and on into the fixed charts, 100 m a step.
    const step = 100 / (111000 * Math.cos(58.44 * (Math.PI / 180)));
    let last = charts.chartAt(sea(globe, 58.44, 1.88));
    let crossings = 0;
    // The most of the waves kept where the chart changes.
    let keptAtSwitch = 0;
    for (let i = 1; i <= 70000; i++) {
      const now = charts.chartAt(sea(globe, 58.44, 1.88 + i * step));
      // The strip's fade is 4 km a side: no more than a few percent a step.
      expect(Math.abs(now.keep - last.keep)).toBeLessThan(0.05);
      if (now.chart !== last.chart) {
        crossings++;
        keptAtSwitch = Math.max(keptAtSwitch, now.keep, last.keep);
      }
      last = now;
    }
    expect(crossings).toBeGreaterThan(3);
    expect(keptAtSwitch).toBeLessThan(0.01);
    expect(OCEAN_FIELD_CHART_REACH).toBeGreaterThan(OCEAN_CHART_CALM);
  });

  it('gives the shaders the same coordinates, from the camera, to a centimetre far off', () => {
    const { globe, charts } = earth();
    for (const [lat, lon] of [
      [58.5, 1.9],
      [-23.2, -43.1],
      [-58.44, -178.12],
      [-68.5, 0],
    ]) {
      const camera = globe.geodetic(lat, lon, 300, new Vector3());
      charts.setCamera(camera);
      const centre = new Vector3();
      const x = new Vector3();
      const z = new Vector3();
      for (const [dLat, dLon] of [
        [0.002, 0],
        [0.05, 0.03],
        [-0.15, 0.2],
      ]) {
        const point = sea(globe, lat + dLat, lon + dLon);
        const chart = main(charts, point);
        // The uniform slot holding that chart.
        let slot = -1;
        for (let s = 0; s < 4; s++) {
          charts.axes(chart, centre, x, z);
          if (charts.uniforms.uOceanChartCentre.value[s].equals(centre))
            slot = s;
        }
        expect(slot).toBeGreaterThanOrEqual(0);
        const exact = charts.coords(chart, point, new Vector2());
        const shader = shaderCoords(charts, slot, point.clone().sub(camera));
        // The camera's own coordinates are 32-bit: up to 1.2e6 m, 0.06 m apart there.
        expect(shader.distanceTo(exact)).toBeLessThan(0.15);
      }
    }
  });

  it('names one chart for every pixel only while no other meets it within the waves', () => {
    const { globe, charts } = earth();
    // Over the field, far from its reach: the field's chart.
    charts.setCamera(globe.geodetic(58.5, 1.9, 300, new Vector3()), 60000);
    expect(charts.uniforms.uOceanChartOnly.value).toBe(0);
    // On the line between two fixed charts: each pixel its own.
    const step = 100 / (111000 * Math.cos(23.2 * (Math.PI / 180)));
    let lon = -43.1;
    while (charts.chartAt(sea(globe, -23.2, lon)).keep > 0.001) lon += step;
    charts.setCamera(globe.geodetic(-23.2, lon, 300, new Vector3()), 60000);
    expect(charts.uniforms.uOceanChartOnly.value).toBe(-1);
    // Inside a fixed chart, far from its lines: that chart, in its slot.
    charts.setCamera(globe.geodetic(-23.2, -43.1, 300, new Vector3()), 60000);
    const only = charts.uniforms.uOceanChartOnly.value;
    expect(only).toBeGreaterThan(0);
    const centre = new Vector3();
    charts.axes(
      main(charts, sea(globe, -23.2, -43.1)),
      centre,
      new Vector3(),
      new Vector3(),
    );
    expect(charts.uniforms.uOceanChartCentre.value[only].equals(centre)).toBe(
      true,
    );
  });

  it('is only the plane with the globe off', () => {
    const { globe, charts } = earth();
    globe.enabled = false;
    charts.setCamera(new Vector3(0, 300, 0));
    expect(charts.uniforms.uOceanCharts.value.w).toBe(0);
    const point = new Vector3(1234, 0, -5678);
    expect(charts.coords(0, point, new Vector2()).toArray()).toEqual([
      1234, -5678,
    ]);
    expect(charts.chartAt(point)).toEqual({ chart: 0, keep: 1 });
  });
});
