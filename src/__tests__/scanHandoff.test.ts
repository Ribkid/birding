import { describe, expect, it } from 'vitest';
import { setPending, takePending } from '../screens/field/scanHandoff';

describe('scan hand-off', () => {
  it('hands the blob over once', () => {
    const blob = new Blob(['photo'], { type: 'image/jpeg' });
    setPending({ blob, notes: 'Identified from a photo.', autoGps: true });
    expect(takePending()).toMatchObject({ blob, notes: 'Identified from a photo.', autoGps: true });
    expect(takePending()).toBeNull();
  });
});
