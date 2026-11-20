import { Remote, wrap } from 'comlink';
import type { MockStore, StoryStoreData } from './MockStore';

// The stories' data store: a `MockStore` on a worker of its own, one per page, shared by
// every story shown in it. Started on first use.
let worker: Worker | null = null;
let store: Remote<MockStore> | null = null;

/** The stories' data store (see `DataProviderDecorator`), started on first call. */
export function storyStore(): Remote<MockStore> {
  if (!store) {
    worker = new Worker(
      new URL('../decorators/workers/remote-mock-store.ts', import.meta.url),
      { type: 'module' },
    );
    store = wrap<MockStore>(worker);
  }
  return store;
}

// ⚠️ A hot update RE-EXECUTES this module, so without this the previous worker
// stays alive for the life of the page — with the whole dataset still cached in
// it. A handful of edits then costs several hundred MB and a thread each.
import.meta.hot?.dispose(() => worker?.terminate());

/**
 * The store's init step, as a Storybook loader (`.storybook/preview.tsx`): before each story
 * renders, the store is made to hold what its `parameters.store` asks for
 * ({@link StoryStoreData}), or, without it, the demo files alone — so a story never sees
 * what the one before it asked for. A page with no store yet gets one only for a story
 * that asks; the others start it with the demo files alone as they first use it.
 */
export async function storyStoreLoader({
  parameters,
}: {
  parameters: { store?: StoryStoreData };
}) {
  if (store || parameters.store) await storyStore().init(parameters.store);
  return {};
}
