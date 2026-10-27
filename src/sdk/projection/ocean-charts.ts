import { Uniform, Vector2, Vector3, Vector4 } from 'three';
import type { Globe } from './globe';

/**
 * How far from the field its own chart reaches (see {@link OceanCharts}), in metres: past
 * it, the fixed charts.
 *
 * @group Utils
 */
export const OCEAN_FIELD_CHART_REACH = 1000000;

/**
 * How wide the calm strip is where two charts of {@link OceanCharts} meet, in metres: the
 * waves fade out over half of it on each side, and the charts switch on its middle, where
 * there are none to seam.
 *
 * @group Utils
 */
export const OCEAN_CHART_CALM = 8000;

// The icosahedron the fixed charts' centres lie on, each face split this many times along
// each side: 4 makes 162 centres, about 2000 km apart, so no point lies more than about
// 1150 km from one and its chart stretches the waves there by under 1%.
const FREQUENCY = 4;
// The fixed charts the shaders are given: the nearest the camera. Where the waves can be
// seen, within some tens of kilometres, no more than three meet.
const FIXED_IN_VIEW = 3;
const DEG = Math.PI / 180;

/**
 * The uniforms an {@link OceanCharts} keeps up to date, for `ocean-charts.glsl`.
 *
 * @group Utils
 */
export type OceanChartUniforms = {
  /** the sphere's radius, the field's chart's reach, the calm strip's width; w: 1 while on */
  uOceanCharts: Uniform<Vector4>;
  /** the camera, from the sphere's centre */
  uOceanChartOrigin: Uniform<Vector3>;
  /** per chart, 0 the field's and 1–3 the fixed ones nearest the camera: its centre, a unit direction from the sphere's centre */
  uOceanChartCentre: Uniform<Vector3[]>;
  /** per chart: the wave plane's X there, unit */
  uOceanChartX: Uniform<Vector3[]>;
  /** per chart: the wave plane's Z there, unit */
  uOceanChartZ: Uniform<Vector3[]>;
  /** per chart: the camera's coordinates in it */
  uOceanChartCamera: Uniform<Vector2[]>;
  /** the slot of the chart every pixel takes, while the waves meet no other near the camera; −1 for each its own */
  uOceanChartOnly: Uniform<number>;
};

/**
 * The chart a point takes (see {@link OceanCharts.chartAt}).
 *
 * @group Utils
 */
export type OceanChartAt = {
  /** 0 the field's, 1 and up the fixed ones */
  chart: number;
  /** how much of the waves are kept there: 1, but for the calm strip where two charts meet */
  keep: number;
};

const PHI = (1 + Math.sqrt(5)) / 2;

// The fixed charts' centres on a geodesic sphere, in the Earth's own axes (X toward
// longitude 0 on the equator, Z north), and true east and north at each: at the poles,
// where north is all round, toward longitude 180 is taken for it.
function earthCharts(frequency: number) {
  const corners: Vector3[] = [];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      corners.push(
        new Vector3(0, a, b * PHI).normalize(),
        new Vector3(a, b * PHI, 0).normalize(),
        new Vector3(b * PHI, 0, a).normalize(),
      );
    }
  }
  // The edges are the closest pairs; the faces, the triples all joined.
  let edge = Infinity;
  for (const corner of corners.slice(1))
    edge = Math.min(edge, corners[0].distanceTo(corner));
  const joined = (i: number, j: number) =>
    corners[i].distanceTo(corners[j]) < edge * 1.01;
  const points = new Map<string, Vector3>();
  for (let i = 0; i < 12; i++) {
    for (let j = i + 1; j < 12; j++) {
      if (!joined(i, j)) continue;
      for (let k = j + 1; k < 12; k++) {
        if (!joined(i, k) || !joined(j, k)) continue;
        for (let a = 0; a <= frequency; a++) {
          for (let b = 0; a + b <= frequency; b++) {
            const p = new Vector3()
              .addScaledVector(corners[i], a)
              .addScaledVector(corners[j], b)
              .addScaledVector(corners[k], frequency - a - b)
              .normalize();
            const key = [p.x, p.y, p.z].map(n => n.toFixed(6)).join(',');
            if (!points.has(key)) points.set(key, p);
          }
        }
      }
    }
  }
  return [...points.values()].map(centre => {
    const north = new Vector3(0, 0, 1).addScaledVector(centre, -centre.z);
    if (north.lengthSq() < 1e-12) north.set(-1, 0, 0);
    north.normalize();
    const east = new Vector3().crossVectors(north, centre);
    return { centre, east, north };
  });
}

