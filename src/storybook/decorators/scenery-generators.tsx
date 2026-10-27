import { Remote, wrap } from 'comlink';
import { ReactNode } from 'react';
import { GeneratorsProvider } from '../../contexts/GeneratorsContextProvider';
import { GeneratorRegistry } from '../../sdk/data/GeneratorRegistry';

// Made on first use: a story without a sky starts no worker.
let worker: Worker | null = null;
let registry: Remote<GeneratorRegistry> | null = null;

function sceneryRegistry() {
  if (!registry) {
    worker = new Worker(
      new URL('workers/remote-scenery-generator-registry.ts', import.meta.url),
      { type: 'module' },
    );
    registry = wrap(worker);
  }
  return registry;
}

// ⚠️ A hot update re-executes this module: its worker would be orphaned.
import.meta.hot?.dispose(() => worker?.terminate());

/**
 * The sky's generators on a worker of their own: wrap a `Scenery` in it, inside the story's
 * `GeneratorsProvider` and `DataProvider`. The nearest provider answers `useGenerator`,
 * so the stage's relief tiles (and its seabed and single-texture relief) are built there,
 * and stream while a column builds on the story's own worker. Both read the same store.
 */
export const SceneryGenerators = ({ children }: { children: ReactNode }) => (
  <GeneratorsProvider registry={sceneryRegistry()}>
    {children}
  </GeneratorsProvider>
);
