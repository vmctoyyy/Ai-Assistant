import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './ui/App';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/* Offline support, so the game still deals with no signal once it has been
   added to a home screen. There is no worker in the single-file build, so a
   failure here is expected there and is deliberately swallowed. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
