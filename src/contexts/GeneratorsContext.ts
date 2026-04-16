import { createContext } from 'react';

export type GeneratorContextProps = {
  invoke: <T>(key: string, priority: number, args: any[]) => Promise<T>;
};

/**
 * Generators context
 *
 * @see {@link sdk.GeneratorRegistry}
 * @see {@link GeneratorsProvider}
 * @see [Generators](/videx-3d/docs/documents/generators.html)
 *
 * @group Contexts
 */
export const GeneratorsContext = createContext<GeneratorContextProps | null>(
  null,
);
