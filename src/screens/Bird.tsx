// The species page, ported from v1's renderBird (birding-refresh js/app.js) with spotSection, confuseSection,
// whereSection and infoSection. The hero photo runs under the status bar with the name set on a scrim tinted from
// the photo (src/lib/look.ts), with the Photos / 3D model / Card switch and the back and search buttons floating
// over it; the content is a sheet that slides up over its foot; a slim Log bar rises once the main Log button has
// scrolled away. species.css styles it all under .bird.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { GROUPS, HABITATS, KINDS, RARITY, SPECIES, byId, dexCode, type Species } from '../lib/data';
import { mediaSettled, useMedia, useSightings } from '../lib/hooks';
import { useSeqReady } from '../lib/seq';
import { lookAfterDraw } from '../lib/look';
import { heroShown, type Drawn } from './heroShown';
import { galleryFor, infoFor, loadExtras } from '../core/gallery.js';
import { details, loadCallPack, photoFor, sized } from '../core/media.js';
import { callWords, loadLookalikes, lookalikesOf, peaksOf, sentences, tellFor } from '../core/quiz.js';
import { cap, sizeFact } from './speciesFacts';
import { monthRates, recordCount, spotsFor } from '../core/seqdata.js';
import { MONTHS } from '../core/stats.js';
import { learnReady, masteryOf } from '../core/learn.js';
import { topLayer } from '../lib/layers';
import { Icon } from '../components/Icon';
import { MinePhoto } from '../components/MinePhoto';
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer';
import { Band, Pips, SpeciesImage } from '../components/SpeciesImage';
import { CallsSection, PauseIcon, PlayIcon, hasCalls, useCallPlayer } from './BirdCalls';
import { CardOverlay, askMotion, shareCard, type CardInfo } from './BirdCard';
import { openSearch } from './DexSearch';
import { openSightingSheet } from '../components/SightingSheet';
import { toast } from '../lib/toast';
import type { SightingRow } from './lists/shared';
import './species.css';

// ---------- small pieces, as in v1 ----------
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmtDate = (d?: string | null) => {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return MONTHS[m - 1] ? `${day} ${String(MONTHS[m - 1]).slice(0, 3)} ${y}` : d;
};
const dexNo = (id: number) => dexCode(id);
const article = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
// Non-bird tiers rank each kind against itself, so the line says so.
const rarityText = (sp: Species) => (sp.kind === 'bird' ? `${RARITY[sp.rarity].label} in SEQ`
  : `${RARITY[sp.rarity].label} for ${article(KINDS[sp.kind].one)} ${KINDS[sp.kind].one} in SEQ`);
function seasonText(sp: Species) {
  if (sp.kind === 'plant') return sp.season === 's' ? 'Mostly spring to summer' : sp.season === 'w' ? 'Mostly autumn to winter' : 'Year round';
  return sp.season === 's' ? (sp.kind === 'bird' ? 'Mostly September to April' : 'Most active September to April') : sp.season === 'w' ? 'Mostly April to September' : 'All year';
}
// Look-alikes when there's no curated pair: the same kind, nearest in real size, from its own group unless that group
// has fewer than two others (the Koala is alone in its group), then from the whole kind.
function similarSpecies(sp: Species, n = 4) {
  const kin = SPECIES.filter((s) => s.id !== sp.id && s.kind === sp.kind);
  const group = kin.filter((s) => s.group === sp.group);
  const gap = (s: Species) => (s.sizeCm && sp.sizeCm ? Math.abs(Math.log(s.sizeCm / sp.sizeCm)) : 1);
  return (group.length >= 2 ? group : kin).map((s) => ({ s, d: gap(s) })).sort((a, b) => a.d - b.d).slice(0, n).map((x) => x.s);
}

interface Photo { src: string; small?: string; wiki?: boolean; credit?: string; license?: string; page?: string }
interface Details { url?: string; extract?: string; credit?: { artist: string; license: string; page: string } | null }
interface Info { text: string; status: string; sources: { title?: string; url: string }[] }

