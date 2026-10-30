import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Dex from './screens/Dex';
import Bird from './screens/Bird';
import MapScreen from './screens/map/MapScreen';
import Spots from './screens/spots/Spots';
import SpotDetail from './screens/spots/SpotDetail';
import Scan from './screens/field/Scan';
import Listen from './screens/field/Listen';
import Badges from './screens/progress/Badges';
import Compare from './screens/progress/Compare';
import Settings from './screens/progress/Settings';
import Leaderboard from './screens/progress/Leaderboard';
import Lists from './screens/lists/Lists';
import ListView from './screens/lists/ListView';
import Targets from './screens/lists/Targets';
import Outing from './screens/lists/Outing';
import Log from './screens/lists/Log';
import AddSighting from './screens/lists/AddSighting';
import Stats from './screens/lists/Stats';
import { RouteFocus } from './components/RouteFocus';
import Learn from './screens/learn/Learn';
import LearnPlay from './screens/learn/LearnPlay';
import Me from './screens/me/Me';
import { AccountSheets } from './screens/me/AccountSheets';
import PublicProfile from './screens/me/PublicProfile';
import PublicOuting from './screens/me/PublicOuting';
import { Placeholder } from './screens/Placeholder';
import { TabBar } from './components/TabBar';
import { ScreenBoundary } from './components/ErrorBoundary';
import { Welcome } from './components/Welcome';
import { OutingBar } from './components/OutingBar';
import { SearchHost } from './screens/DexSearch';
import { SightingSheetHost } from './components/SightingSheet';
import { preloadOnPress } from './components/SpeciesImage';
import { useSeqReady } from './lib/seq';
import { initLook, lookAfterDraw } from './lib/look';
import { syncTitle, watchTitle } from './lib/title';
import { initProfile } from './core/profile.js';
import { initAccount, onStatus, syncStatus } from './core/account.js';
import { startOutingPhotoSync } from './core/outingPhotos.js';
import { applySavedTheme } from './screens/progress/theme';
import { useState } from 'react';

/**
 * The frosted bar takes its title and back control from whatever the screen just drew. The page title follows the
 * screen's heading, including one that renders after the route change (lib/title.ts).
 */
function TopBar() {
  const location = useLocation();
  useEffect(() => {
    const view = document.getElementById('view');
    return view ? watchTitle(view) : undefined;
  }, []);
  useEffect(() => {
    initLook();
    const view = document.getElementById('view');
    const id = requestAnimationFrame(() => {
      lookAfterDraw(view);
      if (view) syncTitle(view, { force: true });
    });
    return () => cancelAnimationFrame(id);
  }, [location.pathname, location.search]);
  return null;
}

function SyncBanner() {
  const [state, setState] = useState(syncStatus());
  useEffect(() => { const off = onStatus((next: typeof state) => setState(next)); return () => { off(); }; }, []);
  if (state.state !== 'migrating') return null;
  return <div className="sync-banner" role="status" aria-live="polite">{state.text || 'Backing up…'}</div>;
}

export default function App() {
  // Regional data is fetched once; this re-renders the tree when it lands so screens
  // that depend on hotspots and reporting rates fill in.
  useSeqReady();
  useEffect(() => {
    void initProfile();
    void initAccount();
    startOutingPhotoSync();
    void applySavedTheme();
  }, []);
  useEffect(preloadOnPress, []); // pressing a species starts its large photo (components/SpeciesImage.tsx)
  return (
    <>
      <RouteFocus />
      <TopBar />
      <SyncBanner />
      <Welcome />
      <main id="view" tabIndex={-1}>
        <ScreenBoundary>
        <Routes>
          <Route path="/" element={<Navigate to="/dex" replace />} />
          <Route path="/dex" element={<Dex />} />
          <Route path="/bird/:id" element={<Bird />} />

          <Route path="/learn" element={<Learn />} />
          <Route path="/learn/play/:pack" element={<LearnPlay />} />
          <Route path="/learn/daily" element={<LearnPlay fixedPack="daily" />} />
          <Route path="/learn/test/:id" element={<LearnPlay fixedPack="test" />} />
          <Route path="/learn/deck" element={<LearnPlay fixedPack="deck" />} />
          <Route path="/quiz" element={<Navigate to="/learn" replace />} />

          <Route path="/lists" element={<Lists />} />
          <Route path="/list/:key" element={<ListView />} />
          <Route path="/patch/:id/:key?" element={<ListView />} />
          <Route path="/targets" element={<Targets />} />
          <Route path="/outing/:id" element={<Outing />} />
          <Route path="/log" element={<Log />} />
          <Route path="/add" element={<AddSighting />} />
          <Route path="/stats" element={<Stats />} />

          <Route path="/map" element={<MapScreen />} />
          <Route path="/map/sp/:id" element={<MapScreen />} />
          <Route path="/map/at/*" element={<MapScreen />} />

          <Route path="/spots" element={<Spots />} />
          <Route path="/spot/:idx" element={<SpotDetail />} />

          <Route path="/scan" element={<Scan />} />
          <Route path="/listen" element={<Listen />} />

          <Route path="/me" element={<Me />} />
          {/* v1 renderMe(sub): Me, with the sheet open over it and the address back at #/me. */}
          <Route path="/me/edit" element={<Me sub="edit" />} />
          <Route path="/me/signup" element={<Me sub="signup" />} />
          <Route path="/me/signin" element={<Me sub="signin" />} />
          <Route path="/u/:publicId" element={<PublicProfile />} />
          <Route path="/u/:publicId/outing/:outingUid" element={<PublicOuting />} />

          <Route path="/badges" element={<Badges />} />
          <Route path="/compare/:a/:b" element={<Compare />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/leaderboard" element={<Leaderboard />} />

          <Route path="*" element={<Placeholder title="Not found" />} />
        </Routes>
        </ScreenBoundary>
      </main>
      <OutingBar />
      <TabBar />
      <SightingSheetHost />
      <SearchHost />
      <AccountSheets />
    </>
  );
}
