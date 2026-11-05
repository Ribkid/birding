import { useId } from 'react';
import { birdCount } from '../lib/regionPick';
import type { RegionPack } from '../lib/region';

/** One card per region to pick from. A radio group, so arrow keys move the choice and a screen reader says which is on. */
export function RegionCards({ packs, value, onChange, label }: { packs: RegionPack[]; value: string; onChange: (code: string) => void; label: string }) {
  const id = useId();
  return (
    <div className="region-cards" role="radiogroup" aria-label={label}>
      {packs.map((pack) => (
        <label key={pack.code} className={`region-card${pack.code === value ? ' region-card--on' : ''}`}>
          <input type="radio" name={`${id}-region`} value={pack.code} checked={pack.code === value} onChange={() => onChange(pack.code)} />
          <span className="region-card-name">{pack.name}</span>
          <span className="region-card-sub small muted">{birdCount(pack)} birds</span>
        </label>
      ))}
    </div>
  );
}
