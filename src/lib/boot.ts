// Imported first by main.tsx, so her records start loading from IndexedDB, and the regional data from its file,
// before the rest of the app's modules are even evaluated; by the time React is ready to draw, they are usually in.
// Her chosen theme is read alongside, so React's first frame has it too.
import { bootStore } from './store';
import { ensureSeq } from './seq';
import { applySavedTheme } from '../screens/progress/theme';

export const storeBooted = bootStore();
ensureSeq();
void applySavedTheme().catch(() => {});
