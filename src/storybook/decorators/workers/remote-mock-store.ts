import { expose } from 'comlink';
import { MockStore } from '../../dependencies/MockStore';

const store = new MockStore();

expose(store);
