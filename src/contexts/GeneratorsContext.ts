import { createContext } from 'react'

import { Remote } from 'comlink'
import { GeneratorRegistry } from '../sdk'

/**
 * Generators context
 * 
 * @see {@link GeneratorRegistry}
 * @see {@link GeneratorsProvider}
 * @see [Generators](/videx-3d/docs/documents/generators.html)
 * 
 * @group Contexts
 */
export const GeneratorsContext = createContext<GeneratorRegistry | Remote<GeneratorRegistry> | null>(null)