// Photos for the species page: the Wikipedia picture first, then the gallery (data/gallery.json). The species'
// cover photo (the one its dex tile shows) carries its tile-sized copy, which the hero draws underneath while the
// large one loads; the other gallery photos load as one layer, so the page asks for no address it didn't before.
function heroPhotos(sp: Species, det: Details | null): Photo[] {
  const out: Photo[] = [];
  const wiki = photoFor(sp.id) as { url: string } | null;
  const small = (sized(sp.id, 'small') as string | null) || undefined;
  if (wiki) {
    const c = det?.credit;
    out.push({ src: sized(sp.id, 'large') as string, small, wiki: true, credit: c?.artist || '', license: c?.license || '', page: c?.page || wiki.url });
  }
  for (const g of galleryFor(sp.id) as Photo[]) {
    if (out.some((o) => o.src === g.src)) continue;
    out.push({ ...g, small: !wiki && !out.length && g.src === sized(sp.id, 'large') ? small : undefined });
  }
  return out.slice(0, 7);
}
// One small line under the photo: the author (linked to the source) and the licence.
const author = (a?: string) => String(a || '').replace(/\s*\(?\bhttps?:\/\/[^\s)]*\)?/g, '').trim().slice(0, 60) || 'Unknown';
function Credit({ ph }: { ph: Photo }) {
  return <>Photo: {ph.page ? <a href={ph.page} target="_blank" rel="noopener">{author(ph.credit)}</a> : author(ph.credit)}{ph.license ? `, ${ph.license}` : ''}</>;
}
const creditText = (ph: Photo) => `Photo: ${author(ph.credit)}${ph.license ? `, ${ph.license}` : ''}`;
// The hero's photos as the full-screen viewer shows them: the same addresses, with their credit.
const forViewer = (photos: Photo[]): ViewerPhoto[] => photos.map((ph) => ({
  src: ph.src, small: ph.small, credit: ph.credit ? <Credit ph={ph} /> : null, creditText: ph.credit ? creditText(ph) : '',
}));
const sourceLabel = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

const ShareIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const LearnIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V9A1.5 1.5 0 0 1 7 7.5zM8.5 4.5h10A1.5 1.5 0 0 1 20 6v10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const TickIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;

export default function Bird() {
  const { id } = useParams();
  const sp = byId.get(Number(id));
  if (!sp) return <Navigate to="/dex" replace />;
  // A fresh page per species, so the player, gallery and Log bar start over when prev/next moves on.
  return <SpeciesPage key={sp.id} sp={sp} />;
}

