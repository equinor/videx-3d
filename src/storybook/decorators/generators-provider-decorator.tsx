import { GeneratorsProvider } from '../../contexts/GeneratorsContextProvider';

/* Run in main thread */

// const registry = new GeneratorRegistry()
// registry.add(basicTrajectory, generateBasicTrajectory)
// registry.add(tubeTrajectory, generateTubeTrajectory)
// registry.add(completionTools, generateCompletionTools)
// registry.add(casings, generateCasings)
// registry.add(perimeterGeometry, generatePerimeterGeometry)
// registry.add(casingAnnotations, generateCasingAnnotations)
// registry.add(completionToolAnnotations, generateCompletionToolAnnotations)
// registry.add(incidentAnnotations, generateIncidentAnnotations)

/* Use worker */
import { Remote, wrap } from 'comlink';
import { GeneratorRegistry } from '../../sdk/data/GeneratorRegistry';

const worker = new Worker(
  new URL('workers/remote-generator-registry.ts', import.meta.url),
  { type: 'module' },
);

const registry: Remote<GeneratorRegistry> = wrap(worker);

// ⚠️ A hot update RE-EXECUTES this module. An orphaned generator worker keeps the
// resolved column (hundreds of MB) AND the sub-workers of its internal pool, so
// each edit would add ~9 threads that never go away. Terminating the parent
// terminates the pool with it.
import.meta.hot?.dispose(() => worker.terminate());

export const GeneratorsProviderDecorator = (Story: any) => (
  <GeneratorsProvider registry={registry}>
    <Story />
  </GeneratorsProvider>
);