let earthChartsCache: ReturnType<typeof earthCharts> | null = null;

const smoothstep = (a: number, b: number, t: number) => {
  const u = Math.min(Math.max((t - a) / (b - a), 0), 1);
  return u * u * (3 - 2 * u);
};

const toPoint = new Vector3();
const xE = new Vector3();
const yE = new Vector3();
const pole = new Vector3();
const across = new Vector3();
const trueEast = new Vector3();
const east = new Vector3();
const north = new Vector3();

/**
 * The charts a sea's waves are drawn in, so that far round the Earth from the field they
 * lie on the sea there, not on the field's plane seen edge on: the field's own, out to
 * {@link OCEAN_FIELD_CHART_REACH} from it, and past it fixed ones about the 162 points of a
 * geodesic sphere fixed on the Earth (on a {@link Globe} with a frame; without one, on its
 * own axes). Each is stereographic, about its centre: conformal, so the waves keep their
 * shape, and within a chart's reach stretched by under 1%. The field's chart is its wave
 * plane over the disc (world X/Z, as the plane is set), to within a centimetre 100 km out.
 * Every fixed chart is turned so the wave plane's X has the bearing at its centre that it
 * has at the field: the waves keep the wind's compass bearing.
 *
 * A point's coordinates in a chart, and which chart it takes, depend on the point alone,
 * so the sea is the same however the camera reaches it, and data placed by latitude and
 * longitude can drive it. Where two charts meet, the waves calm over a strip
 * {@link OCEAN_CHART_CALM} wide, and the charts switch on its middle: drawn twice to
 * cross-fade, the waves cost a stage 1.4–2 ms more at the field, where no strip lies. The
 * shaders (`ocean-charts.glsl`) take them from the camera's coordinates, worked out here in
 * 64-bit floats ({@link setCamera}), plus the offset from the camera, so the waves are as
 * precise far round the Earth as over the field. With the globe off, only the field's
 * plane.
 *
 * @group Utils
 */
export class OceanCharts {
  /** bound by reference; kept up to date by {@link setCamera} */
  readonly uniforms: OceanChartUniforms;

  private readonly planeX = new Vector3(1, 0, 0);
  private readonly planeZ = new Vector3(0, 0, 1);
  // The fixed charts in the world, for the globe as last seen: centres and axes.
  private readonly centres: Vector3[] = [];
  private readonly xs: Vector3[] = [];
  private readonly zs: Vector3[] = [];
  private readonly fieldOffset = new Vector2();
  // What they were made for, and where the camera uniforms were last set for.
  private made: number[] = [];
  private readonly cameraAt = new Vector3();
  private cameraMade: number[] = [];
  private cameraWaves = Infinity;

  constructor(private readonly globe: Globe) {
    const vectors = (n: number) =>
      Array.from({ length: n }, () => new Vector3());
    this.uniforms = {
      uOceanCharts: new Uniform(new Vector4()),
      uOceanChartOrigin: new Uniform(new Vector3()),
      uOceanChartCentre: new Uniform(vectors(1 + FIXED_IN_VIEW)),
      uOceanChartX: new Uniform(vectors(1 + FIXED_IN_VIEW)),
      uOceanChartZ: new Uniform(vectors(1 + FIXED_IN_VIEW)),
      uOceanChartCamera: new Uniform(
        Array.from({ length: 1 + FIXED_IN_VIEW }, () => new Vector2()),
      ),
      uOceanChartOnly: new Uniform(0),
    };
    earthChartsCache ??= earthCharts(FREQUENCY);
    for (let i = 0; i < earthChartsCache.length; i++) {
      this.centres.push(new Vector3());
      this.xs.push(new Vector3());
      this.zs.push(new Vector3());
    }
    this.refresh();
  }

  /**
   * Set the wave plane's axes over the field (unit, in the world): its X and Z, as the
   * waves' coordinates there are world X/Z along them. Default world +X and +Z.
   */
  setPlane(x: Vector3, z: Vector3) {
    this.planeX.copy(x).normalize();
    this.planeZ.copy(z).normalize();
    this.made = [];
  }

  /** whether the charts curve with the globe; off, only the field's plane */
  get enabled(): boolean {
    return this.globe.enabled;
  }

  /** how many charts there are: the field's (0) and the fixed ones (1 and up) */
  get count(): number {
    return 1 + this.centres.length;
  }

