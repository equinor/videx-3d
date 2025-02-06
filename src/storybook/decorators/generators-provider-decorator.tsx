
import { GeneratorsProvider } from '../../contexts/GeneratorsContextProvider'

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
import { Remote, wrap } from 'comlink'
import { GeneratorRegistry } from '../../sdk/data/GeneratorRegistry'


const registry: Remote<GeneratorRegistry> = wrap(new Worker(new URL('workers/remote-generator-registry.ts', import.meta.url), { type: 'module' }))

export const GeneratorsProviderDecorator = (Story: any) => (
  <GeneratorsProvider registry={registry}>
    <Story />
  </GeneratorsProvider>
)
