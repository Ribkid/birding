import { useEffect, useRef, useState } from 'react';
import { db } from '../core/db.js';

/**
 * Her own photo from a sighting, read from the photos store. As in v1 (hydratePhotos), it loads only as it comes
 * within 400px of the screen, so a long strip or log doesn't decode every full-size photo at once.
 */
export function MinePhoto({ photoId }: { photoId: number }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  const [url, setUrl] = useState('');
  useEffect(() => {
    const el = imgRef.current;
    if (near || !el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  useEffect(() => {
    if (!near) return;
    let alive = true, made = '';
    void Promise.resolve(db.get('photos', photoId)).then((rec: { blob?: Blob } | undefined) => {
      if (!alive || !rec?.blob) return;
      made = URL.createObjectURL(rec.blob);
      setUrl(made);
    }).catch(() => {});
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [near, photoId]);
  return <img ref={imgRef} src={url || undefined} alt="" loading="lazy" decoding="async" />;
}
