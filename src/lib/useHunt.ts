import { useMemo } from 'react';
import { roughLatLng, type EbirdObservation, type EbirdSnapshot } from './ebird';
import { cutHunt, huntFromSnapshot, type HuntResult } from './hunt';
import { useEbirdSnapshot, useLiveEbird } from './useEbird';
import { useSeen } from './hooks';
import type { Fix } from './lastPos';

export interface HuntFeed {
  snapshot: EbirdSnapshot | null | undefined;
  observations: EbirdObservation[] | null;
  loading: boolean;
  online: boolean;
}

/** Shared read of the 25 km / seven-day feed. The function's response is cached for the visit by useLiveEbird. */
export function useHunt(pos: Fix | { lat: number; lng: number } | null): HuntFeed {
  const snapshot = useEbirdSnapshot();
  const point = useMemo(() => roughLatLng(pos), [pos?.lat, pos?.lng]);
  const live = useLiveEbird<EbirdObservation[]>({
    near: '',
    lat: point?.lat ?? 0,
    lng: point?.lng ?? 0,
    dist: 25,
    back: 7,
  }, !!point);

  return {
    snapshot,
    observations: live.data,
    loading: snapshot === undefined || live.loading,
    online: live.online,
  };
}

export interface HuntRows extends HuntFeed, HuntResult {
  source: 'live' | 'snapshot' | 'none';
}

/** The hunt list, already cut down and ranked. Live data wins; the baked snapshot keeps it useful offline. */
export function useHuntRows(pos: Fix | { lat: number; lng: number } | null): HuntRows {
  const feed = useHunt(pos);
  const seen = useSeen();
  const point = useMemo(() => roughLatLng(pos), [pos?.lat, pos?.lng]);
  const result = useMemo(() => {
    if (!feed.snapshot || !point) {
      return { rows: [], locations: new Set<string>(), source: 'none' as const };
    }
    if (feed.observations) {
      return { ...cutHunt(feed.observations, feed.snapshot, seen), source: 'live' as const };
    }
    return { ...huntFromSnapshot(feed.snapshot, point, seen), source: 'snapshot' as const };
  }, [feed.snapshot, feed.observations, seen, point?.lat, point?.lng]);

  return { ...feed, ...result };
}
