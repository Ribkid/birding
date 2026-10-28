// Her records and the regional data start loading first, while the rest of the app is still being set up (lib/boot.ts).
import { booted } from './lib/boot';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Every change of address runs in a view transition, as v1's hashchange handler did (components/RouteMotion.tsx).
import { MotionHashRouter } from './components/RouteMotion';
// v1's stylesheet order (birding-refresh index.html): globals first, then screens.
import './styles/app.css';
import './screens/field/field.css';
import './styles/motion.css';
import './styles/look.css';
import './screens/screens.css';
import './screens/species.css';
import './screens/rest.css';
// v1 links learn.css twice, after field.css and again here, so its rules win over look.css (.btn radius) and the
// screen sheets. A bundle keeps one copy, so it goes in the later place, which gives the same cascade.
import './screens/learn/learn.css';
import './screens/field/calls.css';
import './screens/field/scan.css';
import './screens/me/me.css';
// React-only screens that v1 did not have as separate files.
import './screens/lists/lists.css';
import './screens/map/map.css';
import './screens/progress/progress.css';
import App from './App';
import { registerServiceWorker } from './lib/sw';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

// index.html paints a static shell (the hero, the sheet's edge and the tab bar) the moment the page loads. React
// draws over it once her sightings, outings and patches (lib/store.ts) and the regional data (lib/seq.ts) are in, at
// most BOOT_WAIT, so every screen's first frame has her real numbers and the Dex draws once, with the day's pick,
// instead of drawing empty and again.
const draw = () => createRoot(root).render(
  <StrictMode>
    <MotionHashRouter>
      <App />
    </MotionHashRouter>
  </StrictMode>,
);
void booted.then(draw, draw);

// Offline shell. Only in a production build; the dev server has no sw.js.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = () => registerServiceWorker();
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
