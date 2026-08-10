import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'ideon-theme';
const LEGACY_STORAGE_KEY = 'bcp-theme';

function getInitialTheme(): Theme {
  try {
    // Read the new key first; fall back to the legacy key and migrate it away.
    const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  // Light by default for new visitors (user preference; dark remains available).
  return 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme };
}
