import { createContext } from 'react';
import { Store } from '../sdk';

/**
 * DataContext props
 * @expand
 */
export type DataContextProps = {
  // indicates if the store is a direct instance or remote (proxy)
  isRemote: boolean;
  // connect directly to a non-remote store
  connect: () => Store | null;
  // connect to a remote store by opening a `MessagePort`
  connectByMessagePort: () => Promise<MessagePort>;
};

/**
 * Data context
 * @group Contexts
 */
export const DataContext = createContext<DataContextProps | null>(null);
