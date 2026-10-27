import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Dex from './screens/Dex';
import Bird from './screens/Bird';
import MapScreen from './screens/map/MapScreen';
import Scan from './screens/field/Scan';
import Listen from './screens/field/Listen';
import Badges from './screens/progress/Badges';
import Quiz from './screens/progress/Quiz';
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
import { Placeholder } from './screens/Placeholder';
import { TabBar } from './components/TabBar';
import { useSeqReady } from './lib/seq';

/** v1 scrolled to the top on navigation unless you were moving between dex pages. */
function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  // Regional data is fetched once; this re-renders the tree when it lands so screens
  // that depend on hotspots and reporting rates fill in.
  useSeqReady();
  return (
    <>
      <ScrollReset />
      <main id="view" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Navigate to="/dex" replace />} />
          <Route path="/dex" element={<Dex />} />
          <Route path="/bird/:id" element={<Bird />} />

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

          <Route path="/badges" element={<Badges />} />
          <Route path="/quiz" element={<Quiz />} />
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
