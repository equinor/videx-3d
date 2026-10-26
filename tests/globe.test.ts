import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SkyMaterial } from '../src/components/Sky/sky-material';
import { EARTH_RADIUS, Globe } from '../src/sdk/projection/globe';

const R = EARTH_RADIUS;
// A field's stage: 8 km by 6 km about (1000, -2000), so a disc of 5 km.
const BOUNDS: [number, number, number, number] = [-3000, -5000, 5000, 1000];
const LEVEL = 12;

const globe = (bounds = BOUNDS) => {
  const g = new Globe();
  g.level = LEVEL;
  g.setDisc(bounds);
  return g;
};

// The sphere as plainly as it can be put, for reference.
const fromCentre = (g: Globe, p: Vector3) => p.distanceTo(g.centre);

describe('Globe, off', () => {
  it('is the level plane everywhere', () => {
    const g = globe();
    g.enabled = false;
    const p = new Vector3(200000, LEVEL + 40, -90000);
    expect(g.altitude(p)).toBeCloseTo(40, 9);
    expect(g.upAt(p, new Vector3()).toArray()).toEqual([0, 1, 0]);
    expect(g.place(200000, -90000, 7, new Vector3()).toArray()).toEqual([
      200000,
      LEVEL + 7,
      -90000,
    ]);
    const down = g.reach(new Vector3(0, LEVEL + 100, 0), new Vector3(1, -1, 0));
    expect(down.hit).toBe(true);
    expect(down.distance).toBeCloseTo(100 * Math.SQRT2, 9);
    expect(
      g.reach(new Vector3(0, LEVEL + 100, 0), new Vector3(1, 0.01, 0)).hit,
    ).toBe(false);
  });
});

describe('Globe, the surface', () => {
  it('centres the sphere just far enough below for the plane to meet it on the disc edge', () => {
    const g = globe();
    expect(g.discRadius).toBe(5000);
    expect(g.discCentre.toArray()).toEqual([1000, LEVEL, -2000]);
    expect(g.centreDepth).toBeCloseTo(Math.sqrt(R * R - 5000 * 5000), 6);
    // r² / 2R below R: about 2 m for a disc of 5 km.
    expect(R - g.centreDepth).toBeCloseTo((5000 * 5000) / (2 * R), 3);
    const edge = new Vector3(1000 + 3000, LEVEL, -2000 + 4000);
    expect(fromCentre(g, edge)).toBeCloseTo(R, 6);
  });

  it('is the level plane over the disc', () => {
    const g = globe();
    const p = g.place(2000, 0, 50, new Vector3());
    expect(p.toArray()).toEqual([2000, LEVEL + 50, 0]);
    expect(g.altitude(p)).toBeCloseTo(50, 9);
    expect(g.upAt(p, new Vector3()).toArray()).toEqual([0, 1, 0]);
  });

  it.each([6000, 50000, 500000, 2000000])(
    'is the sphere beyond it, %i m out',
    distance => {
      const g = globe();
      for (const height of [0, 0.001, 120, -300]) {
        const p = g.place(
          1000 + distance * 0.6,
          -2000 - distance * 0.8,
          height,
          new Vector3(),
        );
        expect(fromCentre(g, p) - R).toBeCloseTo(height, 6);
        expect(g.altitude(p)).toBeCloseTo(height, 6);
        const up = g.upAt(p, new Vector3());
        const away = p.clone().sub(g.centre).normalize();
        expect(up.angleTo(away)).toBeLessThan(1e-7);
      }
    },
  );

  it('falls away from the plane by the sphere: d²/2R to first order', () => {
    const g = globe();
    const p = g.place(1000 + 100000, -2000, 0, new Vector3());
    const drop = LEVEL - p.y;
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeCloseTo((100000 ** 2 - 5000 ** 2) / (2 * R), -1);
  });

  it('does not jump on the disc edge', () => {
    const g = globe();
    const at = (distance: number, height: number) =>
      g.place(1000 + distance, -2000, height, new Vector3());
    // On the ground, one surface: the two points lie as far apart as they were asked to.
    expect(at(4999.999, 0).distanceTo(at(5000.001, 0))).toBeCloseTo(0.002, 6);
    // Over it, up turns by the angle the plane and the sphere meet at, r / R: 30 m up
    // moves by 30 r / R.
    const inside = at(4999.999, 30);
    const outside = at(5000.001, 30);
    expect(inside.distanceTo(outside)).toBeLessThan((30 * 5000) / R + 0.003);
    expect(g.altitude(inside) - g.altitude(outside)).toBeLessThan(1e-6);
    const turn = g
      .upAt(inside, new Vector3())
      .angleTo(g.upAt(outside, new Vector3()));
    expect(turn).toBeCloseTo(5000 / R, 7);
  });

  it('carries a point back to the map point under it', () => {
    const g = globe();
    for (const [x, z] of [
      [2000, 0],
      [1000 + 60000, -2000 + 30000],
      [1000 - 900000, -2000 + 1200000],
    ]) {
      const foot = g.foot(g.place(x, z, 750, new Vector3()), new Vector3());
      expect(foot.x).toBeCloseTo(x, 6);
      expect(foot.y).toBeCloseTo(LEVEL, 6);
      expect(foot.z).toBeCloseTo(z, 6);
    }
  });

  it('a disc of no size: the sphere touches the plane at the origin', () => {
    const g = new Globe();
    g.level = LEVEL;
    expect(g.discRadius).toBe(0);
    expect(g.centreDepth).toBe(R);
    expect(g.centre.toArray()).toEqual([0, LEVEL - R, 0]);
    const p = g.place(20000, 0, 0, new Vector3());
    expect(fromCentre(g, p)).toBeCloseTo(R, 6);
  });

  it('works about a tilted up', () => {
    const g = globe();
    g.setUp(new Vector3(0.1, 1, 0.2));
    expect(g.up.length()).toBeCloseTo(1, 12);
    // The disc's centre lies on the level plane along the tilted up.
    expect(g.discCentre.dot(g.up)).toBeCloseTo(LEVEL, 9);
    const near = g.place(1000 + 3000, -2000, 25, new Vector3());
    expect(g.altitude(near)).toBeCloseTo(25, 6);
    const far = g.place(1000 + 80000, -2000, 25, new Vector3());
    expect(g.altitude(far)).toBeCloseTo(25, 6);
    expect(fromCentre(g, far) - R).toBeCloseTo(25, 6);
  });
});

