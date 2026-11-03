import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { placeTrackOnGlobe } from '../src/components/Layers/track-placement';
import { advanceTrack, courseToHeading } from '../src/sdk/layers/tracks';
import { getProjectionDefFromUtmZone } from '../src/sdk/projection/crs';
import type { GeoFrame } from '../src/sdk/projection/geo-frame';
import { Globe } from '../src/sdk/projection/globe';
import type { Vec2 } from '../src/sdk/types/common';

// The demo field's frame (UTM 31N, ED50), the stage's disc 16 km across about its origin.
const FRAME: GeoFrame = {
  projection: getProjectionDefFromUtmZone('31N'),
  origin: [434500, 6478000],
};
const BOUNDS: [number, number, number, number] = [-8000, -8000, 8000, 8000];

const earth = (level = 0) => {
  const g = new Globe();
  g.setDisc(BOUNDS);
  g.setFrame(FRAME);
  g.level = level;
  return g;
};

const HOME = earth().location!;

// Past the disc, out to the far side of the Earth (not its antipode).
const FAR: [name: string, latitude: number, longitude: number][] = [
  ['150 km west', HOME.latitude, HOME.longitude - 2.6],
  ['400 km south', HOME.latitude - 3.6, HOME.longitude],
  ['the Norwegian Sea', HOME.latitude + 7.6, HOME.longitude + 2],
  ['the mid-Atlantic', 45, -35],
  ['the far side', -20, 150],
];

// The object as the layer draws it: at its X/Z, `height` over the sea, turned to its
// heading, in the frame.
const drawn = (
  frame: Matrix4,
  x: number,
  y: number,
  z: number,
  heading: number,
) => {
  const at = new Vector3(x, y, z).applyMatrix4(frame);
  const bow = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
    .transformDirection(frame)
    .normalize();
  const up = new Vector3(0, 1, 0).transformDirection(frame).normalize();
  return { at, bow, up };
};

describe('placeTrackOnGlobe', () => {
  it('over the disc draws as flat: no transform, the heading the scene’s', () => {
    const g = earth();
    const frame = new Matrix4();
    const placement = { x: 0, z: 0, heading: 0 };
    const at = new Vector3();
    const toScene = (lon: number, lat: number): Vec2 => {
      g.geodetic(lat, lon, 0, at);
      return [at.x, at.z];
    };
    const latitude = HOME.latitude + 0.03;
    const longitude = HOME.longitude - 0.05;
    for (const course of [0, 75, 210]) {
      placeTrackOnGlobe(g, longitude, latitude, course, frame, placement);
      frame.elements.forEach((value, i) =>
        expect(value).toBeCloseTo(new Matrix4().elements[i], 9),
      );
      const [x, z] = toScene(longitude, latitude);
      expect(placement.x).toBeCloseTo(x, 9);
      expect(placement.z).toBeCloseTo(z, 9);
      expect(placement.heading).toBeCloseTo(
        courseToHeading(toScene, longitude, latitude, course),
        9,
      );
    }
  });

  it('beyond it stands the object on the sea where the track is, at any distance', () => {
    const level = 3;
    const g = earth(level);
    const frame = new Matrix4();
    const placement = { x: 0, z: 0, heading: 0 };
    const sea = new Vector3();
    const above = new Vector3();
    const upThere = new Vector3();
    const ahead = new Vector3();
    for (const [name, latitude, longitude] of FAR) {
      for (const course of [0, 75, 210]) {
        placeTrackOnGlobe(g, longitude, latitude, course, frame, placement);
        const { x, z, heading } = placement;
        g.geodetic(latitude, longitude, 0, sea);
        // At the sea's level, and 40 m above it along the globe's up there.
        const onSea = drawn(frame, x, level, z, heading);
        expect(onSea.at.distanceTo(sea), name).toBeLessThan(1e-3);
        g.geodetic(latitude, longitude, 40, above);
        expect(
          drawn(frame, x, level + 40, z, heading).at.distanceTo(above),
          name,
        ).toBeLessThan(1e-3);
        expect(onSea.up.angleTo(g.upAt(sea, upThere)), name).toBeLessThan(1e-9);
        // The bow along the course, as a short step along it on the globe.
        const step = advanceTrack(
          { longitude, latitude, speed: 10, course },
          1,
        );
        g.geodetic(step.latitude, step.longitude, 0, ahead).sub(sea);
        expect(onSea.bow.angleTo(ahead), name).toBeLessThan(1e-5);
      }
    }
  });

  it('with the globe off, draws as flat everywhere', () => {
    const g = earth();
    g.enabled = false;
    const frame = new Matrix4();
    const placement = { x: 0, z: 0, heading: 0 };
    const [, latitude, longitude] = FAR[1];
    placeTrackOnGlobe(g, longitude, latitude, 40, frame, placement);
    frame.elements.forEach((value, i) =>
      expect(value).toBeCloseTo(new Matrix4().elements[i], 9),
    );
  });
});