  /**
   * Chart `chart`'s centre (a unit direction from the sphere's centre) and its axes, the
   * wave plane's X and Z there, in the world.
   */
  axes(chart: number, centre: Vector3, x: Vector3, z: Vector3) {
    this.refresh();
    if (chart === 0) {
      centre.copy(this.globe.up);
      x.copy(this.planeX);
      z.copy(this.planeZ);
      return;
    }
    centre.copy(this.centres[chart - 1]);
    x.copy(this.xs[chart - 1]);
    z.copy(this.zs[chart - 1]);
  }

  /**
   * World `point`'s coordinates in chart `chart`'s wave plane: where it projects onto the
   * plane touching the sphere at the chart's centre, from the opposite pole. With the globe
   * off, its world X/Z along the plane's axes.
   */
  coords(chart: number, point: Vector3, target: Vector2): Vector2 {
    this.refresh();
    const { globe } = this;
    const x = chart === 0 ? this.planeX : this.xs[chart - 1];
    const z = chart === 0 ? this.planeZ : this.zs[chart - 1];
    if (!globe.enabled) return target.set(point.dot(x), point.dot(z));
    const centre = chart === 0 ? globe.up : this.centres[chart - 1];
    const R = globe.radius;
    toPoint.subVectors(point, globe.centre);
    const k = (2 * R) / (R + toPoint.dot(centre));
    target.set(k * toPoint.dot(x), k * toPoint.dot(z));
    if (chart === 0) target.add(this.fieldOffset);
    return target;
  }

  /**
   * The chart world `point` on the sea takes, as the shaders take it, and how much of the
   * waves are kept there: the field's within its reach, past it the fixed chart nearest the
   * point. Where two meet the waves calm over {@link OCEAN_CHART_CALM}, by how far the
   * point lies from the line between them: the field's reach, or the line as far from two
   * fixed charts' centres.
   */
  chartAt(point: Vector3): OceanChartAt {
    this.refresh();
    if (!this.globe.enabled) return { chart: 0, keep: 1 };
    const { chart, margin } = this.locate(point);
    return { chart, keep: smoothstep(0, OCEAN_CHART_CALM / 2, margin) };
  }

  // The chart `point` takes, and how far it lies from where that chart meets another (half
  // the difference of its distances from two fixed charts' centres, which is never more).
  private locate(point: Vector3): { chart: number; margin: number } {
    const { globe } = this;
    const R = globe.radius;
    const u = toPoint.subVectors(point, globe.centre).normalize();
    const angle = (to: Vector3) =>
      Math.acos(Math.min(Math.max(u.dot(to), -1), 1));
    const fieldFrom = R * angle(globe.up);
    if (fieldFrom < OCEAN_FIELD_CHART_REACH)
      return { chart: 0, margin: OCEAN_FIELD_CHART_REACH - fieldFrom };
    let a1 = Infinity;
    let a2 = Infinity;
    let i1 = 0;
    for (let i = 0; i < this.centres.length; i++) {
      const a = angle(this.centres[i]);
      if (a < a1) {
        a2 = a1;
        a1 = a;
        i1 = i;
      } else if (a < a2) a2 = a;
    }
    return {
      chart: 1 + i1,
      margin: Math.min(
        fieldFrom - OCEAN_FIELD_CHART_REACH,
        (R * (a2 - a1)) / 2,
      ),
    };
  }

