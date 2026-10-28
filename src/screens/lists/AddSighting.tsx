// #/add: the Log a sighting form as a page, for deep links and the Scan hand-off. Everywhere else the + sheet, the
// species page and the dex open the same form in a sheet over the current screen, as v1 did (SightingSheet.tsx).
import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { SightingForm } from '../../components/SightingSheet';
import { byId } from '../../lib/data';
import { toast } from '../../lib/toast';
import { takePending, type PendingScan } from '../field/scanHandoff';
import { announceSaved, useLogData } from './shared';
import './lists.css';

// The scan hand-off is taken once per visit to this page, even if React draws the page twice.
let claimed: { key: string; value: PendingScan | null } | null = null;
function claimScan(key: string, fromScan: boolean): PendingScan | null {
  if (claimed?.key === key) return claimed.value;
  claimed = { key, value: fromScan ? takePending() : null };
  return claimed.value;
}

export default function AddSighting() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const data = useLogData();
  const [scan] = useState(() => claimScan(location.key, !!(location.state as { scan?: boolean } | null)?.scan));
  const asked = Number(params.get('species'));
  const speciesId = asked && byId.has(asked) ? asked : null;
  const sp = speciesId != null ? byId.get(speciesId) : undefined;
  // Opened from inside the app (the Scan result, a link): back to where she was, as v1's sheet left her there.
  // Opened cold from a link: on to the species page, or the dex.
  const inApp = location.key !== 'default';
  const leave = (logged: number | null = speciesId) => {
    if (inApp) navigate(-1);
    else navigate(logged != null ? `/bird/${logged}` : '/dex', { replace: true });
  };
  const backLabel = scan ? 'Back to the scan result' : inApp ? 'Back' : sp ? `Back to the ${sp.name}` : 'Back to the dex';

  return (
    <>
      <header className="page-head page-head--back">
        <button type="button" className="iconbtn" aria-label={backLabel} onClick={() => leave()}>
          <Icon name="back" />
        </button>
        <h1>Log a sighting</h1>
      </header>
      {data && (
        <SightingForm
          className="pad log-page"
          data={data}
          speciesId={speciesId}
          autoGps={!!scan?.autoGps}
          photoBlob={scan?.blob ?? null}
          notes={scan?.notes ?? ''}
          onCancel={() => leave()}
          onSaved={(rec, outcome) => {
            leave(rec.speciesId ?? null);
            announceSaved(rec, outcome, { afterNav: true });
            if (!outcome.isNew) toast(`${byId.get(rec.speciesId as number)?.name ?? 'Sighting'} saved`);
          }}
        />
      )}
    </>
  );
}
