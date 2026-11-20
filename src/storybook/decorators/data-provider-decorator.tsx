import type { Remote } from 'comlink';
import { DataProvider } from '../../contexts/DataContextProvider';
import { Store } from '../../sdk/data/Store';
import { storyStore } from '../dependencies/story-store';

/* Run in main thread */

// import { MockStore } from '../dependencies/MockStore'
// const store = new MockStore()

/*
 * On a worker (`storyStore`), started as a story using it loads. What it holds is set
 * before each story renders, by `storyStoreLoader` (.storybook/preview.tsx), from the
 * story's `parameters.store`.
 */
const store: Remote<Store> = storyStore();

export const DataProviderDecorator = (Story: any) => (
  <DataProvider store={store}>
    <Story />
  </DataProvider>
);