  /**
   * Set the uniforms for a camera at `position` (world): the field's chart and the three
   * fixed ones nearest it, and its coordinates in each, in 64-bit floats. With `waves`, how
   * far from the camera the waves show (the sea's detail fade's end): while no chart meets
   * another that near, every pixel takes the camera's chart, and the shaders skip finding
   * theirs. Call it for each camera that draws with them, before it draws; a call for the
   * same place, globe and `waves` returns at once.
   */
  setCamera(position: Vector3, waves = Infinity) {
    this.refresh();
    if (
      this.cameraMade === this.made &&
      position.equals(this.cameraAt) &&
      waves === this.cameraWaves
    )
      return;
    this.cameraMade = this.made;
    this.cameraAt.copy(position);
    this.cameraWaves = waves;
    const { globe } = this;
    const u = this.uniforms;
    const centres = u.uOceanChartCentre.value;
    const xs = u.uOceanChartX.value;
    const zs = u.uOceanChartZ.value;
    const cameras = u.uOceanChartCamera.value;
    centres[0].copy(globe.up);
    xs[0].copy(this.planeX);
    zs[0].copy(this.planeZ);
    u.uOceanChartOnly.value = 0;
    if (!globe.enabled) {
      u.uOceanCharts.value.set(globe.radius, 0, OCEAN_CHART_CALM, 0);
      return;
    }
    const R = globe.radius;
    const origin = u.uOceanChartOrigin.value.subVectors(position, globe.centre);
    const at = across.copy(origin).normalize();
    // The fixed charts nearest the camera, nearest first.
    const nearest: number[] = [];
    for (let i = 0; i < this.centres.length; i++) {
      const d = at.dot(this.centres[i]);
      let k = nearest.length;
      while (k > 0 && at.dot(this.centres[nearest[k - 1]]) < d) k--;
      if (k < FIXED_IN_VIEW) {
        nearest.splice(k, 0, i);
        if (nearest.length > FIXED_IN_VIEW) nearest.pop();
      }
    }
    for (let slot = 0; slot <= FIXED_IN_VIEW; slot++) {
      const chart = slot === 0 ? 0 : 1 + nearest[slot - 1];
      if (slot > 0) {
        centres[slot].copy(this.centres[chart - 1]);
        xs[slot].copy(this.xs[chart - 1]);
        zs[slot].copy(this.zs[chart - 1]);
      }
      // Toward the chart's opposite pole its coordinates run off; none of it is drawn there.
      if (R + origin.dot(centres[slot]) < 0.1 * R) cameras[slot].set(0, 0);
      else this.coords(chart, position, cameras[slot]);
    }
    // The camera's chart for every pixel, while the nearest line where it meets another is
    // farther than the waves show: over the ground, a point within `waves` of the camera
    // lies no farther than that from the camera's foot.
    const { chart, margin } = this.locate(position);
    u.uOceanChartOnly.value =
      margin > waves + OCEAN_CHART_CALM / 2
        ? chart === 0
          ? 0
          : 1 + nearest.indexOf(chart - 1)
        : -1;
    u.uOceanCharts.value.set(R, OCEAN_FIELD_CHART_REACH, OCEAN_CHART_CALM, 1);
  }

  // Make the fixed charts again, and the field's offset, when the globe or the plane
  // changed: they lie on the Earth, which the globe places.
  private refresh() {
    const { globe } = this;
    const up = globe.up;
    const n = globe.north;
    const C = globe.centre;
    const c = globe.discCentre;
    const chi0 = globe.frame ? globe.sphereLatitude : 0;
    const lambda0 = (globe.location?.longitude ?? 0) * DEG;
    const state = [
      globe.enabled ? 1 : 0,
      globe.radius,
      chi0,
      lambda0,
      ...up.toArray(),
      ...n.toArray(),
      ...C.toArray(),
      ...c.toArray(),
      ...this.planeX.toArray(),
      ...this.planeZ.toArray(),
    ];
    if (
      state.length === this.made.length &&
      state.every((value, i) => value === this.made[i])
    )
      return;
    this.made = state;
    this.fieldOffset.set(c.dot(this.planeX), c.dot(this.planeZ));
    // The Earth's axes in the world, from the disc's centre: at conformal latitude chi0 and
    // longitude lambda0, up there, with true north and east.
    trueEast.crossVectors(n, up);
    pole
      .copy(n)
      .multiplyScalar(Math.cos(chi0))
      .addScaledVector(up, Math.sin(chi0));
    across
      .copy(n)
      .multiplyScalar(-Math.sin(chi0))
      .addScaledVector(up, Math.cos(chi0));
    xE.copy(across)
      .multiplyScalar(Math.cos(lambda0))
      .addScaledVector(trueEast, -Math.sin(lambda0));
    yE.copy(across)
      .multiplyScalar(Math.sin(lambda0))
      .addScaledVector(trueEast, Math.cos(lambda0));
    // The wave plane's X from true east at the field, toward true north.
    const gamma = Math.atan2(this.planeX.dot(n), this.planeX.dot(trueEast));
    const cos = Math.cos(gamma);
    const sin = Math.sin(gamma);
    const toWorld = (v: Vector3, target: Vector3) =>
      target
        .copy(xE)
        .multiplyScalar(v.x)
        .addScaledVector(yE, v.y)
        .addScaledVector(pole, v.z);
    earthChartsCache!.forEach((chart, i) => {
      const centre = toWorld(chart.centre, this.centres[i]);
      toWorld(chart.east, east);
      toWorld(chart.north, north);
      this.xs[i].copy(east).multiplyScalar(cos).addScaledVector(north, sin);
      this.zs[i].crossVectors(this.xs[i], centre);
    });
  }
}
