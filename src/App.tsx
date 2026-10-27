import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Dex from './screens/Dex';
import Bird from './screens/Bird';
import MapScreen from './screens/map/MapScreen';
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
import Learn from './screens/learn/Learn';
import LearnPlay from './screens/learn/LearnPlay';
import Me from './screens/me/Me';
import EditProfile from './screens/me/EditProfile';
import SignIn from './screens/me/SignIn';
import PublicProfile from './screens/me/PublicProfile';
import { Placeholder } from './screens/Placeholder';
import { TabBar } from './components/TabBar';
import { useSeqReady } from './lib/seq';
import { initLook, lookAfterDraw } from './lib/look';
import { closeAllLayers } from './lib/layers';
import { initProfile } from './core/profile.js';
import { initAccount } from './core/account.js';

/** v1 scrolled to the top on navigation unless you were moving between dex pages. */
function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    closeAllLayers('nav');
  }, [pathname]);
  return null;
}

/** The frosted bar takes its title and back control from whatever the screen just drew. */
function TopBar() {
  const location = useLocation();
  useEffect(() => {
    initLook();
    const id = requestAnimationFrame(() => lookAfterDraw(document.getElementById('view')));
    return () => cancelAnimationFrame(id);
  }, [location.pathname, location.search]);
  return null;
}

export default function App() {
  // Regional data is fetched once; this re-renders the tree when it lands so screens
  // that depend on hotspots and reporting rates fill in.
  useSeqReady();
  useEffect(() => {
    void initProfile();
    void initAccount();
  }, []);
  return (
    <>
      <ScrollReset />
      <TopBar />
      <main id="view" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Navigate to="/dex" replace />} />
          <Route path="/dex" element={<Dex />} />
          <Route path="/bird/:id" element={<Bird />} />

          <Route path="/learn" element={<Learn />} />
          <Route path="/learn/play/:pack" element={<LearnPlay />} />
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

          <Route path="/scan" element={<Scan />} />
          <Route path="/listen" element={<Listen />} />

          <Route path="/me" element={<Me />} />
          <Route path="/me/edit" element={<EditProfile />} />
          <Route path="/me/signup" element={<SignIn mode="signup" />} />
          <Route path="/me/signin" element={<SignIn mode="signin" />} />
          <Route path="/u/:publicId" element={<PublicProfile />} />

          <Route path="/badges" element={<Badges />} />
          <Route path="/compare/:a/:b" element={<Compare />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/leaderboard" element={<Leaderboard />} />

          <Route path="*" element={<Placeholder title="Not found" owner="—" />} />
        </Routes>
      </main>
      <TabBar />
    </>
  );
}
