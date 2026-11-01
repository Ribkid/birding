import { useEffect } from 'react';
import { Icon } from '../../components/Icon';
import { useHuntRows } from '../../lib/useHunt';
import { useRoughLocation } from '../../lib/useRoughLocation';
import './huntChip.css';

interface Props {
  active: boolean;
  onActive: (active: boolean) => void;
  onLocations: (locations: Set<string> | null) => void;
}

/** A Spots filter chip: the list narrows to places where an unseen nearby bird was reported. */
export default function HuntChip({ active, onActive, onLocations }: Props) {
  const rough = useRoughLocation();
  const hunt = useHuntRows(rough.pos);

  useEffect(() => {
    if (!active || !rough.pos || !hunt.snapshot || hunt.source === 'none') {
      onLocations(null);
      return;
    }
    onLocations(hunt.locations);
  }, [active, rough.pos, hunt.snapshot, hunt.source, hunt.locations, onLocations]);

  const toggle = () => {
    if (active) {
      onActive(false);
      onLocations(null);
      return;
    }
    onActive(true);
    if (!rough.pos) rough.ask();
  };

  const note = !active ? ''
    : !rough.pos ? (rough.asking ? 'Finding you…' : rough.error || 'Location is needed to find nearby birds.')
      : hunt.loading ? 'Finding nearby spots…'
        : hunt.source === 'snapshot' ? 'Using the saved snapshot.'
          : hunt.rows.length ? `${hunt.rows.length} unseen nearby ${hunt.rows.length === 1 ? 'bird' : 'birds'}.`
            : 'No unseen nearby birds this week.';

  return (
    <div className="hunt-chip-wrap">
      <button
        type="button"
        className={`chip hunt-chip${active ? ' chip--on' : ''}`}
        aria-pressed={active}
        aria-label="Hunt: spots with birds you have not seen near you this week"
        onClick={toggle}
      >
        <Icon name="pin" />
        Hunt
        {active && hunt.rows.length > 0 ? <span className="hunt-chip-n">{hunt.rows.length}</span> : null}
      </button>
      {note && <span className="hunt-chip-note" role="status">{note}</span>}
    </div>
  );
}
