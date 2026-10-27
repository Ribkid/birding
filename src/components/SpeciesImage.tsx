import { sized } from '../core/media.js';
import { dexCode, RARITY, type Species } from '../lib/data';
import { useMedia } from '../lib/hooks';

interface Props {
  sp: Species;
  size?: 'small' | 'large';
  className?: string;
  /** Show the whole photo (letterboxed over a blurred copy) instead of cropping. */
  whole?: boolean;
}

/** The dex photo for a species, with the same fallbacks the v1 app used. */
export function SpeciesImage({ sp, size = 'small', className, whole = false }: Props) {
  useMedia();
  const url = sized(sp.id, size) as string | null;
  if (!url) return <span className={`${className ?? ''} img-missing`} role="img" aria-label={sp.name} />;
  if (whole) {
    return (
      <span className={`whole ${className ?? ''}`}>
        <img className="whole-bg" src={url} alt="" aria-hidden="true" decoding="async" />
        <img className="whole-fg" src={url} alt={sp.name} decoding="async" />
      </span>
    );
  }
  return (
    <img
      className={className}
      src={url}
      alt={sp.name}
      loading="lazy"
      decoding="async"
      onError={(e) => e.currentTarget.classList.add('img-missing')}
    />
  );
}

/** The green-ringed dex number badge shown on tiles and rows. */
export function Band({ sp, seen }: { sp: Species; seen: boolean }) {
  return (
    <span
      className={`band band--${sp.kind} ${seen ? 'band--on' : ''}`}
      aria-label={`Dex number ${dexCode(sp.id)}`}
    >
      {dexCode(sp.id)}
    </span>
  );
}

/** Five-dot rarity pips. */
export function Pips({ rarity }: { rarity: number }) {
  return (
    <span className={`pips pips--${rarity}`} title={RARITY[rarity]?.label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= rarity ? 'on' : ''} />
      ))}
    </span>
  );
}
