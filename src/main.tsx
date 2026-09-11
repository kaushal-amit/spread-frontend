import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
// D3 · nothing mounts before a signed-in user (transparent without VITE_FIREBASE_*).
import { AuthGate } from './components/AuthGate';
// 4.4 · the fonts are SELF-HOSTED: bundled from @fontsource, served from the
// same origin as the terminal. No request to Google Fonts from a trading
// screen, and the page renders the same behind a VPN with no outbound HTTP.
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/400-italic.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/500-italic.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/ibm-plex-sans-condensed/400.css';
import '@fontsource/ibm-plex-sans-condensed/500.css';
import '@fontsource/ibm-plex-sans-condensed/600.css';
import '@fontsource/ibm-plex-sans-condensed/700.css';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate><App /></AuthGate>
  </StrictMode>,
);
