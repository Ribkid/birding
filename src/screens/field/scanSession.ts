// The last scan survives navigation for 30 minutes, as v1's module-level scan state did.
export const KEEP_MS = 30 * 60 * 1000;

export interface ScanPhoto { file: File; blob: Blob; url: string; W: number; H: number }
export interface ScanBox { cx: number; cy: number; s: number }

export interface ScanState {
  at: number;
  photo: ScanPhoto | null;
  box: ScanBox;
  whole: boolean;
  kind: string;
  result: unknown | null;
  logAt: number | null;
  yours: string;
}

const freshBox = (): ScanBox => ({ cx: 0.5, cy: 0.5, s: 0.75 });

export const S: ScanState = {
  at: 0,
  photo: null,
  box: freshBox(),
  whole: false,
  kind: '',
  result: null,
  logAt: null,
  yours: '',
};

/** Clear the scan, keeping the kind the person picked. */
export function resetScan() {
  if (S.photo?.url) URL.revokeObjectURL(S.photo.url);
  S.at = 0;
  S.photo = null;
  S.box = freshBox();
  S.whole = false;
  S.result = null;
  S.logAt = null;
  S.yours = '';
}
