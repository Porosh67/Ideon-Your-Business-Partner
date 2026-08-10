import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// Apply saved theme before first paint to avoid flash of wrong theme.
// Defaults to light for new visitors; dark remains available via the toggle.
(function initTheme() {
  try {
    // New key first, with one-time migration from the legacy 'bcp-theme' key.
    const stored = localStorage.getItem('ideon-theme') ?? localStorage.getItem('bcp-theme');
    const theme = stored === 'light' || stored === 'dark' ? stored : 'light';
    if (stored) localStorage.removeItem('bcp-theme');
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    // ignore storage errors
  }
})();

// Mount point for the Vite entry file; index.html must contain <div id="root">.
const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);