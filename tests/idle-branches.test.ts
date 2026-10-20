import { describe, expect, it } from 'vitest';
import { DirectionalLight, Group, Mesh, Object3D } from 'three';
import { hideIdleBranches } from '../src/rendering/idle-branches';

const node = <T extends Object3D>(
  object: T,
  name: string,
  parent?: Object3D,
) => {
  object.name = name;
  parent?.add(object);
  return object;
};

describe('hideIdleBranches', () => {
  // scene
  //   column: oit (label), opaque
  //   wells: well-0..2 (tube)
  //   rig: sun, decor
  //   off (already hidden): ghost
  const scene = node(new Object3D(), 'scene');
  const column = node(new Group(), 'column', scene);
  const oit = node(new Mesh(), 'oit', column);
  const label = node(new Mesh(), 'label', oit);
  const opaque = node(new Mesh(), 'opaque', column);
  const wells = node(new Group(), 'wells', scene);
  for (let i = 0; i < 3; i++) {
    node(new Mesh(), 'tube', node(new Group(), `well-${i}`, wells));
  }
  const rig = node(new Group(), 'rig', scene);
  const sun = node(new DirectionalLight(), 'sun', rig);
  const decor = node(new Mesh(), 'decor', rig);
  const off = node(new Group(), 'off', scene);
  node(new Mesh(), 'ghost', off);
  off.visible = false;

  const visibility = () => {
    const seen: Record<string, boolean> = {};
    scene.traverse(o => {
      seen[o.name] = o.visible;
    });
    return seen;
  };

  it('⭐ hides each branch holding nothing kept, whole, and only those', () => {
    const before = visibility();
    const hidden: Object3D[] = [];
    hideIdleBranches([oit, sun], hidden);

    expect(hidden.map(o => o.name).sort()).toEqual(
      ['decor', 'label', 'opaque', 'wells'].sort(),
    );
    for (const o of [scene, column, oit, rig, sun])
      expect(o.visible).toBe(true);
    // A hidden branch is hidden at its root: what lies under it is left alone.
    const under: boolean[] = [];
    for (const well of wells.children)
      well.traverse(o => under.push(o.visible));
    expect(under.every(Boolean)).toBe(true);
    // Already hidden: neither touched nor listed.
    expect(off.visible).toBe(false);

    for (const o of hidden) o.visible = true;
    expect(visibility()).toEqual(before);
  });

  it('hides nothing when nothing is kept', () => {
    const hidden: Object3D[] = [];
    hideIdleBranches([], hidden);
    expect(hidden).toEqual([]);
    expect(label.visible && opaque.visible && decor.visible).toBe(true);
  });
});
