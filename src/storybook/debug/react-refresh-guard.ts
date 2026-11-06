// Storybook, in development: React Refresh (Vite's HMR runtime) kept every R3F root a story had
// unmounted, and with it that story's store, renderer and scene (some 25 MB a story switch).
//
// Refresh hooks the React DevTools global hook's onCommitFiberRoot: each commit registers its
// root (`helpersByRoot`), and only the commit that unmounts a mounted root lets it go. React
// commits an unmounted R3F root once more in the same flush, empty before and after (an update
// scheduled as its tree unmounts), and Refresh registers it again for good. Such a commit is not
// passed on: nothing is mounted there for Refresh, or DevTools, to know of. One that errored is,
// for Refresh to retry it.

const GUARDED = Symbol.for('videx-3d.react-refresh-guard');

type Fiber = {
  memoizedState?: { element?: unknown } | null;
  alternate?: Fiber | null;
} | null;
type CommitFiberRoot = ((
  id: number,
  root: { current: Fiber },
  priority?: unknown,
  didError?: boolean,
) => unknown) & { [GUARDED]?: true };
type DevToolsHook = { onCommitFiberRoot?: CommitFiberRoot };

const shown = (fiber: Fiber | undefined) =>
  fiber?.memoizedState?.element != null;

/** Keep React Refresh from holding on to the roots of unmounted stories (see above). */
export function guardReactRefresh() {
  const hook = (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const commit = hook?.onCommitFiberRoot;
  if (!hook || !commit || commit[GUARDED]) return;
  const guarded: CommitFiberRoot = function (this: unknown, ...args) {
    const [, root, , didError] = args;
    const current = root?.current;
    if (!didError && !shown(current) && !shown(current?.alternate)) return;
    return commit.apply(this, args);
  };
  guarded[GUARDED] = true;
  hook.onCommitFiberRoot = guarded;
}
