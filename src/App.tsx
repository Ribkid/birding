import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Dex from './screens/Dex';
import Bird from './screens/Bird';
import { Placeholder } from './screens/Placeholder';
import { TabBar } from './components/TabBar';

/** v1 scrolled to the top on navigation unless you were moving between dex pages. */
function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollReset />
      <main id="view" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Navigate to="/dex" replace />} />
          <Route path="/dex" element={<Dex />} />
          <Route path="/bird/:id" element={<Bird />} />

          {/* Ported by the lists/outings agent */}
          <Route path="/lists" element={<Placeholder title="Lists" owner="lists agent" />} />
          <Route path="/list/:key" element={<Placeholder title="List" owner="lists agent" />} />
          <Route path="/patch/:id/:key?" element={<Placeholder title="Patch" owner="lists agent" />} />
          <Route path="/targets" element={<Placeholder title="Targets" owner="lists agent" />} />
          <Route path="/outing/:id" element={<Placeholder title="Outing" owner="lists agent" />} />
          <Route path="/log" element={<Placeholder title="All sightings" owner="lists agent" />} />
          <Route path="/stats" element={<Placeholder title="Stats" owner="lists agent" />} />

          {/* Ported by the field-tools agent */}
          <Route path="/map" element={<Placeholder title="Map" owner="map agent" />} />
          <Route path="/map/sp/:id" element={<Placeholder title="Map" owner="map agent" />} />
          <Route path="/map/at/:lat,:lng" element={<Placeholder title="Map" owner="map agent" />} />
          <Route path="/scan" element={<Placeholder title="Scan a photo" owner="scan agent" />} />
          <Route path="/listen" element={<Placeholder title="Listen" owner="listen agent" />} />
          <Route path="/add" element={<Placeholder title="Add a sighting" owner="lists agent" />} />

          {/* Ported by the progress/account agent */}
          <Route path="/badges" element={<Placeholder title="Badges" owner="progress agent" />} />
          <Route path="/quiz" element={<Placeholder title="Guess the bird" owner="progress agent" />} />
          <Route path="/compare/:a/:b" element={<Placeholder title="Compare" owner="progress agent" />} />
          <Route path="/leaderboard" element={<Placeholder title="Leaderboard" owner="progress agent" />} />
          <Route path="/settings" element={<Placeholder title="Settings" owner="progress agent" />} />

          <Route path="*" element={<Placeholder title="Not found" owner="—" />} />
        </Routes>
      </main>
      <TabBar />
    </>
  );
}
