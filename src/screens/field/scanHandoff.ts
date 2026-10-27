// A scan result passed from the Scan screen to the Add-sighting form.
// A module store keeps the Blob out of history state, which browsers may serialise.
export interface PendingScan {
  blob: Blob;
  notes: string;
  autoGps: boolean;
}

let pending: PendingScan | null = null;

export function setPending(value: PendingScan) {
  pending = value;
}

export function takePending(): PendingScan | null {
  const value = pending;
  pending = null;
  return value;
}
