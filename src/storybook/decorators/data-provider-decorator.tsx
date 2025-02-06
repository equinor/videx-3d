
import { DataProvider } from '../../contexts/DataContextProvider'

/* Run in main thread */

// import { MockStore } from '../dependencies/MockStore'
// const store = new MockStore()

/* Use worker */
import { Remote, wrap } from 'comlink'
import { Store } from '../../sdk/data/Store'

const store: Remote<Store> = wrap(new Worker(new URL('workers/remote-mock-store.ts', import.meta.url), { type: 'module'}))

export const DataProviderDecorator = (Story: any) => (
  <DataProvider store={store}>
    <Story />
  </DataProvider>
)
