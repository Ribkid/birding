// The live outing: the outing in the `activeOuting` kv entry while it has no endedAt (v1 activeOuting()). Read from
// the shared store (lib/store.ts), so it follows Finish, Discard and a new outing as soon as they are stored.
import { onStoreChange, storeState, useStore, type StoreState } from './store';

type Live = Pick<StoreState, 'activeOuting' | 'outings'>;

/** The running outing's id, or null when there is none or it has ended. */
export function liveOutingId(s: Live): number | null {
  if (s.activeOuting == null) return null;
  const o = s.outings.find((x) => x.id === s.activeOuting);
  return o && !o.endedAt ? o.id : null;
}

const pickLive = (s: StoreState) => liveOutingId(s) != null;

/** True while an outing is running. */
export function useLiveOuting(): boolean {
  return useStore(pickLive);
}

/** True while an outing is running, for code outside React. */
export const isOutingLive = () => pickLive(storeState());

/** Resolves once no outing is running (at once when none is). */
export function whenOutingEnds(): Promise<void> {
  if (!isOutingLive()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = onStoreChange(() => {
      if (isOutingLive()) return;
      off();
      resolve();
    });
  });
}
