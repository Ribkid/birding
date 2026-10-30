import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchPublicOuting } from '../../core/outingPhotos.js';
import { Icon } from '../../components/Icon';
import { OutingPhotoGrid, type OutingPhoto } from '../../components/OutingPhotos';
import '../../components/outingPhotos.css';

interface PublicOutingData {
  publicId: string;
  outingUid: string;
  date?: string;
  place?: string;
  speciesCount: number;
  distanceKm?: number | null;
  durationMin?: number | null;
  photos: OutingPhoto[];
}

export default function PublicOuting() {
  const { publicId = '', outingUid = '' } = useParams();
  const [outing, setOuting] = useState<PublicOutingData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setOuting(null);
    if (!navigator.onLine) { setError('This public outing needs a connection. Your own outings still work offline.'); setLoading(false); return; }
    void fetchPublicOuting(publicId, outingUid).then((data: PublicOutingData) => {
      if (alive) { setOuting(data); setLoading(false); }
    }).catch(() => {
      if (alive) { setError('This outing is not available. It may have been removed, or the link may be wrong.'); setLoading(false); }
    });
    return () => { alive = false; };
  }, [publicId, outingUid]);

  return (
    <div className="op-public">
      <header className="page-head page-head--back">
        <Link className="iconbtn" to={`/u/${publicId}`} aria-label="Back to profile"><Icon name="back" /></Link>
        <div className="lists-head-text">
          <h1>{outing?.place || (loading ? 'Outing' : 'Outing unavailable')}</h1>
          {outing && <p className="muted small">{outing.date || ''}</p>}
        </div>
      </header>
      {loading && <p className="pad muted" role="status">Loading outing…</p>}
      {error && <p className="pad">{error}</p>}
      {outing && (
        <>
          <p className="op-public-facts">
            {outing.speciesCount} species
            {outing.distanceKm != null ? ` · ${outing.distanceKm} km` : ''}
            {outing.durationMin != null ? ` · ${outing.durationMin} min` : ''}
          </p>
          <section className="op-public-photos" aria-labelledby="op-public-photos-h">
            <h2 id="op-public-photos-h" className="sr-only">Outing photos</h2>
            <OutingPhotoGrid photos={outing.photos || []} />
          </section>
        </>
      )}
    </div>
  );
}
