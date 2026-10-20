import type { Object3D } from 'three';

/**
 * Hide every visible branch of the scene graph that holds none of `keep`, so a render's
 * traversal skips it whole. What it hid is pushed onto `hidden`, for the caller to show
 * again; the ancestors of `keep`, and `keep` itself, are left as they are.
 */
export function hideIdleBranches(
  keep: readonly Object3D[],
  hidden: Object3D[],
): void {
  const needed = new Set<Object3D>();
  for (const object of keep) {
    for (let o: Object3D | null = object; o && !needed.has(o); o = o.parent) {
      needed.add(o);
    }
  }
  for (const o of needed) {
    for (const child of o.children) {
      if (child.visible && !needed.has(child)) {
        child.visible = false;
        hidden.push(child);
      }
    }
  }
}
