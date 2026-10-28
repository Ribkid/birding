// Shared helper for the field-tools screens. Logging a sighting from them goes through the shared sighting sheet
// (components/SightingSheet), as v1's Listen and Scan did.

export function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}
