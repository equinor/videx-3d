import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import {
  createPickSchedule,
  markPicked,
  markRead,
  observeCamera,
  PICK_READ_WAIT,
  pickDue,
} from '../src/components/EventEmitter/pick-schedule';

describe('pick schedule', () => {
  const setup = () => {
    const camera = new PerspectiveCamera(50, 1, 1, 1000);
    camera.position.set(10, 20, 30);
    camera.updateMatrixWorld();
    const schedule = createPickSchedule();
    const pointer = { x: 0.25, y: -0.5 };
    return { camera, schedule, pointer };
  };
  // A frame in which the camera stood still since the one before.
  const settle = (s: ReturnType<typeof setup>) => {
    observeCamera(s.schedule, s.camera);
    observeCamera(s.schedule, s.camera);
  };

  it('picks once, then not again while nothing changes', () => {
    const s = setup();
    const { camera, schedule, pointer } = s;
    settle(s);
    expect(pickDue(schedule, pointer, camera, 1, 0)).toBe(true);
    markPicked(schedule, pointer, camera, 1);
    expect(pickDue(schedule, pointer, camera, 1, 0)).toBe(false);
    expect(pickDue(schedule, { ...pointer }, camera, 1, 0)).toBe(false);
  });

  it('picks again when the pointer or the listeners change', () => {
    const s = setup();
    const { camera, schedule, pointer } = s;
    settle(s);
    markPicked(schedule, pointer, camera, 1);
    expect(pickDue(schedule, { x: 0.26, y: -0.5 }, camera, 1, 0)).toBe(true);
    expect(pickDue(schedule, pointer, camera, 2, 0)).toBe(true);
  });

  it('picks a moved camera only once it has stopped', () => {
    const s = setup();
    const { camera, schedule, pointer } = s;
    settle(s);
    markPicked(schedule, pointer, camera, 1);

    camera.position.x += 1;
    camera.updateMatrixWorld();
    observeCamera(schedule, camera);
    expect(pickDue(schedule, pointer, camera, 1, 0)).toBe(false);
    observeCamera(schedule, camera);
    expect(pickDue(schedule, pointer, camera, 1, 0)).toBe(true);
    markPicked(schedule, pointer, camera, 1);

    // A zoom moves nothing but the projection.
    camera.zoom = 2;
    camera.updateProjectionMatrix();
    observeCamera(schedule, camera);
    expect(pickDue(schedule, pointer, camera, 1, 0)).toBe(false);
    observeCamera(schedule, camera);
    expect(pickDue(schedule, pointer, camera, 1, 0)).toBe(true);
  });

  it('still follows the pointer while the camera moves', () => {
    const s = setup();
    const { camera, schedule, pointer } = s;
    settle(s);
    markPicked(schedule, pointer, camera, 1);
    camera.position.x += 1;
    camera.updateMatrixWorld();
    observeCamera(schedule, camera);
    expect(pickDue(schedule, { x: 0.3, y: -0.5 }, camera, 1, 0)).toBe(true);
  });

  it('waits out a slow read back before the next pick', () => {
    const s = setup();
    const { camera, schedule, pointer } = s;
    settle(s);
    markPicked(schedule, pointer, camera, 1);
    markRead(schedule, 1000, 10);
    const moved = { x: 0.5, y: 0.5 };
    expect(pickDue(schedule, moved, camera, 1, 1000 + PICK_READ_WAIT * 10 - 1)).toBe(false);
    expect(pickDue(schedule, moved, camera, 1, 1000 + PICK_READ_WAIT * 10)).toBe(true);
    // An asked-for pick waits too: the cost is the same.
    schedule.requested = true;
    expect(pickDue(schedule, pointer, camera, 1, 1001)).toBe(false);
  });

  it('picks when asked to, once', () => {
    const s = setup();
    const { camera, schedule, pointer } = s;
    settle(s);
    markPicked(schedule, pointer, camera, 1);
    schedule.requested = true;
    expect(pickDue(schedule, pointer, camera, 1, 0)).toBe(true);
    markPicked(schedule, pointer, camera, 1);
    expect(pickDue(schedule, pointer, camera, 1, 0)).toBe(false);
  });
});
