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

createRoot(root).render(
  <StrictMode>
    <MotionHashRouter>
      <App />
    </MotionHashRouter>
  </StrictMode>,
);

// Offline shell. Only in a production build; the dev server has no sw.js.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = () => registerServiceWorker();
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
