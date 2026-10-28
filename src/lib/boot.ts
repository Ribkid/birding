// Imported first by main.tsx, so her records start loading from IndexedDB, and the regional data from its file,
// before the rest of the app's modules are even evaluated; by the time React is ready to draw, they are usually in.
import { bootStore } from './store';
import { ensureSeq } from './seq';

export const storeBooted = bootStore();
ensureSeq();
