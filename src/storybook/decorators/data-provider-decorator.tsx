import { DataProvider } from '../../contexts/DataContextProvider';

/* Run in main thread */

// import { MockStore } from '../dependencies/MockStore'
// const store = new MockStore()

/* Use worker */
import { Remote, wrap } from 'comlink';
import { Store } from '../../sdk/data/Store';

const worker = new Worker(
  new URL('workers/remote-mock-store.ts', import.meta.url),
  { type: 'module' },
);

const store: Remote<Store> = wrap(worker);

// ⚠️ A hot update RE-EXECUTES this module, so without this the previous worker
// stays alive for the life of the page — with the whole dataset still cached in
// it. A handful of edits then costs several hundred MB and a thread each.
import.meta.hot?.dispose(() => worker.terminate());

export const DataProviderDecorator = (Story: any) => (
  <DataProvider store={store}>
    <Story />
  </DataProvider>
);
