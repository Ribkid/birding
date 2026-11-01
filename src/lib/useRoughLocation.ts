import { useCallback, useState } from 'react';
import { getLastPos, setLastPos, type Fix } from './lastPos';
import { getPosition } from '../screens/lists/shared';

export interface RoughLocation {
  pos: Fix | null;
  asking: boolean;
  error: string | null;
  ask: () => void;
}

/** A last known fix, or a deliberate one-tap request. Cards decide when to ask; opening a screen never prompts. */
export function useRoughLocation(): RoughLocation {
  const [pos, setPos] = useState<Fix | null>(() => getLastPos());
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(() => {
    if (asking) return;
    setAsking(true);
    setError(null);
    getPosition()
      .then((found) => setPos(setLastPos(found)))
      .catch((why: unknown) => setError(why instanceof Error ? why.message : 'Could not get your location.'))
      .finally(() => setAsking(false));
  }, [asking]);

  return { pos, asking, error, ask };
}
