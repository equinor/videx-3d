import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CAMERA_PROBE_ORDER,
  CameraSiteStore,
  reportCameraWater,
} from '../src/sdk/utils/camera-site';

describe('CameraSiteStore', () => {
  it('runs the probes once a frame, in their order, for all that asks', () => {
    const store = new CameraSiteStore();
    const camera = new PerspectiveCamera();
    camera.position.set(0, -20, 0);
    const runs: string[] = [];
    // Registered out of order: the sky reads the ground.
    store.probe(site => {
      runs.push('sky');
      site.buried = site.ground !== null && site.position.y < site.ground;
    }, CAMERA_PROBE_ORDER.scenery);
    store.probe(site => {
      runs.push('ground');
      site.ground = -10;
    }, CAMERA_PROBE_ORDER.ground);
    store.tick();
    expect(store.get(camera).buried).toBe(true);
    expect(store.get(camera).buried).toBe(true);
    expect(runs).toEqual(['ground', 'sky']);
    store.tick();
    camera.position.y = 5;
    expect(store.get(camera).buried).toBe(false);
    expect(runs).toEqual(['ground', 'sky', 'ground', 'sky']);
  });

  it('works a site out for each camera, and forgets an unregistered probe', () => {
    const store = new CameraSiteStore();
    const near = new PerspectiveCamera();
    const far = new PerspectiveCamera();
    far.position.set(0, 100, 0);
    const unregister = store.probe(site => {
      site.altitude = site.position.y;
    });
    store.tick();
    expect(store.get(near).altitude).toBe(0);
    expect(store.get(far).altitude).toBe(100);
    unregister();
    expect(store.get(far).altitude).toBeNull();
  });

  it('keeps the water the camera is in over one it is only at, a bounded one over an endless sea', () => {
    const store = new CameraSiteStore();
    store.probe(site =>
      reportCameraWater(site, {
        depth: 5,
        over: true,
        inside: true,
        owner: 'sky',
        endless: true,
      }),
    );
    store.probe(site =>
      reportCameraWater(site, {
        depth: 5,
        over: false,
        inside: false,
        owner: 'box',
      }),
    );
    store.probe(site =>
      reportCameraWater(site, {
        depth: 5,
        over: true,
        inside: true,
        owner: 'sea',
      }),
    );
    store.probe(site =>
      reportCameraWater(site, {
        depth: 5,
        over: true,
        inside: true,
        owner: 'later',
      }),
    );
    expect(store.get(new PerspectiveCamera()).water?.owner).toBe('sea');
  });
});