describe('Globe, a view ray', () => {
  it('meets the plane over the disc', () => {
    const g = globe();
    const eye = new Vector3(1000, LEVEL + 500, -2000);
    const reach = g.reach(eye, new Vector3(1, -1, 0));
    expect(reach.hit).toBe(true);
    expect(reach.distance).toBeCloseTo(500 * Math.SQRT2, 6);
  });

  it('meets the sphere beyond, where the ground lies', () => {
    const g = globe();
    const eye = new Vector3(1000, LEVEL + 200, -2000);
    const far = g.place(1000 + 30000, -2000 + 10000, 0, new Vector3());
    const dir = far.clone().sub(eye);
    const reach = g.reach(eye, dir);
    expect(reach.hit).toBe(true);
    expect(reach.distance).toBeCloseTo(dir.length(), 3);
  });

  it('meets the sphere a seabed lower, about the same centre', () => {
    const g = globe();
    const eye = g.place(1000 + 40000, -2000, 300, new Vector3());
    const dir = g
      .upAt(eye, new Vector3())
      .negate()
      .add(new Vector3(0.3, 0, 0));
    const reach = g.reach(eye, dir, 100);
    expect(reach.hit).toBe(true);
    const hit = eye.clone().addScaledVector(dir.normalize(), reach.distance);
    expect(fromCentre(g, hit)).toBeCloseTo(R - 100, 3);
  });

  it('dips to the horizon by acos(R / (R + h)) far off', () => {
    const g = globe();
    const height = 1000;
    const eye = g.place(1000 + 100000, -2000, height, new Vector3());
    const up = g.upAt(eye, new Vector3());
    // Level, away from the disc.
    const level = new Vector3(1, 0, 0).addScaledVector(up, -up.x).normalize();
    const dip = Math.acos(R / (R + height));
    const at = (angle: number) =>
      level
        .clone()
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(up, -Math.sin(angle));
    expect(g.reach(eye, at(dip * 1.01)).hit).toBe(true);
    const missed = g.reach(eye, at(dip * 0.99));
    expect(missed.hit).toBe(false);
    // A miss: where it passes closest to the centre, ahead.
    expect(missed.distance).toBeGreaterThan(0);
  });

  it('passes over the field through the cut-off cap, and meets nothing', () => {
    const g = globe();
    // From 20 km off, a metre over the plane: the sphere's cap stands 2 m over the field.
    const eye = new Vector3(1000 - 20000, LEVEL + 1, -2000);
    const reach = g.reach(eye, new Vector3(1, 0, 0));
    expect(reach.hit).toBe(false);
  });

  it('from under the surface, meets nothing', () => {
    const g = globe();
    const under = g.place(1000 + 50000, -2000, -10, new Vector3());
    const reach = g.reach(under, new Vector3(0, -1, 0));
    expect(reach).toEqual({ distance: 0, hit: false });
  });
});

describe('Globe, uniforms', () => {
  it('keep up with the globe', () => {
    const g = globe();
    const { uGlobeUp, uGlobeDisc, uGlobe } = g.uniforms;
    expect(uGlobeDisc.value.toArray()).toEqual([1000, LEVEL, -2000, 5000]);
    expect(uGlobe.value.x).toBe(R);
    expect(uGlobe.value.y).toBe(g.centreDepth);
    expect(uGlobe.value.z).toBe(5000 * 5000);
    expect(uGlobe.value.w).toBe(1);
    g.level = 30;
    expect(uGlobeDisc.value.y).toBe(30);
    g.enabled = false;
    expect(uGlobe.value.w).toBe(0);
    g.setUp(new Vector3(0, 2, 0));
    expect(uGlobeUp.value.toArray()).toEqual([0, 1, 0]);
  });
});