function SpeciesPage({ sp }: { sp: Species }) {
  useMedia();
  useSeqReady();
  const [, setTick] = useState(0);
  const sightings = useSightings() as SightingRow[];
  const [det, setDet] = useState<Details | null>(null);
  const [carding, setCarding] = useState(false);
  const [hero, setHero] = useState<'photo' | 'model'>('photo');
  const [modelMsg, setModelMsg] = useState<{ cls: string; text: string } | null>(null);
  const [slide, setSlide] = useState(0);
  const [awake, setAwake] = useState<ReadonlySet<string>>(() => new Set());
  const [barOn, setBarOn] = useState(false);
  const [grown, setGrown] = useState(false);
  // The photo open full screen, by its address (so a gallery drawn again keeps it), or none.
  const [viewing, setViewing] = useState<string | null>(null);
  const galRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLButtonElement>(null);
  const growRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLHeadingElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const model = useRef<{ alive: boolean; mounting: boolean; dispose: (() => void) | null }>({ alive: true, mounting: false, dispose: null });
  const player = useCallPlayer(sp, toast);

  const hist = useMemo(
    () => sightings.filter((s) => s.speciesId === sp.id)
      .sort((a, b) => `${b.date}${b.time ?? ''}`.localeCompare(`${a.date}${a.time ?? ''}`)),
    [sightings, sp.id],
  );
  const first = hist[hist.length - 1];
  const seen = hist.length > 0;
  const isBird = sp.kind === 'bird';
  const cardInfo: CardInfo = { seen, firstSeen: fmtDate(first?.date), place: first?.place, count: hist.length };

  // Deleting a sighting takes its row (or photo) away after the sheet has given focus back to it. As v1's redraw does,
  // focus then goes to the name rather than being dropped on the page.
  const histCount = useRef(hist.length);
  useEffect(() => {
    const fewer = hist.length < histCount.current;
    histCount.current = hist.length;
    if (!fewer || topLayer()) return;
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected) return;
    const h = nameRef.current;
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }, [hist.length]);

  // 3D model: three.js arrives on demand. If she has left before it lands, nothing is mounted. Switching back to the
  // photos keeps the model (its frame loop rests while it is hidden).
  useEffect(() => {
    const m = model.current;
    m.alive = true;
    return () => { m.alive = false; m.dispose?.(); m.dispose = null; };
  }, []);
  useEffect(() => {
    const m = model.current, box = modelRef.current;
    if (hero !== 'model' || !box || m.dispose || m.mounting) return;
    m.mounting = true;
    setModelMsg({ cls: 'model-loading', text: 'Building the model…' });
    void (async () => {
      let mod: { mountBird: (el: HTMLElement, s: Species) => () => void } | null = null;
      try { mod = await import('./birdModel3d.js'); } catch { /* offline the first time */ }
      m.mounting = false;
      if (!m.alive || !box.isConnected) return;
      if (!mod) { setModelMsg({ cls: 'model-loading', text: '3D needs signal the first time.' }); return; }
      try { setModelMsg({ cls: 'model-hint', text: 'Drag to turn' }); m.dispose = mod.mountBird(box, sp); }
      catch { setModelMsg({ cls: 'model-loading', text: '3D needs a newer browser.' }); }
    })();
  }, [hero, sp]);

  // Learn progress, the curated look-alikes, the gallery/write-ups and the call pack load at start-up; fill them in
  // if they arrive after the page.
  useEffect(() => {
    let alive = true;
    const again = () => { if (alive) setTick((n) => n + 1); };
    for (const p of [loadExtras(), loadLookalikes(), learnReady(), loadCallPack()]) void Promise.resolve(p).then(again, () => {});
    // Wikipedia text and photo credit
    void Promise.resolve(details(sp)).then((d: Details | null) => { if (alive) setDet(d); }).catch(() => {});
    return () => { alive = false; };
  }, [sp]);

  // Once the Log button has scrolled away, a slim bar with the name and a Log button rises above the tab bar.
  useEffect(() => {
    const el = logRef.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setBarOn(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const months = monthRates(sp.id) as { rel: number[] } | null;
  const hasMonths = !!months;
  // Season bars grow up the first time they come into view.
  useEffect(() => {
    const el = growRef.current;
    if (!el || grown) return;
    if (!('IntersectionObserver' in window)) { setGrown(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setGrown(true); io.disconnect(); } }, { rootMargin: '0px 0px -12% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMonths, grown]);

  // The photos known when the page is drawn, drawn again when gallery.json arrives (heroShown.ts). Drawn again, the
  // gallery stays on the first photo rather than following the old first one along (scroll snap would keep that in
  // view); once she has touched it, it is kept as it is.
  const touched = useRef(false);
  const kept = useRef<Drawn<Photo> | null>(null);
  // Saving, editing or deleting a sighting drew the whole page again in v1 (render() after the sheet closed), so the
  // hero takes the photos known now and its gallery starts again from the first one.
  const drawnRows = useRef(sightings);
  if (drawnRows.current !== sightings) {
    drawnRows.current = sightings;
    kept.current = null;
    touched.current = false;
  }
  kept.current = heroShown(kept.current, heroPhotos(sp, det), touched.current);
  const photos = kept.current.photos;
  const n = photos.length;
  // The tint comes from the first photo. If that changes after the page is drawn (gallery.json arriving, or a photo
  // for a hero that had none), take it again.
  const heroSrc = photos[0]?.src || '';
  const firstSrc = useRef(heroSrc);
  useEffect(() => {
    if (heroSrc === firstSrc.current) return;
    firstSrc.current = heroSrc;
    const raf = requestAnimationFrame(() => lookAfterDraw(document.getElementById('view')));
    return () => cancelAnimationFrame(raf);
  }, [heroSrc]);

  // Only the first photo loads with the page. The next loads when she starts to swipe, and each one after that as
  // she reaches the one before it. Slides are remembered by photo, so a photo arriving late doesn't unload them.
  const isAwake = (i: number) => i === 0 || awake.has(photos[i].src);
  const wake = (...idx: number[]) => setAwake((prev) => {
    const add = idx.map((i) => photos[i]?.src).filter((src) => src && !prev.has(src));
    return add.length ? new Set([...prev, ...add]) : prev;
  });
  const touch = () => { touched.current = true; wake(1); };
  const listKey = photos.map((p) => p.src).join('|');
  useLayoutEffect(() => {
    const g = galRef.current;
    if (!g || touched.current) return;
    if (g.scrollLeft) g.scrollLeft = 0;
    setSlide(0);
  }, [listKey, sightings]);
  const onGalleryScroll = () => {
    const g = galRef.current;
    if (!g) return;
    if (!touched.current) { if (g.scrollLeft) g.scrollLeft = 0; return; }
    const i = Math.round(g.scrollLeft / Math.max(1, g.clientWidth));
    wake(i, i + 1);
    if (i !== slide) setSlide(i);
  };
  // Tapping a photo (or Enter on the gallery) opens it full screen. The gallery follows the photo she moves to in
  // the viewer, so closing it shrinks the photo back into its own slide.
  const viewIndex = viewing ? photos.findIndex((p) => p.src === viewing) : -1;
  const openPhoto = (i: number) => { if (hero === 'photo' && photos[i]) setViewing(photos[i].src); };
  const slideAt = (i: number) => {
    const g = galRef.current;
    const el = g?.children[i] as HTMLElement | undefined;
    if (!g || !el) return null;
    const left = i * g.clientWidth;
    if (Math.abs(g.scrollLeft - left) > 1) {
      touched.current = true;
      wake(i);
      g.scrollTo({ left, behavior: 'instant' });
    }
    return el;
  };
  const onGalleryClick = (e: MouseEvent<HTMLDivElement>) => {
    const g = galRef.current, fig = (e.target as Element).closest('.slide');
    if (!g || !fig || !n) return;
    openPhoto([...g.children].indexOf(fig));
  };
  const onGalleryKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const g = galRef.current;
    if (g && n && (e.key === 'Enter' || e.key === ' ') && e.target === g) {
      e.preventDefault();
      openPhoto(slide);
      return;
    }
    if (!g || n < 2 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    e.preventDefault();
    touched.current = true;
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    g.scrollBy({ left: e.key === 'ArrowRight' ? g.clientWidth : -g.clientWidth, behavior });
  };

  const info = infoFor(sp.id) as Info | null;
  const mastery = masteryOf(sp.id) as number;
  const snaps = hist.filter((h) => h.photoId);
  const kindWord = KINDS[sp.kind].label.toLowerCase();
  const prev = [...SPECIES].reverse().find((s) => s.kind === sp.kind && s.id < sp.id);
  const next = SPECIES.find((s) => s.kind === sp.kind && s.id > sp.id);

  // How to spot it: the field notes as short marks, the call words, size, when, group, habitats and a quick test.
  const cw = callWords(sp) as { words: string; sentence: string } | null;
  const marks = (sentences(sp.notes) as string[]).filter((s) => !/^introduced[.;]?$/i.test(s) && s !== cw?.sentence).slice(0, 4);
  const size = sizeFact(sp), peaks = peaksOf(sp.id) as string;
  const when: [string, string] = sp.kind === 'plant' && sp.season ? ['Flowers', seasonText(sp)]
    : ['When', !peaks ? seasonText(sp) : /every month|most of the year/.test(peaks) ? 'Reported all year' : `Peaks in ${peaks}`];
  const playable = !!cw && hasCalls(sp.id);
  const callLine = (() => {
    if (!cw) return null;
    const token = `"${cw.words}"`, at = cw.sentence.indexOf(token);
    return at < 0 ? cw.sentence : <>{cw.sentence.slice(0, at)}<q>{cw.words}</q>{cw.sentence.slice(at + token.length)}</>;
  })();
  const firstOn = player.playing === 0 && !player.paused;

  // Easy to confuse with: the curated look-alikes first (with how to tell them apart), then the nearest in size.
  const curated = (lookalikesOf(sp.id) as number[]).map((x) => byId.get(x)).filter(Boolean) as Species[];
  const confuse = [...curated.map((s) => ({ s, tell: tellFor(sp.id, s.id) as string | null })),
    ...similarSpecies(sp, 4).filter((s) => !curated.includes(s)).map((s) => ({ s, tell: null }))].slice(0, Math.max(4, curated.length));

  const now = new Date().getMonth();
  const spots = months ? (spotsFor(sp.id, 6) as { h: { name: string }; c: number; near?: boolean }[]) : [];
  const near = spots[0]?.near;

  return (
    <article className={`bird kind--${sp.kind}`}>
      <div className={`bird-hero${hero === 'model' ? ' bird-hero--model' : ''}`} data-hero-box="">
        <div className={`hero-photo${hero === 'photo' ? '' : ' hidden'}`}>
          <div
            className="gallery"
            data-gallery=""
            ref={galRef}
            tabIndex={0}
            role="group"
            aria-label={`Photos of the ${sp.name}${n > 1 ? '. Swipe for more.' : ''}${n ? ' Open a photo to see it whole.' : ''}`}
            onScroll={n > 1 ? onGalleryScroll : undefined}
            onKeyDown={n ? onGalleryKey : undefined}
            onClick={n ? onGalleryClick : undefined}
            onPointerDown={n > 1 ? touch : undefined}
            onTouchStart={n > 1 ? touch : undefined}
            onWheel={n > 1 ? touch : undefined}
            onFocus={n > 1 ? () => wake(1) : undefined}
          >
            {n ? photos.map((ph, i) => (
              // The slide on show is the hero's frame: the photo a tile grows into, and the one that shrinks back
              // into the tile on Back (after the viewer, that can be a later photo).
              <figure className="slide" key={ph.src} data-hero-frame={i === slide ? '' : undefined}>
                <SpeciesImage
                  sp={sp}
                  hero={isAwake(i) ? { src: ph.src, small: ph.small } : {}}
                  alt={`${sp.name}${n > 1 ? `, photo ${i + 1} of ${n}` : ''}`}
                  className="bird-photo"
                  eager={i === 0}
                />
              </figure>
            )) : !mediaSettled() ? (
              // The saved photo index or gallery.json isn't read yet: the photo is on its way, so the frame waits as
              // a loading photo does (over the plumage wash), rather than showing the no-photo block first.
              <figure className="slide" data-hero-frame=""><SpeciesImage sp={sp} hero={{}} alt={sp.name} className="bird-photo" eager /></figure>
            ) : (
              <figure className="slide" data-hero-frame=""><span className="bird-photo img-missing" role="img" aria-label={sp.name} /></figure>
            )}
          </div>
        </div>
        <div className={`hero-model${hero === 'model' ? '' : ' hidden'}`} data-model="" ref={modelRef} role="group" aria-label={`3D model of a ${sp.name}. Drag to turn it.`}>
          {modelMsg && <p className={modelMsg.cls}>{modelMsg.text}</p>}
        </div>
        <div className="hero-scrim" aria-hidden="true" />
        <div className="hero-cap">
          <div className="hero-meta">
            <Band sp={sp} seen={seen} />
            {sp.kind !== 'bird' && <span className={`kindtag kind--${sp.kind}`}>{KINDS[sp.kind].one}</span>}
            {n > 1 && <span className={`hero-count${hero === 'photo' ? '' : ' hidden'}`} data-count="" aria-hidden="true"><b data-count-i="">{slide + 1}</b>/{n}</span>}
          </div>
          <h1 className="bird-name" ref={nameRef}>{sp.name}</h1>
          <p className="sci">{sp.sci}</p>
          <p className={`hero-credit${hero === 'photo' ? '' : ' hidden'}`} data-credit="">{photos[slide]?.credit ? <Credit ph={photos[slide]} /> : null}</p>
        </div>
        <Link className="iconbtn iconbtn--float" to="/dex" aria-label="Back to the dex"><Icon name="back" /></Link>
        <button type="button" className="iconbtn iconbtn--float iconbtn--right" data-search="" aria-label="Search everything" onClick={() => openSearch()}><Icon name="search" /></button>
        <div className="hero-tabs" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={hero === 'photo'} data-hero="photo" onClick={() => setHero('photo')}>{n > 1 ? 'Photos' : 'Photo'}</button>
          {isBird && <button type="button" role="tab" aria-selected={hero === 'model'} data-hero="model" onClick={() => setHero('model')}>3D model</button>}
          <button type="button" role="tab" aria-selected="false" data-hero="card" onClick={() => { askMotion(); setCarding(true); }}>Card</button>
        </div>
      </div>

      <div className="bird-body">
        <div className="bird-sum">
          <span className="rarity-line"><Pips rarity={sp.rarity} /><span>{rarityText(sp)}</span></span>
          <span data-mastery="">{mastery >= 1
            ? <span className="mastery mastery--done"><TickIcon />Learnt</span>
            : mastery > 0 ? <span className="mastery"><i style={{ '--p': Math.round(mastery * 100) } as CSSProperties} aria-hidden="true" />Learning</span> : null}</span>
        </div>
        <div className="bird-actions">
          <button type="button" className="btn btn--primary btn--grow" ref={logRef} data-log="" onClick={() => openSightingSheet({ speciesId: sp.id })}>{seen ? 'Log another sighting' : 'Log a sighting'}</button>
          {seen && <button type="button" className="btn btn--share" data-sharecard="" aria-label="Share card" onClick={() => void shareCard(sp, cardInfo)}><ShareIcon /></button>}
        </div>
        {seen && <p className="seen-line">Seen {plural(hist.length, 'time')}. First on {fmtDate(first.date)}{first.place ? ` at ${first.place}` : ''}.</p>}

        <section className="spot" aria-labelledby="spot-h">
          <h2 className="h2" id="spot-h">How to spot it</h2>
          {marks.length > 0 && <ul className="spot-marks">{marks.map((s, i) => <li key={i}>{s}</li>)}</ul>}
          {cw && (
            <div className="spot-call">
              {playable
                ? <button type="button" className="playbtn spot-play" aria-label={firstOn ? 'Pause its call' : 'Play its call'} onClick={player.playFirst}>{firstOn ? <PauseIcon /> : <PlayIcon />}</button>
                : <span className="spot-call-ic" aria-hidden="true"><Icon name="mic" /></span>}
              <p>{callLine}</p>
            </div>
          )}
          <dl className="facts">
            {size && <div><dt>{size[0]}</dt><dd>{size[1]}</dd></div>}
            <div><dt>{when[0]}</dt><dd>{when[1]}</dd></div>
            <div><dt>Group</dt><dd><Link to="/dex" state={{ dexFilter: { kind: sp.kind === 'plant' ? 'plant' : 'animals', q: '', show: 'all', group: sp.group, habitat: '', rarity: '', season: false, sort: 'dex' } }}>{GROUPS[sp.group]}</Link></dd></div>
          </dl>
          <ul className="spot-hab" aria-label="Where to look">
            {sp.habitats.map((h) => <li key={h}>{HABITATS[h]}</li>)}
            {sp.nocturnal && <li className="spot-hab--night">Active at night</li>}
          </ul>
          <Link className="btn spot-test" to={`/learn/test/${sp.id}`}><LearnIcon /><span>Test me on this</span></Link>
        </section>

        <div data-confuse="" data-curated={curated.length ? '' : undefined}>
          {confuse.length > 0 && (
            <section className="confuse" aria-labelledby="confuse-h">
              <h2 className="h2" id="confuse-h">Easy to confuse with</h2>
              <p className="small muted">Easy to mix up. Tap Compare to see them side by side.</p>
              <ul className="lk-rail">
                {confuse.map(({ s, tell }) => (
                  <li className={`lk-card kind--${s.kind}`} key={s.id}>
                    <Link className="lk-sp" to={`/bird/${s.id}`}>
                      <span className="lk-photo cmp-img"><SpeciesImage sp={s} alt="" /></span>
                      <strong className="lk-name">{s.name}</strong>
                    </Link>
                    <p className={`lk-tell${tell ? '' : ' muted'}`}>{tell || cap(s.sizeText || '')}</p>
                    <Link className="btn btn--small lk-cmp" to={`/compare/${sp.id}/${s.id}`} aria-label={`Compare with the ${s.name}`}>Compare</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {months && (
          <section className="where" aria-labelledby="where-h">
            <h2 className="h2" id="where-h">When and where</h2>
            <h3 className="h3">When it's reported</h3>
            <div className={`season${grown ? ' is-in' : ''}`} data-grow="" ref={growRef} role="img" aria-label={`Reporting rate by month, highest in ${MONTHS[months.rel.indexOf(1)]}`}>
              {months.rel.map((v, i) => <i key={i} className={i === now ? 'now' : ''} style={{ height: `${Math.max(3, Math.round(v * 100))}%`, '--i': i } as CSSProperties} />)}
            </div>
            <div className="season-labels" aria-hidden="true">
              {[...'JFMAMJJASOND'].map((c, i) => <span key={i} className={i === now ? 'now' : undefined}>{c}</span>)}
            </div>
            <p className="small muted">How often it's reported in SEQ each month, from {(recordCount(sp.id) as number).toLocaleString('en-AU')} records since 2016 in the Atlas of Living Australia.</p>
            {spots.length > 0 && (
              <>
                <h3 className="h3">{near ? 'Places near its records' : 'Best places in SEQ'}</h3>
                <ul className="spots">{spots.map(({ h, c }) => <li key={h.name}><span>{h.name}</span><span className="num">{c.toLocaleString('en-AU')}</span></li>)}</ul>
                <p className="small muted">{near ? 'Named places within 3 km of where it has been recorded, with the number of records around each.' : 'Number of records at each spot.'}</p>
              </>
            )}
            <Link className="btn" to={`/map/sp/${sp.id}`}><Icon name="pin" /> Show where it's reported</Link>
          </section>
        )}

        <CallsSection p={player} />

        <section className="wiki" data-wiki="">
          {info ? (
            <>
              <h2 className="h2">About</h2>
              <p>{info.text}</p>
              {info.status && <p className="status"><strong>Conservation status:</strong> {info.status}</p>}
              {info.sources.length > 0 && (
                <p className="small sources"><span className="muted">Sources:</span>{' '}
                  {info.sources.map((src, i) => <span key={src.url}>{i ? '; ' : ''}<a href={src.url} target="_blank" rel="noopener">{src.title || sourceLabel(src.url)}</a></span>)}
                </p>
              )}
            </>
          ) : det?.extract ? (
            <>
              <h2 className="h2">About</h2>
              <p>{det.extract}</p>
              <p className="small muted">From <a href={det.url} target="_blank" rel="noopener">Wikipedia</a>, CC BY-SA 4.0.</p>
            </>
          ) : null}
        </section>

        <section className="mine" aria-labelledby="mine-h">
          <h2 className="h2" id="mine-h">Your sightings</h2>
          {snaps.length > 0 && (
            <ul className="mine-strip">
              {snaps.map((h) => (
                <li key={h.id}>
                  <button type="button" className="mine-ph" data-edit={h.id} aria-label={`Your photo from ${fmtDate(h.date)}`} onClick={() => openSightingSheet({ sighting: h })}>
                    <MinePhoto photoId={h.photoId as number} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {seen ? (
            <ul className="hist">
              {hist.map((h) => (
                <li key={h.id}>
                  <button type="button" className="hist-row" data-edit={h.id} onClick={() => openSightingSheet({ sighting: h })}>
                    <span className="hist-main"><strong>{fmtDate(h.date)}</strong>{h.time ? <> <span className="muted">{h.time}</span></> : null}<br /><span className="muted">{h.place || 'No place name'}</span></span>
                    {' '}<span className="hist-n">{h.count ? `×${h.count}` : 'X'}{h.heard ? <><br /><span className="muted small">heard</span></> : null}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted mine-empty">Not seen yet. When you find {sp.kind === 'plant' ? 'it' : 'one'}, log it here and its card fills in with colour.</p>
          )}
        </section>

        <nav className="more-links">
          {isBird && <a href={`https://xeno-canto.org/species/${sp.sci.replace(' ', '-')}`} target="_blank" rel="noopener">More calls on xeno-canto</a>}
          <a href={`https://bie.ala.org.au/search?q=${encodeURIComponent(sp.sci)}`} target="_blank" rel="noopener">Atlas of Living Australia</a>
        </nav>
        {(prev || next) && (
          <nav className="prevnext" aria-label={`More ${kindWord}`}>
            {prev ? <PrevNext s={prev} dir="prev" /> : <span />}
            {next && <PrevNext s={next} dir="next" />}
          </nav>
        )}
      </div>

      <div className={`logbar${barOn ? ' logbar--on' : ''}`} data-logbar="" inert={!barOn}>
        <Band sp={sp} seen={seen} /><strong>{sp.name}</strong>{' '}
        <button type="button" className="btn btn--primary btn--small" data-log="" aria-label={`Log a sighting of the ${sp.name}`} onClick={() => openSightingSheet({ speciesId: sp.id })}>Log it</button>
      </div>

      {carding && <CardOverlay sp={sp} info={cardInfo} onClose={() => setCarding(false)} />}
      {viewIndex >= 0 && (
        <PhotoViewer
          photos={forViewer(photos)}
          index={viewIndex}
          name={sp.name}
          onIndex={(i) => { if (photos[i]) setViewing(photos[i].src); }}
          onClose={() => setViewing(null)}
          origin={slideAt}
          returnTo={galRef.current}
        />
      )}
    </article>
  );
}

// Prev/next: a photo chip for the neighbour in the dex, of the same kind.
function PrevNext({ s, dir }: { s: Species; dir: 'prev' | 'next' }) {
  return (
    <Link className={`pn pn--${dir} kind--${s.kind}`} to={`/bird/${s.id}`}>
      <Icon name="back" />
      <span className="pn-ph"><SpeciesImage sp={s} alt="" /></span>
      <span className="pn-txt"><span className="sr-only">{dir === 'prev' ? 'Previous' : 'Next'}: </span><span className="pn-no">{dexNo(s.id)}</span><strong>{s.name}</strong></span>
    </Link>
  );
}