describe('Globe, the camera', () => {
  it('sets what the shaders read of the camera, far off', () => {
    const g = globe();
    const eye = g.place(1000 + 200000, -2000 + 30000, 500, new Vector3());
    g.setCamera(eye);
    const {
      uGlobeCamera,
      uGlobeCameraUp,
      uGlobeCameraRadial,
      uGlobeCameraDip,
    } = g.uniforms;
    const r = fromCentre(g, eye);
    expect(uGlobeCamera.value.x).toBeCloseTo(g.altitude(eye) + LEVEL, 6);
    expect(uGlobeCamera.value.x).toBeCloseTo(500 + LEVEL, 3);
    expect(uGlobeCamera.value.y / (r * r - R * R)).toBeCloseTo(1, 9);
    expect(uGlobeCamera.value.z).toBeCloseTo(r - R, 3);
    expect(uGlobeCameraUp.value.distanceTo(g.upAt(eye, new Vector3()))).toBe(0);
    const radial = eye.clone().sub(g.centre).normalize();
    expect(uGlobeCameraRadial.value.x).toBeCloseTo(radial.x, 12);
    expect(uGlobeCameraRadial.value.y).toBeCloseTo(radial.y, 12);
    expect(uGlobeCameraRadial.value.z).toBeCloseTo(radial.z, 12);
    expect(uGlobeCameraRadial.value.w).toBeCloseTo(Math.sqrt(r * r - R * R), 3);
    const dip = Math.acos(R / r);
    expect(uGlobeCameraDip.value.x).toBeCloseTo(Math.sin(dip), 9);
    expect(uGlobeCameraDip.value.y).toBeCloseTo(Math.cos(dip), 9);
  });

  it('over the disc: the height is along the scene up, and up is the scene up', () => {
    const g = globe();
    g.setCamera(new Vector3(2000, LEVEL + 40, -1000));
    expect(g.uniforms.uGlobeCamera.value.x).toBeCloseTo(LEVEL + 40, 9);
    expect(g.uniforms.uGlobeCameraUp.value.toArray()).toEqual([0, 1, 0]);
  });

  it('follows the globe, and a new place', () => {
    const g = globe();
    const eye = new Vector3(1000 + 50000, LEVEL + 100, -2000);
    g.setCamera(eye);
    const before = g.uniforms.uGlobeCamera.value.x;
    // The same place again, the disc moved under it: set again, not kept.
    g.setDisc([46000, -3000, 54000, -1000]);
    g.setCamera(eye);
    expect(g.uniforms.uGlobeCamera.value.x).toBeCloseTo(LEVEL + 100, 9);
    // 50 km off the old disc, the sphere lay (50² − 5²) km² / 2R ≈ 194 m lower.
    expect(before - (LEVEL + 100)).toBeCloseTo(194, 0);
    g.setCamera(eye.clone().setY(LEVEL + 300));
    expect(g.uniforms.uGlobeCamera.value.x).toBeCloseTo(LEVEL + 300, 9);
  });

  it('SkyMaterial.syncCamera takes the camera from its world matrix', () => {
    const sky = new SkyMaterial();
    sky.setFlatSea(BOUNDS);
    const camera = new PerspectiveCamera();
    camera.position.set(1000, 250, -2000);
    camera.updateMatrixWorld();
    sky.syncCamera(camera);
    expect(sky.globe.uniforms.uGlobeCamera.value.x).toBeCloseTo(250, 9);
    sky.dispose();
  });
});

describe('SkyMaterial.globe', () => {
  it('follows the sky: its stage, its sea level, its curve and its up', () => {
    const sky = new SkyMaterial();
    expect(sky.globe.enabled).toBe(sky.globeEnabled);
    expect(sky.globe.level).toBe(sky.oceanLevel);
    sky.setFlatSea(BOUNDS);
    expect(sky.globe.discRadius).toBe(5000);
    expect(sky.globe.discCentre.x).toBe(1000);
    expect(sky.globe.discCentre.z).toBe(-2000);
    sky.oceanLevel = 7;
    expect(sky.globe.level).toBe(7);
    expect(sky.globe.discCentre.y).toBe(7);
    sky.globeEnabled = false;
    expect(sky.globe.enabled).toBe(false);
    sky.globeEnabled = true;
    expect(sky.globe.enabled).toBe(true);
    sky.setFrame({ up: [0, 3, 0] });
    expect(sky.globe.up.toArray()).toEqual([0, 1, 0]);
    sky.setFlatSea(null);
    expect(sky.globe.discRadius).toBe(0);
    sky.dispose();
  });
});
